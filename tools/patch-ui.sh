#!/bin/bash
# 固化自 penosext/miniapp .github/workflows/build_for_x7.yml 中
# 针对 aiot-vue-cli 的 6 条 Node 兼容 sed 补丁，幂等可重复执行。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 定位 aiot-vue-cli：pnpm 安装后优先 ui/node_modules（link 指向仓库根同名包），否则直接用仓库根
if [ -d "$ROOT/ui/node_modules/aiot-vue-cli" ]; then
    CLI="$ROOT/ui/node_modules/aiot-vue-cli"
else
    CLI="$ROOT/aiot-vue-cli"
fi

log() { echo "[patch-ui] $*"; }

# patch_file <文件> <补丁前特征(grep -F)> <补丁后特征(grep -F)> <sed 表达式>
# 已应用（后特征命中）→ 跳过；未找到前特征 → 警告跳过；否则应用补丁
patch_file() {
    local file="$1" pre="$2" post="$3" sedexpr="$4"
    if [ ! -f "$file" ]; then
        log "跳过（文件不存在）: ${file#$ROOT/}"
        return 0
    fi
    if grep -qF -- "$post" "$file"; then
        log "已应用，跳过: ${file#$ROOT/}"
        return 0
    fi
    if ! grep -qF -- "$pre" "$file"; then
        log "警告：未找到补丁目标，跳过: ${file#$ROOT/}"
        return 0
    fi
    sed -i "$sedexpr" "$file"
    log "已补丁: ${file#$ROOT/}"
}

# 1. rollup 构建链注入 @rollup/plugin-typescript（TypeScript 页面编译必需）
patch_file \
    "$CLI/src/libs/rollup.config.js" \
    "commonjs()," \
    "require('@rollup/plugin-typescript')()" \
    "s/commonjs(),/commonjs(),require('@rollup\/plugin-typescript')(),/g"

# 2. falcon-vue-loader SFC 解析改用 @vue/compiler-sfc（pad: 'line' 分支）
patch_file \
    "$CLI/web-loaders/falcon-vue-loader/lib/parser.js" \
    "compiler.parseComponent(content, { pad: 'line' })" \
    "compiler.parse(content, { pad: 'line' }).descriptor" \
    "s/compiler.parseComponent(content, { pad: 'line' })/compiler.parse(content, { pad: 'line' }).descriptor/g"

# 3. cli-libs 模块表：vue-template-compiler 由本地 vue2 包改为 @vue/compiler-sfc
patch_file \
    "$CLI/cli-libs/index.js" \
    "path.resolve(__dirname, './vue/packages/vue-template-compiler/index.js')" \
    "'@vue/compiler-sfc'" \
    "s|path.resolve(__dirname, './vue/packages/vue-template-compiler/index.js')|'@vue/compiler-sfc'|g"

# 4. aiot-vue-cli 内部 SFC 解析（pad: true 分支）
patch_file \
    "$CLI/src/libs/parser.js" \
    "compiler.parseComponent(content, { pad: true })" \
    "compiler.parse(content, { pad: true }).descriptor" \
    "s/compiler.parseComponent(content, { pad: true })/compiler.parse(content, { pad: true }).descriptor/g"

# 5. 模板编译入口：compiler.compile → compiler.compileTemplate（非幂等，务必先检查后特征）
patch_file \
    "$CLI/web-loaders/falcon-vue-loader/lib/template-compiler/index.js" \
    "compiler.compile" \
    "compiler.compileTemplate" \
    "s/compiler.compile/compiler.compileTemplate/g"

# 6. rollup replace：defineComponent 置空，避免运行时引用被裁剪
patch_file \
    "$CLI/src/libs/rollup.config.js" \
    "const replaceValues = {}" \
    "const replaceValues = { 'defineComponent': '' }" \
    "s/const replaceValues = {}/const replaceValues = { 'defineComponent': '' }/g"

log "aiot-vue-cli 补丁流程完成（目录: ${CLI#$ROOT/}）"
