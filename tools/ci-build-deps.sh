#!/usr/bin/env bash
# ============================================================================
# tools/ci-build-deps.sh — GitHub Actions (ubuntu-latest) 交叉编译 Media 依赖
#
# 在 CI 上交叉编译并安装（尽力而为，单项失败不阻断流水线）：
#   1. alsa-lib 1.2.11  -> jsapi/thirdparty/alsa   (静态 libasound.a,  HAVE_ALSA)
#   2. ffmpeg  n6.1.2   -> jsapi/thirdparty/ffmpeg (静态 .a,            HAVE_FFMPEG)
#
# 用法：
#   bash tools/ci-build-deps.sh [工具链目录]
#   默认工具链目录：jsapi/toolchains/aarch64--glibc--stable-2018.11-1
#
# 产物/输出：
#   jsapi/thirdparty/{alsa,ffmpeg}        交叉编译产物（.gitignore 已忽略，可被 actions/cache 缓存）
#   build/ci_extra_cmake_flags.txt        传给 build.sh 的 EXTRA_CMAKE_FLAGS（如 "-DHAVE_FFMPEG=ON -DHAVE_ALSA=ON"）
#   build/ci_deps_summary.txt             人读摘要
#
# 幂等：对应产物已存在则跳过（配合 actions/cache 命中后直接跳过全部编译）。
# 失败策略：
#   - alsa-lib 失败   -> 只开 HAVE_FFMPEG（音频回退 NullAudioSink，视频仍可用）
#   - ffmpeg 失败     -> 保持现状（Media 各方法运行时报错），run 不 fail
#   - 工具链缺失/损坏 -> exit 1（jsapi 本体同样无法构建，快速失败）
# 关键编译开关依据（两轮调研结论，详见 Task 20 报告）：
#   - ffmpeg: --enable-cross-compile --arch=aarch64 --target-os=linux
#             --cross-prefix/--cc/--cxx/--sysroot --enable-pic（静态库链入 so 硬性要求）
#             --disable-everything 会连 protocols/parsers 一起关闭，须逐项 enable
#             --disable-autodetect 会连带关闭 pthreads，故显式 --enable-pthreads
#             binutils 2.29.1 较老 -> --disable-asm 规避手写/内联汇编兼容问题
#   - alsa-lib: libtool 缺陷导致静态/动态不能同时构建 -> 只出 .a
#             --with-configdir=/usr/share/alsa 指向笔端 buildroot 标准配置路径
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_ROOT="${1:-jsapi/toolchains/aarch64--glibc--stable-2018.11-1}"
case "${TOOLCHAIN_ROOT}" in
    /*) ;;
    *) TOOLCHAIN_ROOT="${REPO_ROOT}/${TOOLCHAIN_ROOT}" ;;
esac

ALSA_VERSION="1.2.11"
FFMPEG_VERSION="6.1.2" # 对应 ffmpeg tag n6.1.2（Media 依赖 5.1+ 的 AVChannelLayout/swr_alloc_set_opts2 API）
THIRDPARTY_DIR="${REPO_ROOT}/jsapi/thirdparty"
WORK_DIR="${REPO_ROOT}/build/ci-deps"
FLAGS_FILE="${REPO_ROOT}/build/ci_extra_cmake_flags.txt"
SUMMARY_FILE="${REPO_ROOT}/build/ci_deps_summary.txt"
BUILD_THREADS="$(nproc 2>/dev/null || echo 2)"

log() { echo "[ci-deps] $*"; }
warn() { echo "[ci-deps][WARN] $*" >&2; }
die() {
    echo "[ci-deps][ERROR] $*" >&2
    exit 1
}

mkdir -p "${THIRDPARTY_DIR}" "${WORK_DIR}" "$(dirname "${FLAGS_FILE}")"
: >"${FLAGS_FILE}"
printf 'CI deps build at %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"${SUMMARY_FILE}"

# ---- 0) 构建工具（runner 一般自带，缺则尽力 apt 安装） ----------------------
MISSING_TOOLS=""
for tool in make curl tar xz bzip2 file git; do
    command -v "${tool}" >/dev/null 2>&1 || MISSING_TOOLS="${MISSING_TOOLS} ${tool}"
done
if [ -n "${MISSING_TOOLS}" ]; then
    log "尝试安装缺失工具:${MISSING_TOOLS}"
    if command -v sudo >/dev/null 2>&1; then
        sudo apt-get update -y && sudo apt-get install -y build-essential curl xz-utils bzip2 file git || warn "apt 安装失败，继续尝试构建"
    else
        apt-get update -y && apt-get install -y build-essential curl xz-utils bzip2 file git || warn "apt 安装失败，继续尝试构建"
    fi
fi

# ---- 1) 工具链校验（缺失即快速失败） ---------------------------------------
if [ ! -d "${TOOLCHAIN_ROOT}" ]; then
    die "工具链目录不存在：${TOOLCHAIN_ROOT}（请先解压 aarch64--glibc--stable-2018.11-1.tar.bz2）"
fi
CROSS_PREFIX="${TOOLCHAIN_ROOT}/bin/aarch64-buildroot-linux-gnu-"
CC="${CROSS_PREFIX}gcc"
CXX="${CROSS_PREFIX}g++"
for tool in "${CC}" "${CXX}" "${CROSS_PREFIX}ar" "${CROSS_PREFIX}ranlib"; do
    if [ ! -x "${tool}" ]; then
        die "缺少交叉工具：${tool}"
    fi
done
SYSROOT="$("${CC}" -print-sysroot 2>/dev/null || true)"
if [ -z "${SYSROOT}" ]; then
    SYSROOT="${TOOLCHAIN_ROOT}/aarch64-buildroot-linux-gnu/sysroot"
fi
log "工具链  : ${TOOLCHAIN_ROOT} (gcc $("${CC}" -dumpversion))"
log "sysroot : ${SYSROOT}"
log "并发    : -j${BUILD_THREADS}"

download() {
    local out="$1"
    shift
    local url
    for url in "$@"; do
        log "下载 ${url}"
        if curl -fL --retry 3 --connect-timeout 20 -o "${out}" "${url}"; then
            return 0
        fi
        warn "下载失败：${url}"
    done
    return 1
}

log_tail() {
    local f="$1"
    if [ -f "${f}" ]; then
        warn "-------- ${f} 尾部 80 行 --------"
        tail -n 80 "${f}" >&2 || true
        warn "--------------------------------"
    else
        warn "未找到日志文件 ${f}"
    fi
}

# GNU file 对 .a 只输出 "current ar archive"（无架构信息），故用交叉 readelf
# 校验：提取首个成员并检查 ELF Machine 字段是否为 AArch64
verify_aarch64_archive() {
    local lib="$1"
    local member
    if [ ! -x "${CROSS_PREFIX}readelf" ]; then
        warn "交叉工具链缺少 readelf，跳过 ${lib} 的架构校验"
        return 0
    fi
    member="$("${CROSS_PREFIX}ar" t "${lib}" 2>/dev/null | head -n 1 || true)"
    if [ -z "${member}" ]; then
        return 1
    fi
    rm -f "${WORK_DIR}/${member}"
    (
        cd "${WORK_DIR}" &&
        "${CROSS_PREFIX}ar" x "${lib}" "${member}" &&
        "${CROSS_PREFIX}readelf" -h "${member}" 2>/dev/null | grep -q "AArch64"
    )
}

# ---- 2) alsa-lib：静态 libasound.a（HAVE_ALSA） -----------------------------
ALSA_PREFIX="${THIRDPARTY_DIR}/alsa"
ALSA_OK=0
if [ -f "${ALSA_PREFIX}/lib/libasound.a" ]; then
    log "alsa-lib 产物已存在，跳过：${ALSA_PREFIX}"
    ALSA_OK=1
else
    log "交叉编译 alsa-lib ${ALSA_VERSION} ..."
    ALSA_SRC="${WORK_DIR}/alsa-lib-${ALSA_VERSION}"
    ALSA_TARBALL="${WORK_DIR}/alsa-lib-${ALSA_VERSION}.tar.bz2"
    rm -rf "${ALSA_SRC}"
    if download "${ALSA_TARBALL}" \
        "https://github.com/alsa-project/alsa-lib/releases/download/v${ALSA_VERSION}/alsa-lib-${ALSA_VERSION}.tar.bz2" \
        "https://www.alsa-project.org/files/pub/lib/alsa-lib-${ALSA_VERSION}.tar.bz2" &&
        tar -xjf "${ALSA_TARBALL}" -C "${WORK_DIR}"; then
        # -fPIC：静态库将链入 libjsapi.so 的硬性要求
        # --with-configdir：运行 snd_pcm_open("default") 需要 /usr/share/alsa/alsa.conf（笔端 buildroot 标准路径）
        if (
            cd "${ALSA_SRC}" &&
            CC="${CC}" CXX="${CXX}" \
                CFLAGS="-fPIC -Os -ffunction-sections -fdata-sections" \
                ./configure \
                --host=aarch64-buildroot-linux-gnu \
                --prefix="${ALSA_PREFIX}" \
                --enable-static=yes \
                --enable-shared=no \
                --disable-python \
                --disable-nls \
                --disable-topology \
                --with-configdir=/usr/share/alsa &&
            make -j"${BUILD_THREADS}" &&
            make install
        ); then
            if [ -f "${ALSA_PREFIX}/lib/libasound.a" ]; then
                if verify_aarch64_archive "${ALSA_PREFIX}/lib/libasound.a"; then
                    ALSA_OK=1
                    log "alsa-lib 完成：${ALSA_PREFIX}"
                else
                    warn "libasound.a 架构校验失败（非 aarch64 产物）"
                fi
            else
                warn "make install 后未找到 ${ALSA_PREFIX}/lib/libasound.a"
            fi
        else
            log_tail "${ALSA_SRC}/config.log"
            warn "alsa-lib 交叉编译失败，本次产物不含 ALSA 音频输出（HAVE_ALSA 不开启，运行时回退 NullAudioSink）"
        fi
    else
        warn "alsa-lib 源码下载失败，跳过（HAVE_ALSA 不开启）"
    fi
fi

# ---- 3) ffmpeg：静态 .a（HAVE_FFMPEG） --------------------------------------
FFMPEG_PREFIX="${THIRDPARTY_DIR}/ffmpeg"
FFMPEG_OK=0
if [ -f "${FFMPEG_PREFIX}/lib/libavcodec.a" ]; then
    log "ffmpeg 产物已存在，跳过：${FFMPEG_PREFIX}"
    FFMPEG_OK=1
else
    log "交叉编译 ffmpeg ${FFMPEG_VERSION} ..."
    FFMPEG_SRC="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}"
    FFMPEG_TARBALL="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}.tar.xz"
    rm -rf "${FFMPEG_SRC}"
    SRC_READY=0
    if download "${FFMPEG_TARBALL}" \
        "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
        "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n${FFMPEG_VERSION}.tar.gz"; then
        if mkdir -p "${FFMPEG_SRC}" && tar -xf "${FFMPEG_TARBALL}" -C "${FFMPEG_SRC}" --strip-components=1; then
            SRC_READY=1
        else
            warn "ffmpeg tarball 解压失败（可能是备用源格式不同）"
        fi
    fi
    if [ "${SRC_READY}" = "0" ]; then
        log "tarball 不可用，回退 git clone（GitHub 镜像 -> 官方仓库）"
        if git clone --depth 1 --branch "n${FFMPEG_VERSION}" \
            https://github.com/FFmpeg/FFmpeg.git "${FFMPEG_SRC}"; then
            SRC_READY=1
        else
            rm -rf "${FFMPEG_SRC}"
            if git clone --depth 1 --branch "n${FFMPEG_VERSION}" \
                https://git.ffmpeg.org/ffmpeg.git "${FFMPEG_SRC}"; then
                SRC_READY=1
            fi
        fi
    fi
    if [ "${SRC_READY}" = "1" ]; then
        # 与 tools/build_ffmpeg_x7.sh 同源，另加：hevc 解码/解析、--enable-pthreads
        CONFIGURE_FLAGS=(
            --prefix="${FFMPEG_PREFIX}"
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
            --enable-pthreads
            --enable-swresample
            --enable-swscale
            --enable-decoder=h264,hevc,aac,mp3,flac
            --enable-demuxer=mov,mp3,flac
            --enable-parser=h264,hevc,aac
            --enable-protocol=file
            --enable-encoder=mjpeg
            --enable-bsf=aac_adtstoasc
            --disable-asm
            --extra-cflags="-fPIC -Os -ffunction-sections -fdata-sections"
            --extra-ldflags="-Wl,--gc-sections"
        )
        if (
            cd "${FFMPEG_SRC}" &&
            ./configure "${CONFIGURE_FLAGS[@]}" &&
            make -j"${BUILD_THREADS}" &&
            make install
        ); then
            FFMPEG_LIBS_OK=1
            for lib in libavcodec libavformat libavutil libswresample libswscale; do
                f="${FFMPEG_PREFIX}/lib/${lib}.a"
                if [ ! -f "${f}" ]; then
                    warn "缺少产物 ${f}"
                    FFMPEG_LIBS_OK=0
                elif ! verify_aarch64_archive "${f}"; then
                    warn "${lib}.a 架构校验失败（非 aarch64 产物）：${f}"
                    FFMPEG_LIBS_OK=0
                fi
            done
            if [ "${FFMPEG_LIBS_OK}" = "1" ]; then
                FFMPEG_OK=1
                log "ffmpeg 完成：${FFMPEG_PREFIX}"
            fi
        else
            log_tail "${FFMPEG_SRC}/ffbuild/config.log"
            log_tail "${FFMPEG_SRC}/config.log"
            warn "ffmpeg 交叉编译失败，本次产物不含视频软解（HAVE_FFMPEG 不开启，Media 保持运行时报错现状）"
        fi
    else
        warn "ffmpeg 源码获取失败，跳过（HAVE_FFMPEG 不开启）"
    fi
fi

# ---- 4) 汇总：生成 build.sh 的 EXTRA_CMAKE_FLAGS 与摘要 ---------------------
FLAGS=""
if [ "${FFMPEG_OK}" = "1" ]; then
    FLAGS="${FLAGS} -DHAVE_FFMPEG=ON"
fi
if [ "${ALSA_OK}" = "1" ]; then
    FLAGS="${FLAGS} -DHAVE_ALSA=ON"
fi
printf '%s\n' "${FLAGS}" >"${FLAGS_FILE}"

if [ "${FFMPEG_OK}" = "1" ]; then
    printf 'ffmpeg : OK    (HAVE_FFMPEG=ON)\n' >>"${SUMMARY_FILE}"
else
    printf 'ffmpeg : FAILED (HAVE_FFMPEG off, run continues)\n' >>"${SUMMARY_FILE}"
fi
if [ "${ALSA_OK}" = "1" ]; then
    printf 'alsa   : OK    (HAVE_ALSA=ON)\n' >>"${SUMMARY_FILE}"
else
    printf 'alsa   : FAILED (HAVE_ALSA off, run continues)\n' >>"${SUMMARY_FILE}"
fi

cat "${SUMMARY_FILE}"
log "EXTRA_CMAKE_FLAGS ='${FLAGS}'"

if [ "${FFMPEG_OK}" = "0" ]; then
    warn "!!!! ffmpeg 未构建成功：CI 产物将不含视频播放能力（用户硬性要求视频功能必须实现），请检查上方日志 !!!!"
fi
log "结束（尽力而为模式：单项失败不阻断流水线）"
exit 0
