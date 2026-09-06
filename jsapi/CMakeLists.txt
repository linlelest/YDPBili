cmake_minimum_required(VERSION 3.10)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# ==============================================
# 【CMake交叉编译铁则：所有核心配置必须放在project()之前！】
# ==============================================
set(CMAKE_DEPEND_INFO_SKIP 1)
set(CMAKE_LINK_DEPENDS_USE_LINKER 0)

# 1. 读取环境变量，定位交叉编译器
if(NOT DEFINED ENV{CROSS_TOOLCHAIN_PREFIX})
    message(FATAL_ERROR "CROSS_TOOLCHAIN_PREFIX environment variable is not set.")
endif()
set(CMAKE_C_COMPILER "$ENV{CROSS_TOOLCHAIN_PREFIX}gcc")
set(CMAKE_CXX_COMPILER "$ENV{CROSS_TOOLCHAIN_PREFIX}g++")

# 2. 【核心！让编译器自己输出原生SYSROOT，彻底解决#include_next问题】
execute_process(
    COMMAND ${CMAKE_C_COMPILER} -print-sysroot
    OUTPUT_VARIABLE GCC_NATIVE_SYSROOT
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_SYSROOT "${GCC_NATIVE_SYSROOT}")

# 3. 强制给编译器传递sysroot参数
set(CMAKE_SYSROOT_FLAG "--sysroot=${CMAKE_SYSROOT}")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${CMAKE_SYSROOT_FLAG}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${CMAKE_SYSROOT_FLAG}")

# 4. 交叉编译搜索规则：只从工具链找系统库，不碰主机系统
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# 额外库搜索路径
get_filename_component(TOOLCHAIN_BIN_DIR "${CMAKE_C_COMPILER}" DIRECTORY)
get_filename_component(TOOLCHAIN_ROOT_DIR "${TOOLCHAIN_BIN_DIR}" DIRECTORY)
set(TARGET_TRIPLE "arm-none-linux-gnueabihf")
set(TOOLCHAIN_TARGET_DIR "${TOOLCHAIN_ROOT_DIR}/${TARGET_TRIPLE}")
set(CMAKE_FIND_ROOT_PATH
    "${TOOLCHAIN_TARGET_DIR}/libc"
    "${TOOLCHAIN_TARGET_DIR}/sysroot"
    "${TOOLCHAIN_TARGET_DIR}"
    "${CMAKE_SOURCE_DIR}/lib"
)

# 5. 交叉编译关键变量打印（红色高亮）
execute_process(COMMAND echo -e "\\033[31m==================================================\\033[0m")
execute_process(COMMAND echo -e "\\033[31m【交叉编译关键变量排查】\\033[0m")
execute_process(COMMAND echo -e "\\033[31m==================================================\\033[0m")
execute_process(COMMAND echo -e "\\033[31m编译器前缀: $ENV{CROSS_TOOLCHAIN_PREFIX}\\033[0m")
execute_process(COMMAND echo -e "\\033[31mC编译器: ${CMAKE_C_COMPILER}\\033[0m")
execute_process(COMMAND echo -e "\\033[31mC++编译器: ${CMAKE_CXX_COMPILER}\\033[0m")
execute_process(COMMAND echo -e "\\033[31m原生SYSROOT: ${GCC_NATIVE_SYSROOT}\\033[0m")
execute_process(COMMAND echo -e "\\033[31m目标目录: ${TOOLCHAIN_TARGET_DIR}\\033[0m")
execute_process(COMMAND echo -e "\\033[31m搜索根路径: ${CMAKE_FIND_ROOT_PATH}\\033[0m")
execute_process(COMMAND echo -e "\\033[31m==================================================\\033[0m")

# ==============================================
# 项目基础定义
# ==============================================
project(jsapi_langningchen C CXX)

set(LIB_NAME jsapi_langningchen)
set(MID_LIB_NAME iot_sdk_lib)
set(IOT_UI_SDK_PATH "${CMAKE_SOURCE_DIR}/iot-miniapp-sdk")

