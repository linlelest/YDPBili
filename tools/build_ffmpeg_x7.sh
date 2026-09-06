#!/usr/bin/env bash
# ============================================================================
# tools/build_ffmpeg_x7.sh — 为有道词典笔 X7 Pro 交叉编译最小 ffmpeg 静态库
#
# 运行环境：WSL Ubuntu（本机无 WSL 时无法运行，脚本与参数已就绪待验证）
# 用法：
#   cd <repo-root>
#   bash tools/build_ffmpeg_x7.sh [ffmpeg 源码目录]
#
# 前置条件：
#   1) jsapi/toolchains/aarch64--glibc--stable-2018.11-1/ 已解压（Task 0 已就位）
#   2) git / make / pkg-config / perl 已安装（sudo apt install -y git make pkg-config perl xz-utils）
#   3) 源码默认自动下载 ffmpeg n6.1.2（--depth 1）
#      · 选 6.1 的原因：Media JSAPI 使用 5.1+ 的 AVChannelLayout/swr_alloc_set_opts2 API
#      · 如需改版本：FFMPEG_VERSION=n7.1 ./tools/build_ffmpeg_x7.sh ...
#
# 产物：
#   jsapi/thirdparty/ffmpeg/lib/lib{avcodec,avformat,avutil,swresample,swscale}.a
#   jsapi/thirdparty/ffmpeg/include/lib{avcodec,avformat,avutil,swresample,swscale}/*.h
#   构建 jsapi 时：cmake -DHAVE_FFMPEG=ON（CMakeLists 可选8 会自动链接）
# ============================================================================

set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-n6.1.2}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_ROOT="$(find "${REPO_ROOT}/jsapi/toolchains" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
TARGET_BIN="${TOOLCHAIN_ROOT}/bin"
PREFIX="${REPO_ROOT}/jsapi/thirdparty/ffmpeg"
SRC_DIR="${1:-${REPO_ROOT}/build/ffmpeg-src-${FFMPEG_VERSION}}"
BUILD_THREADS="$(nproc)"

# 是否启用 NEON 汇编优化：默认 0（保守，规避老 binutils 汇编兼容问题）。
# 笔端 rk3576 支持 NEON；验证构建成功后可改为 1 提升软解性能。
ENABLE_ASM="${ENABLE_ASM:-0}"

if [ -z "${TOOLCHAIN_ROOT}" ]; then
    echo "[ERROR] 未找到工具链：请先解压 aarch64--glibc--stable-2018.11-1.tar.bz2 到 jsapi/toolchains/" >&2
    exit 1
fi

CROSS_PREFIX="${TARGET_BIN}/aarch64-buildroot-linux-gnu-"
CC="${CROSS_PREFIX}gcc"
CXX="${CROSS_PREFIX}g++"
for tool in "${CC}" "${CROSS_PREFIX}ar" "${CROSS_PREFIX}ranlib"; do
    [ -x "${tool}" ] || { echo "[ERROR] 缺少交叉工具：${tool}" >&2; exit 1; }
done

# sysroot 由工具链自带（bootlin 风格：gcc -print-sysroot 可输出）
SYSROOT="$("${CC}" -print-sysroot 2>/dev/null || true)"
[ -z "${SYSROOT}" ] && SYSROOT="${TOOLCHAIN_ROOT}/aarch64-buildroot-linux-gnu/sysroot"

echo "[INFO] toolchain : ${TOOLCHAIN_ROOT}"
echo "[INFO] cross gcc : ${CC} ($("${CC}" -dumpversion))"
echo "[INFO] sysroot   : ${SYSROOT}"
echo "[INFO] ffmpeg    : ${FFMPEG_VERSION}"
echo "[INFO] asm/neon  : ${ENABLE_ASM}"

# ----------------------------------------------------------------------------
# 1) 获取源码
# ----------------------------------------------------------------------------
mkdir -p "$(dirname "${SRC_DIR}")"
if [ ! -d "${SRC_DIR}" ]; then
    git clone --depth 1 --branch "${FFMPEG_VERSION}" \
        https://git.ffmpeg.org/ffmpeg.git "${SRC_DIR}"
fi
cd "${SRC_DIR}"

