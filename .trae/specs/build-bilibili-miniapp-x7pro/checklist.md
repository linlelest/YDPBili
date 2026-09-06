# Checklist

## 环境与构建
- [ ] 用户已确认环境齐备：WSL2 Ubuntu、git、cmake、make、Node 18、pnpm@latest-10、iconv、bzip2、Windows 侧 adb、词典笔 ADB 已开启并授权
- [ ] 工具链 aarch64--glibc--stable-2018.11-1 与 X7versionInfo.tar.gz 成功下载解压至 jsapi/ 对应目录
- [ ] aiot-vue-cli Node18 兼容 sed 补丁已应用且 pnpm install 通过
- [ ] `./tools/build.sh -a` 成功产出 miniapp.amr
- [ ] （可选）GitHub Actions X7 工作流构建成功

## 技术验证（Task 1）
- [ ] jsapi 能力清单已确认（Fetch 自定义头/Cookie、storage、既有媒体能力）
- [ ] 播放方案决策已定且至少一条路径有 PoC 证据（系统播放器/软解/仅音频）
- [ ] ffmpeg 交叉编译产物可用（若采用软解方案）
- [ ] falcon 横向滑动手势或降级按钮方案已确认
- [ ] 二维码渲染方案已确认

## 基础设施（Task 2）
- [x] http.js 统一封装（UA/Cookie/错误码）生效（笔端联调待真机验证 UA/Cookie 透传）
- [x] wbi.js 签名与 nav 接口实测 code=0（签名已过官方文档固定向量测试与 crypto 对拍；nav 真机实测待笔端）
- [x] auth.js 会话持久化与 buvid3 获取生效（Set-Cookie 提取依赖真机头透传，UUIDv4 兜底已内置）
- [x] 9 个业务 API 模块封装完成（recommend/search/view/playurl/related/article/dynamic/history/nav）
- [x] （Task 2 附加）env.js custom.fetch 封装、settings.js、theme.less、5 个共享组件、11 页路由注册与骨架

## 页面功能
- [ ] 登录页：二维码展示、轮询四态处理、过期自动换码、成功后会话持久化并跳转
- [ ] 主页：推荐卡片展示、横向滑动（或按钮降级）翻页、末尾自动分页、点击跳转
- [ ] 搜索页：关键词输入、buvid3 就绪、视频/图文分类结果、分页、点击跳转
- [ ] 视频详情页：详情/统计/简介/分P/相关推荐渲染，分P切换，播放入口
- [ ] 视频播放器页：按默认解码器+画质成功取流播放，暂停/进度/倍速/画质/退出可用
- [ ] 刷视频页：左右滑动切换上/下一条、自动连播、末尾自动加载、断点恢复
- [ ] 我的页：未登录引导、已登录展示头像/昵称/等级、两个子页入口
- [ ] 动态页：动态流列表、分页、点击进入详情
- [ ] 历史记录页：历史列表、分页、点击回看
- [ ] 文章详情页：正文+图片自适应渲染、可滚动
- [ ] 设置页：默认画质/倍速/解码器可改且持久化，清除缓存、退出登录、关于

## 全局约定
- [ ] 所有 Task 执行前均完成 ≥2 轮联网搜索并在总结中记录结论
- [ ] UI 全部按 280×936 竖屏适配、深色主题、大触控热区
- [x] 无硬编码密钥/密码；会话 Cookie 仅存本地 storage（grep 全仓硬编码密钥值 0 命中；会话仅存 auth.js storage key bilibili_session）

## 交付
- [ ] 真机 adb push + miniapp_cli install 安装成功
- [ ] 按 9 个页面逐项真机回归通过
- [ ] 最终 .amr 构建产物路径已告知用户