# 头文件路径
include_directories(
    ${CMAKE_SOURCE_DIR}/src/
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/lib/nlohmann/include
)

link_directories(${IOT_UI_SDK_PATH}/lib)

# C++ 标准与编译选项
set(CMAKE_CXX_STANDARD 17)
add_compile_options(-Wall -Werror=return-type -Wno-psabi)

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    add_compile_options(-Os)
else()
    add_compile_options(-g -O0 -Wformat -Wformat-security -fstack-protector --param ssp-buffer-size=4)
endif()

# ==============================================
# 中间静态库
# ==============================================
file(GLOB_RECURSE LIB_SOURCES iot-miniapp-sdk/src/*.cpp)
add_library(${MID_LIB_NAME} STATIC ${LIB_SOURCES})
target_compile_options(${MID_LIB_NAME} PRIVATE -w)
target_include_directories(${MID_LIB_NAME} PUBLIC ${IOT_UI_SDK_PATH}/include)
set_target_properties(${MID_LIB_NAME} PROPERTIES POSITION_INDEPENDENT_CODE ON)

# ==============================================
# 最终动态库
# ==============================================
file(GLOB_RECURSE SOURCES src/*.cpp src/AI/*.cpp src/IME/*.cpp src/Database/*.cpp src/Shell/*.cpp)
add_library(${LIB_NAME} SHARED ${SOURCES})

# 链接库
target_link_libraries(${LIB_NAME} PRIVATE
    ${MID_LIB_NAME}
    pthread
    -Wl,-unresolved-symbols=ignore-all
)

# ==============================================
# 【可选8】ffmpeg 软解 Media 模块（Bilibili miniapp）
# 依赖：先用 tools/build_ffmpeg_x7.sh 把静态库安装到 jsapi/thirdparty/ffmpeg
# 开启：cmake -DHAVE_FFMPEG=ON -DFFMPEG_ROOT=<install prefix>
# 默认关闭：无 ffmpeg 时 Media JSAPI 各方法运行时报错，构建不受影响
# ==============================================
option(HAVE_FFMPEG "Enable ffmpeg-based Media JSAPI (Bilibili miniapp)" OFF)
set(FFMPEG_ROOT "${CMAKE_SOURCE_DIR}/thirdparty/ffmpeg" CACHE PATH "ffmpeg install prefix (libavcodec/libavformat/libavutil/libswresample/libswscale)")

if(HAVE_FFMPEG)
    find_library(FFMPEG_AVCODEC_LIB avcodec PATHS ${FFMPEG_ROOT}/lib NO_DEFAULT_PATH REQUIRED)
    find_library(FFMPEG_AVFORMAT_LIB avformat PATHS ${FFMPEG_ROOT}/lib NO_DEFAULT_PATH REQUIRED)
    find_library(FFMPEG_AVUTIL_LIB avutil PATHS ${FFMPEG_ROOT}/lib NO_DEFAULT_PATH REQUIRED)
    find_library(FFMPEG_SWRESAMPLE_LIB swresample PATHS ${FFMPEG_ROOT}/lib NO_DEFAULT_PATH REQUIRED)
    find_library(FFMPEG_SWSCALE_LIB swscale PATHS ${FFMPEG_ROOT}/lib NO_DEFAULT_PATH REQUIRED)
    target_include_directories(${LIB_NAME} PRIVATE ${FFMPEG_ROOT}/include)
    target_compile_definitions(${LIB_NAME} PRIVATE HAVE_FFMPEG)
    target_link_libraries(${LIB_NAME} PRIVATE
        ${FFMPEG_AVCODEC_LIB}
        ${FFMPEG_AVFORMAT_LIB}
        ${FFMPEG_AVUTIL_LIB}
        ${FFMPEG_SWRESAMPLE_LIB}
        ${FFMPEG_SWSCALE_LIB}
        z
    )
    message(STATUS "Media JSAPI: HAVE_FFMPEG=ON, ffmpeg at ${FFMPEG_ROOT}")
endif()

# ==============================================
# 【可选9】音频输出后端（Media JSAPI，按笔端实际存在的库二选一）
# 真机确认后开启对应分支：ls /usr/lib | grep -E "asound|tinyalsa"
# ==============================================
option(HAVE_ALSA "Enable ALSA (libasound) audio sink for Media JSAPI" OFF)
option(HAVE_TINYALSA "Enable tinyalsa (libtinyalsa) audio sink for Media JSAPI" OFF)

if(HAVE_ALSA)
    find_path(ALSA_INCLUDE_DIR alsa/asoundlib.h PATHS ${FFMPEG_ROOT}/../alsa/include ${CMAKE_SOURCE_DIR}/thirdparty/alsa/include NO_DEFAULT_PATH)
    find_library(ALSA_LIBRARY asound PATHS ${CMAKE_SOURCE_DIR}/thirdparty/alsa/lib ${FFMPEG_ROOT}/../alsa/lib NO_DEFAULT_PATH)
    if(NOT ALSA_LIBRARY)
        message(FATAL_ERROR "HAVE_ALSA=ON 但未找到 libasound，请把笔端 /usr/lib/libasound.so* 放入 jsapi/thirdparty/alsa/lib")
    endif()
    if(ALSA_INCLUDE_DIR)
        target_include_directories(${LIB_NAME} PRIVATE ${ALSA_INCLUDE_DIR})
    endif()
    target_compile_definitions(${LIB_NAME} PRIVATE HAVE_ALSA)
    target_link_libraries(${LIB_NAME} PRIVATE ${ALSA_LIBRARY})
    message(STATUS "Media JSAPI audio sink: ALSA")
elseif(HAVE_TINYALSA)
    find_path(TINYALSA_INCLUDE_DIR tinyalsa/asoundlib.h PATHS ${CMAKE_SOURCE_DIR}/thirdparty/tinyalsa/include NO_DEFAULT_PATH)
    find_library(TINYALSA_LIBRARY tinyalsa PATHS ${CMAKE_SOURCE_DIR}/thirdparty/tinyalsa/lib NO_DEFAULT_PATH)
    if(NOT TINYALSA_LIBRARY)
        message(FATAL_ERROR "HAVE_TINYALSA=ON 但未找到 libtinyalsa，请把笔端 /usr/lib/libtinyalsa.so* 放入 jsapi/thirdparty/tinyalsa/lib")
    endif()
    if(TINYALSA_INCLUDE_DIR)
        target_include_directories(${LIB_NAME} PRIVATE ${TINYALSA_INCLUDE_DIR})
    endif()
    target_compile_definitions(${LIB_NAME} PRIVATE HAVE_TINYALSA)
    target_link_libraries(${LIB_NAME} PRIVATE ${TINYALSA_LIBRARY})
    message(STATUS "Media JSAPI audio sink: tinyalsa")
else()
    message(STATUS "Media JSAPI audio sink: none (compile-time default; runtime WAV debug available via setAudioSink('wav'))")
endif()

# ==============================================
# ================= 分隔线 =====================
#  下面全是【可选扩展模块】，默认全部注释，不污染主流程
#  需要时解开对应块即可使用
# ==============================================

# ==============================================
# 自动生成字典模块
# ==============================================
set(RAWDICT_TXT ${CMAKE_SOURCE_DIR}/rawdict_utf16_65105_freq.txt)
set(RAWDICT_TXT_UTF8 ${CMAKE_BINARY_DIR}/rawdict_utf8.txt)
set(RAWDICT_HPP ${CMAKE_SOURCE_DIR}/src/IME/rawdict_data.hpp)

add_custom_command(
    OUTPUT ${RAWDICT_HPP}
    COMMAND iconv -f UTF-16 -t UTF-8 ${RAWDICT_TXT} -o ${RAWDICT_TXT_UTF8}
    COMMAND ${CMAKE_COMMAND} -E echo "// Auto-generated" > ${RAWDICT_HPP}
    COMMAND ${CMAKE_COMMAND} -E echo "#pragma once" >> ${RAWDICT_HPP}
    COMMAND ${CMAKE_COMMAND} -E echo "#include <string>" >> ${RAWDICT_HPP}
    COMMAND ${CMAKE_COMMAND} -E echo "static const std::string RAWDICT_DATA = R\"DICT(" >> ${RAWDICT_HPP}
    COMMAND ${CMAKE_COMMAND} -E cat ${RAWDICT_TXT_UTF8} >> ${RAWDICT_HPP}
    COMMAND ${CMAKE_COMMAND} -E echo ")DICT\";" >> ${RAWDICT_HPP}
    VERBATIM
)
add_custom_target(generate_rawdict_data_hpp DEPENDS ${RAWDICT_HPP})

add_dependencies(${LIB_NAME} generate_rawdict_data_hpp)

# ==============================================
# 【可选2】项目本地预编译库查找（curl、sqlite3）
# ==============================================
# find_library(CURL_LIBRARY
#     NAMES curl
#     PATHS ${CMAKE_SOURCE_DIR}/lib
#     NO_DEFAULT_PATH
#     REQUIRED
# )
# find_library(SQLITE_LIBRARY
#     NAMES sqlite3
#     PATHS ${CMAKE_SOURCE_DIR}/lib
#     NO_DEFAULT_PATH
#     REQUIRED
# )
# # 链接时打开下面两行
# # ${CURL_LIBRARY}
# # ${SQLITE_LIBRARY}

# ==============================================
# 【可选3】ncursesw 宽字符库
# ==============================================
# set(CURSES_NEED_NCURSES TRUE)
# set(CURSES_NEED_WIDE TRUE)
# find_package(Curses REQUIRED)
# include_directories(SYSTEM ${CURSES_INCLUDE_DIRS})
# 
# if(NOT CURSES_LIBRARY MATCHES "libncursesw\\.a")
#     message(FATAL_ERROR "需要 ncursesw 宽字符版本，当前库：${CURSES_LIBRARY}")
# endif()
# message(STATUS "✅ 已确认使用 ncursesw: ${CURSES_LIBRARY}")
# message(STATUS "✅ ncurses头文件路径: ${CURSES_INCLUDE_DIRS}")

# ==============================================
# 【可选4】readline 库
# ==============================================
# find_path(READLINE_INCLUDE_DIR
#     NAMES history.h
#     PATH_SUFFIXES readline
#     REQUIRED
# )
# find_library(READLINE_LIBRARY
#     NAMES readline
#     REQUIRED
# )

# ==============================================
# 【可选5】libvterm 库
# ==============================================
# find_path(VTERM_INCLUDE_DIR
#     NAMES vterm.h
#     REQUIRED
# )
# find_library(VTERM_LIBRARY
#     NAMES vterm
#     REQUIRED
# )
# message(STATUS "✅ libvterm 库: ${VTERM_LIBRARY}")
# message(STATUS "✅ libvterm 头文件: ${VTERM_INCLUDE_DIR}")

# ==============================================
# 【可选6】libutil 库 & openpty 检查
# ==============================================
# find_library(UTIL_LIBRARY
#     NAMES util
#     REQUIRED
# )
# 
# include(CheckFunctionExists)
# set(CMAKE_REQUIRED_LIBRARIES ${UTIL_LIBRARY})
# check_function_exists(openpty HAVE_OPENPTY)
# if(NOT HAVE_OPENPTY)
#     message(FATAL_ERROR "libutil 缺少 openpty")
# endif()

# ==============================================
# 【可选7】readline add_history 检查
# ==============================================
# include(CheckFunctionExists)
# set(CMAKE_REQUIRED_LIBRARIES ${READLINE_LIBRARY} ${CURSES_LIBRARIES})
# check_function_exists(add_history HAVE_ADD_HISTORY)
# if(NOT HAVE_ADD_HISTORY)
#     message(FATAL_ERROR "readline 缺少 add_history")
# endif()