# ----------------------------------------------------------------------------
# 2) configure 参数说明
#
# 目标平台参数（交叉编译三件套 + 工具链指定）：
#   --enable-cross-compile   声明交叉编译（configure 会跳过本机运行测试）
#   --arch=aarch64           目标 CPU 架构（决定内部后端选择）
#   --target-os=linux        目标操作系统
#   --cross-prefix=...       编译工具前缀（ar/ranlib/strip 等自动拼出）
#   --cc/--cxx               显式指定交叉 C/C++ 编译器
#   --sysroot=...            目标系统头文件与库根（glibc 2.28）
#
# 库形态与构建裁剪：
#   --enable-static --disable-shared  只产 .a 静态库，最终链入
#                                     libjsapi_langningchen.so，避免携带多个 so
#   --enable-pic                      位置无关代码（静态库链入 so 的硬性要求）
#   --disable-programs                不编译 ffmpeg/ffprobe 可执行程序
#   --disable-doc --disable-debug     关闭文档与调试信息
#   --disable-autodetect              禁止自动探测主机库（防止误链 x86 的 zlib 等）
#   --enable-small                    以体积优先（-Os 风格）
#   --disable-asm / （ENABLE_ASM=1 时省略）  关闭手写汇编（仅保留 C 实现）
#
# 组件裁剪（先关全部，再按需打开，控制体积）：
#   --disable-everything       关闭所有编码器/解码器/封装/解封装/协议/滤镜
#   --disable-avdevice         关闭设备层（无摄像头/麦克风需求）
#   --disable-network          关闭网络协议栈（TLS 证书/openssl 引入复杂；
#                              网络取流统一由系统 libcurl 7.79.1 承担，
#                              Media::open 先经 curl 落盘缓存，再以 file 协议喂给 ffmpeg）
#   --enable-swresample        采样率/声道/格式重采样（AAC→S16 PCM 必需）
#   --enable-swscale           像素格式缩放（YUV420P→YUVJ420P 编码 JPEG 必需）
#   --enable-decoder=h264      视频（B 站 16/32/64qn 主流 H.264）
#   --enable-decoder=aac       音频（mp4a.40.2，DASH 64K）
#   --enable-decoder=mp3,flac  音频兜底（历史投稿/番剧可能遇到）
#   --enable-demuxer=mov       m4s/DASH init+segment 与 m4a 均走 mov 解封装
#   --enable-demuxer=mp3,flac  音频兜底
#   --enable-parser=h264,aac   码流解析器（decode 前必需）
#   --enable-protocol=file     仅本地文件协议
#   --enable-encoder=mjpeg     视频帧→JPEG（ffmpeg 内置，无外部依赖），
#                              供 base64 data-URI 刷新 falcon image 组件
#   --enable-bsf=aac_adtstoasc AAC ADTS→ASC 转换备用（裸流调试时用）
#
# 可选扩展（当前未用，留注释备用）：
#   --enable-protocol=https,tcp,tls  需交叉编译 openssl 并加
#     --extra-cflags="-I<prefix>/include" --extra-ldflags="-L<prefix>/lib -lssl -lcrypto"
#     （已决定不用：由 curl 拉流，ffmpeg 保持零网络依赖）
# ----------------------------------------------------------------------------
CONFIGURE_FLAGS=(
    --prefix="${PREFIX}"
    --enable-cross-compile
    --arch=aarch64
    --target-os=linux
    --cross-prefix="${CROSS_PREFIX}"
    --cc="${CC}"
    --cxx="${CXX}"
    --sysroot="${SYSROOT}"
    --enable-static
    --disable-shared
    --enable-pic
    --disable-programs
    --disable-doc
    --disable-debug
    --disable-autodetect
    --enable-small
    --disable-everything
    --disable-avdevice
    --disable-network
    --enable-swresample
    --enable-swscale
    --enable-decoder=h264
    --enable-decoder=aac
    --enable-decoder=mp3
    --enable-decoder=flac
    --enable-demuxer=mov
    --enable-demuxer=mp3
    --enable-demuxer=flac
    --enable-parser=h264
    --enable-parser=aac
    --enable-protocol=file
    --enable-encoder=mjpeg
    --enable-bsf=aac_adtstoasc
)
if [ "${ENABLE_ASM}" = "0" ]; then
    CONFIGURE_FLAGS+=(--disable-asm)
fi

echo "[INFO] configure ..."
./configure "${CONFIGURE_FLAGS[@]}" \
    --extra-cflags="-fPIC -Os -ffunction-sections -fdata-sections" \
    --extra-ldflags="-Wl,--gc-sections"

echo "[INFO] make -j${BUILD_THREADS} ..."
make -j"${BUILD_THREADS}"
echo "[INFO] make install ..."
make install

# ----------------------------------------------------------------------------
# 3) 产物校验（架构必须为 aarch64）
# ----------------------------------------------------------------------------
echo "[INFO] 产物清单："
ls -l "${PREFIX}/lib/"
for lib in libavcodec libavformat libavutil libswresample libswscale; do
    f="${PREFIX}/lib/${lib}.a"
    [ -f "${f}" ] || { echo "[ERROR] 缺少 ${f}" >&2; exit 1; }
    if command -v file >/dev/null 2>&1; then
        file "${f}" | grep -q "ARM aarch64" || {
            echo "[ERROR] ${f} 不是 aarch64 产物（$(file "${f}")）" >&2
            exit 1
        }
    fi
done
echo "[INFO] 完成：${PREFIX}"
echo "[INFO] 下一步：cmake -S jsapi -B jsapi/build -DHAVE_FFMPEG=ON && make -C jsapi/build"
