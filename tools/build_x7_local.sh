#!/bin/bash
# X7 本地一键构建（在 WSL/Ubuntu 中执行）：环境校验 → 依赖安装 → 补丁 → 工具链/版本信息就位 → ./tools/build.sh -a
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOOLCHAIN_NAME="aarch64--glibc--stable-2018.11-1"
TOOLCHAIN_URL="https://github.com/penosext/Cloudpan/releases/download/toolchains/${TOOLCHAIN_NAME}.tar.bz2"
VERSIONINFO_NAME="X7versionInfo.tar.gz"
VERSIONINFO_URL="https://github.com/penosext/Cloudpan/releases/download/PenX7/${VERSIONINFO_NAME}"

# 缺失命令收集，最后统一报告
MISSING=()

need() {
    if ! command -v "$1" >/dev/null 2>&1; then
        MISSING+=("$1")
    fi
}

need git
need cmake
need make
need node
need pnpm
need iconv
need bzip2
need wget

# Node 主版本须 ≥ 18
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
        MISSING+=("node18+(当前 $(node -v))")
    fi
fi

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "[ERROR] 以下依赖缺失或版本不满足，请先安装后再运行：" >&2
    printf '  - %s\n' "${MISSING[@]}" >&2
    echo "参考（Ubuntu/WSL）: sudo apt install -y git cmake make build-essential bzip2 wget libc-bin && corepack enable && corepack prepare pnpm@latest-10 --activate" >&2
    exit 1
fi

echo "[INFO] 依赖检查通过，开始安装 ui 依赖..."
pnpm install -C ./ui

echo "[INFO] 应用 aiot-vue-cli Node 兼容补丁（幂等）..."
bash tools/patch-ui.sh

# 工具链就位：优先解压仓库根自带 tar.bz2（保持符号链接完整性），其次复制已解压目录，最后联网下载
mkdir -p jsapi/toolchains
TOOLCHAIN_CONTENTS="$(ls -A jsapi/toolchains | grep -v '^\.gitkeep$' || true)"
if [ -z "$TOOLCHAIN_CONTENTS" ]; then
    if [ -f "$ROOT/${TOOLCHAIN_NAME}.tar.bz2" ]; then
        echo "[INFO] 从仓库根解压工具链 tar.bz2..."
        tar -xjf "$ROOT/${TOOLCHAIN_NAME}.tar.bz2" -C jsapi/toolchains
    elif [ -d "$ROOT/${TOOLCHAIN_NAME}" ]; then
        echo "[INFO] 复制仓库根已解压工具链目录..."
        cp -a "$ROOT/${TOOLCHAIN_NAME}" jsapi/toolchains/
    else
        echo "[INFO] 联网下载工具链..."
        wget -q "$TOOLCHAIN_URL" -O "jsapi/toolchains/${TOOLCHAIN_NAME}.tar.bz2"
        tar -xjf "jsapi/toolchains/${TOOLCHAIN_NAME}.tar.bz2" -C jsapi/toolchains
    fi
else
    echo "[INFO] jsapi/toolchains 已有内容，跳过工具链准备"
fi

# 版本信息就位：versionInfo 包内含 jsapi 需要的 include/ lib/ 等头文件与库
if [ ! -d jsapi/include ] && [ ! -d jsapi/lib ]; then
    if [ -f "$ROOT/${VERSIONINFO_NAME}" ]; then
        echo "[INFO] 从仓库根解压 ${VERSIONINFO_NAME}..."
        tar -xf "$ROOT/${VERSIONINFO_NAME}" -C jsapi
    else
        echo "[INFO] 联网下载 ${VERSIONINFO_NAME}..."
        wget -q "$VERSIONINFO_URL"
        tar -xf "$VERSIONINFO_NAME" -C jsapi
    fi
else
    echo "[INFO] jsapi 已有 versionInfo 产物，跳过解压"
fi

# 设备型号替换（模板若无 update 页则跳过）
if [ -f ui/src/pages/update/update.ts ]; then
    sed -i "s/const DEVICE_MODEL = 'a6p'/const DEVICE_MODEL = 'x7'/" ui/src/pages/update/update.ts
else
    echo "[INFO] ui/src/pages/update/update.ts 不存在，跳过 DEVICE_MODEL 替换"
fi

# CMake 依赖补丁（CMAKE_DEPEND_INFO_SKIP / CMAKE_LINK_DEPENDS_USE_LINKER），模板已内置则跳过
if ! grep -q 'CMAKE_DEPEND_INFO_SKIP' jsapi/CMakeLists.txt; then
    sed -i '/project(/a\set(CMAKE_DEPEND_INFO_SKIP 1)\nset(CMAKE_LINK_DEPENDS_USE_LINKER 0)' jsapi/CMakeLists.txt
else
    echo "[INFO] jsapi/CMakeLists.txt 已含 CMAKE 依赖补丁，跳过"
fi

echo "[INFO] 开始构建..."
./tools/build.sh -a

echo "[INFO] 构建完成，.amr 产物见 ui/ 与 dist/ 目录"
