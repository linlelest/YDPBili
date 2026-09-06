# 有道词典笔 X7 Pro 第三方 B 站客户端（Bilibili Miniapp）Spec

## Why
有道词典笔 X7 Pro（4.1 英寸竖屏 280×936，AArch64 glibc）没有官方 B 站应用。社区已有成熟的 miniapp 开发框架（`penosext/miniapp-template`，Vue 前端 + C++ JSAPI 后端，构建产物 `.amr`，通过 `miniapp_cli` 安装），以及公开的 B 站接口社区文档（SocialSisterYi/bilibili-API-collect 等）。本规格定义在 X7 Pro 上开发一个第三方 B 站客户端的完整需求。

## 环境前置条件（用户需在开工前全部安装）
**本节是硬性门槛：以下环境不齐备则 Task 0 无法开始。**

### 本机构建环境（Windows 用户，强烈推荐 WSL2 + Ubuntu 22.04/24.04）
- WSL2 + Ubuntu（构建脚本 `tools/build.sh` 依赖 bash 环境）
- 在 WSL Ubuntu 内安装：`git`、`wget`、`bzip2`、`tar`、`cmake >= 3.10`、`make`、`g++`、`iconv`（glibc 自带，缺则 `apt install libc-bin`）、`Node.js 18`、`pnpm@latest-10`（`npm install -g pnpm@latest-10`）
- Windows 侧安装：`adb`（Android platform-tools），用于连接词典笔与部署
- 硬件：USB 数据线；词典笔已开启 ADB（可用 PenUniverse/paper 工具或参考 PenUniverse Discussions），并能通过 `adb shell auth` 完成授权

### 设备相关物料（脚本会自动下载，无需手动准备，仅列出来源）
- 工具链：`https://github.com/penosext/Cloudpan/releases/download/toolchains/aarch64--glibc--stable-2018.11-1.tar.bz2`（解压至 `jsapi/toolchains/`）
- X7 版本信息包：`https://github.com/penosext/Cloudpan/releases/download/PenX7/X7versionInfo.tar.gz`（解压至 `jsapi/`）
- 笔端自带 `miniapp_cli`（用于 `miniapp_cli install /userdisk/Favorite/miniapp.amr`）

### 可选替代构建方式
- 不装 WSL 也可使用 GitHub Actions 云端构建（项目将包含 X7 构建工作流，产物为 `.amr` Artifact），但真机部署仍需 Windows 侧 adb

## What Changes
- 以 `penosext/miniapp-template` 为骨架在本仓库初始化项目，并把 `penosext/miniapp` 的 `build_for_x7.yml` 移植为本项目的 X7 构建支持（工具链/版本信息下载、aiot-vue-cli Node18 兼容 sed 补丁、`DEVICE_MODEL='x7'`、`./tools/build.sh -a`）
- 新增 JS 服务层：B 站 HTTP 客户端（自定义 UA/Cookie）、WBI 签名（纯 JS MD5 + mixinKeyEncTab + 密钥缓存）、会话管理（SESSDATA/bili_jct/DedeUserID 持久化）、各业务 API 模块
- 新增页面（app.json 注册）：登录页、主页（推荐流，横向滑动）、搜索页、视频播放器页、视频详情页、文章详情页、我的页（含动态页、历史记录页）、设置页、刷视频页（左右滑动切换上/下一条）
- 按需扩展 C++ JSAPI（仅在 JS 层能力不足时）：Fetch 支持自定义请求头/Cookie、媒体播放能力（音频/视频，取决于 Task 1 技术验证结论）
- 设置项持久化：默认视频画质（qn）、默认倍速、默认解码器

### 关键技术风险与降级链（视频播放）
falcon miniapp 运行时无现成视频播放组件，必须先做技术验证（Task 1），按以下优先级落地：
1. **系统/原生播放路径**：探查 iot-miniapp-sdk / 系统能力是否可调起音频或视频播放器
2. **软解方案**：交叉编译 ffmpeg（aarch64 glibc 2018.11 工具链）进 jsapi，C++ 新增 Media JSAPI；视频画面优先尝试低分辨率（360P/240P）低帧率渲染到 UI（falcon image 组件逐帧刷新等可行路径）
3. **音频模式（兜底，必然可用性最高）**：仅播放 B 站 DASH 音频流（64K/132K AAC）+ 封面/文案展示
- 设置页"默认解码器"的选项集合以 Task 1 验证结论为准（如：软解 / 仅音频 / 系统播放器）
- 若三条路径全部不可行，暂停实现并向用户报告

## Impact
- Affected specs：无既有 spec（全新项目）
- Affected code：
  - 仓库根：克隆模板后的 `jsapi/`、`ui/`、`tools/`、`aiot-vue-cli/`、`.github/workflows/`
  - 主要新增：`ui/src/pages/`（9 个页面）、`ui/src/services/`（API 层）、`ui/src/components/`（通用组件）、`jsapi/src/`（可能的 Fetch/Media 扩展）
  - 构建：`tools/build.sh`（X7 适配）、`.github/workflows/build_for_x7.yml`

## 接口清单（基于社区文档，实现时须再次联网核实）
| 用途 | 接口 | 鉴权/签名 |
|---|---|---|
| WBI 密钥获取 | `GET https://api.bilibili.com/x/web-interface/nav` 的 `data.wbi_img` | 无 |
| 二维码申请 | `GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate` | 无 |
| 二维码轮询 | `GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=` | 成功后从 Set-Cookie 取 SESSDATA/bili_jct/DedeUserID |
| 推荐流 | `GET https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?ps=&refresh_index=` | WBI + Cookie |
| 综合搜索 | `GET https://api.bilibili.com/x/web-interface/wbi/search/all/v2?keyword=` | WBI + Cookie(buvid3)；先 GET 一次 bilibili.com 取 buvid3，避免 -412 |
| 视频详情 | `GET https://api.bilibili.com/x/web-interface/wbi/view?bvid=` | WBI（pages→cid） |
| 相关视频 | `GET https://api.bilibili.com/x/web-interface/archive/related?bvid=` | 无 |
| 取流 | `GET https://api.bilibili.com/x/player/wbi/playurl?bvid=&cid=&qn=&fnval=&platform=html5&try_look=1` | WBI；fnval=1(MP4)/16(DASH)；未登录 try_look 可取 720P |
| 文章详情 | Opus/Article 详情接口（实现时联网核实最新端点，如 `/x/polymer/web-polymer/opus/detail`） | 无/Cookie |
| 动态流 | `GET https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all` | Cookie（端点需核实） |
| 历史记录 | `GET https://api.bilibili.com/x/web-interface/history/cursor?ps=` | Cookie（端点需核实） |
| 用户信息 | `GET https://api.bilibili.com/x/web-interface/nav` | Cookie(SESSDATA) |
- 图片直连 `i0.hdslb.com` 等 CDN；视频流 URL 有效期 120 分钟
- WBI 签名：`wts`+参数排序+`mixin_key`（img_key+sub_key 按 mixinKeyEncTab 重排取前 32 位）→ MD5 得 `w_rid`

## ADDED Requirements

### Requirement: 项目脚手架与 X7 构建链
系统 SHALL 以 miniapp-template 为基础在本仓库完成初始化，并移植 X7 构建配置，使 `./tools/build.sh -a` 在 WSL Ubuntu 中产出可安装的 `miniapp.amr`。

#### Scenario: 本地构建成功
- **WHEN** 用户在 WSL Ubuntu 中执行完整构建流程（pnpm install、sed 补丁、toolchain/versionInfo 就位、`./tools/build.sh -a`）
- **THEN** 产出 `.amr` 文件且无报错，可被 `adb push` 至笔端并通过 `miniapp_cli install` 安装成功

### Requirement: 登录页
系统 SHALL 提供二维码扫码登录：展示 B 站登录二维码（纯 JS 编码生成二维码矩阵并渲染）、每 2 秒轮询登录状态（86038 失效/86090 已扫未确认/86101 未扫码/0 成功），成功后持久化 SESSDATA、bili_jct、DedeUserID、refresh_token；已登录时展示用户信息（nav 接口）与退出登录。

#### Scenario: 扫码登录成功
- **WHEN** 用户用手机 B 站 App 扫描笔上二维码并确认
- **THEN** 笔端轮询得到 code=0，会话 Cookie 被持久化，页面跳转并显示已登录状态

#### Scenario: 二维码过期
- **WHEN** 二维码超过 180 秒未被确认（poll 返回 86038）
- **THEN** 页面提示失效并自动重新申请新二维码

### Requirement: 主页（推荐页）
系统 SHALL 提供推荐流页面：调用推荐接口加载视频卡片（封面、标题、UP 主、播放量），支持**横向滑动**浏览（若 falcon 触摸手势受限，降级为左右箭头按钮翻页）、下拉/按钮刷新、点击卡片进入视频详情或直接播放；未登录时可用（try_look/无 Cookie 推荐降级）。

#### Scenario: 横向滑动浏览推荐
- **WHEN** 用户在主页向左/向右滑动
- **THEN** 展示上/下一张推荐卡片；到达已加载列表末尾时自动请求下一页

### Requirement: 搜索页
系统 SHALL 提供搜索页：关键词输入（复用/参考 miniapp 软键盘或 IME JSAPI），结果分"视频/图文"两类展示与切换，支持分页加载；请求前自动获取并持久化 buvid3，携带 WBI 签名。

#### Scenario: 搜索视频
- **WHEN** 用户输入关键词并触发搜索
- **THEN** 展示视频结果列表（封面/标题/UP/时长），点击可进入视频详情页

### Requirement: 视频播放器页
系统 SHALL 提供视频播放器页：按设置页的默认解码器与默认画质取流播放（含音频），支持暂停/继续、进度显示与拖动、倍速切换（含设置默认倍速）、画质切换（受账号权限约束）、退出返回；播放链路遵循 Task 1 验证结论的降级链，且在仅音频模式下展示封面+标题+进度。

#### Scenario: 播放一个视频
- **WHEN** 用户从视频详情页点击播放
- **THEN** 播放器按默认解码器/画质开始播放，UI 显示进度条与控制按钮

#### Scenario: 切换倍速
- **WHEN** 用户在播放器中点击倍速并选择 1.5x
- **THEN** 播放速度变为 1.5 倍，且该选择可被保存为默认倍速（在设置页）

### Requirement: 视频详情页
系统 SHALL 提供视频详情页：展示标题、UP 主、发布时间、播放/弹幕/点赞等统计、简介、分 P 列表（切换 cid）、相关推荐列表（archive/related），提供"播放""刷视频页连播"入口。

#### Scenario: 查看分 P 并播放
- **WHEN** 用户在多 P 视频详情页选择第 2 个分 P 并点击播放
- **THEN** 播放器以该分 P 的 cid 取流并播放

### Requirement: 文章详情页
系统 SHALL 提供图文（专栏/Opus）详情页：拉取文章正文，按纯文本+图片的自适应布局渲染（280px 宽，字号适配笔屏），支持滚动阅读与返回。

#### Scenario: 阅读文章
- **WHEN** 用户从搜索结果或动态进入文章详情页
- **THEN** 正文与配图按序渲染，可上下滚动阅读

### Requirement: 我的页（含动态页、历史记录页）
系统 SHALL 提供"我的"页：未登录引导跳转登录页；已登录展示头像/昵称/等级（nav 接口），并提供两个子页面入口：
- **动态页**：调用动态接口展示关注 UP 的动态流（视频/图文卡片），点击进入对应详情
- **历史记录页**：调用历史接口按时间倒序展示观看历史，支持分页加载与点击回看

#### Scenario: 查看历史记录
- **WHEN** 已登录用户打开历史记录页
- **THEN** 展示近期观看记录列表，点击某条可跳转到该视频详情页

### Requirement: 设置页
系统 SHALL 提供设置页并持久化以下配置（`$falcon.jsapi.storage` 或 Database）：
- 默认视频画质：360P/480P/720P/1080P（qn 16/32/64/80，受登录与大会员约束时自动降级到可用最高档）
- 默认倍速：0.5x/0.75x/1.0x/1.25x/1.5x/2.0x
- 默认解码器：选项集合以 Task 1 验证结论为准（候选：软解/仅音频/系统播放器）
- 附加：清除缓存、退出登录、关于页（版本与开源致谢）

#### Scenario: 修改默认画质
- **WHEN** 用户在设置页选择 480P 并返回
- **THEN** 之后所有新开播放默认请求 qn=32，重启应用后配置仍生效

### Requirement: 刷视频页
系统 SHALL 提供类抖音的连播页：以推荐流为数据源，**左右滑动**切换上一条/下一条视频并自动播放，可无限继续（列表末尾自动追加下一页）；每条展示标题/UP 主；退出前记录断点。

#### Scenario: 连续刷视频
- **WHEN** 用户在刷视频页连续向左滑动
- **THEN** 依次自动播放下一条视频，滑到列表末尾自动加载更多

### Requirement: 全局约定
- 每个 Task（含子助手）开工前 MUST 至少进行两轮联网搜索并核实所用接口/技术细节
- 屏幕适配以 280×936 竖屏为唯一目标；深色主题、大号触控热区、单手可及
- 所有网络请求走统一 JS 服务层（UA、Cookie、WBI、错误码 -412/-101 统一处理）
- 会话与设置 MUST 持久化；视频流 URL 不缓存跨会话使用

## MODIFIED Requirements
（无——全新项目，无既有需求被修改）

## REMOVED Requirements
（无）

---

# v2 增量需求（用户 2026-09 补充，已批准）

## ADDED Requirements

### Requirement: 视频画面播放（硬性）
视频功能 SHALL 落地真实画面渲染：GitHub Actions 构建时交叉编译 ffmpeg（H.264/AAC 解码）与 alsa-lib，开启 `HAVE_FFMPEG=ON`/`HAVE_ALSA=ON` 编入 Media JSAPI；播放器按降级链输出视频帧（falcon image base64 刷新），宿主 `<video>` 可用则优先。

#### Scenario: 播放含画面的视频
- **WHEN** 用户播放任意视频
- **THEN** 播放器按解码器设置输出画面（软解帧或系统 video 组件），且音频可听；不可用时明确提示降级原因

### Requirement: 拼音输入软键盘
搜索页软键盘 SHALL 支持拼音输入：字母键盘 + 候选栏（拼音串匹配候选汉字/词，按频度排序，点击候选上屏），并支持大小写字母、空格、退格、确认与常见符号面板。

#### Scenario: 拼音输入中文
- **WHEN** 用户键入 `bilibili` 或 `bzhan`
- **THEN** 候选栏出现对应汉字/词（如 哔哩哔哩/B站），点击候选追加到输入框

### Requirement: 评论区页
系统 SHALL 提供评论区页：按 aid/type=1 拉取评论列表（热评/最新，分页），显示头像/昵称/等级/内容/点赞数/时间；登录用户可发送新评论（POST reply/add，csrf=bili_jct），未登录提示并引导登录；视频详情页提供"评论区"入口按钮（含评论数）。

#### Scenario: 发送评论
- **WHEN** 已登录用户在评论区输入内容并点发送
- **THEN** 接口返回 code=0，新评论出现在列表顶部；失败（12002 关闭/12016 敏感词等）显示对应文案

### Requirement: 用户主页
系统 SHALL 提供用户主页（userSpace）：展示头像、用户名、简介、等级、粉丝/关注数，提供三个 Tab：视频（/x/space/wbi/arc/search，wbi 签名分页）、专栏（/x/space/article 分页）、动态（feed/space 端点，不可用则降级提示）；视频详情页创作者头像/昵称可点击进入其主页。

### Requirement: 视频互动（点赞/投币/关注）
视频详情页 SHALL 提供点赞、投币（1/2 币）、关注按钮：调用 like/coin/add/relation/modify（均带 csrf），页面加载时查询已有状态（has/like、coins、relation）回显；未登录点击引导登录。

### Requirement: 播放器字幕
播放器 SHALL 支持外挂字幕：调 `/x/player/wbi/v2` 获取字幕轨道（AI 字幕 + 创作者 CC 字幕，含多语言），支持开关与语言切换，按播放进度渲染当前字幕句于画面下方字幕条；未登录时轨道为空则提示。

### Requirement: 播放器弹幕
播放器 SHALL 支持弹幕：拉取弹幕（XML list.so 优先，protobuf seg.so 手写解码降级），顶部/滚动弹幕带简化渲染（同屏上限保护），支持开关；设置页支持弹幕默认开关与弹幕字体大小，播放器实时生效。

## MODIFIED Requirements

### Requirement: 搜索页（v2）
搜索结果 SHALL 提供"视频/专栏/用户"三个分类 Tab（搜索关键词后可切换）：视频→视频详情、专栏→文章详情、用户→用户主页；分页独立维护。

### Requirement: 设置页（v2）
在原有画质/倍速/解码器之上增加：弹幕默认开关、弹幕字体大小（小/标准/大）；持久化并被播放器读取。

## Impact（v2）
- 新增页面：userSpace、comments（app.json 已注册）
- 新增服务：api/space.js、api/reply.js、api/interaction.js、api/subtitle.js、api/danmaku.js、utils/pinyin（词库+引擎）
- 修改：search 页（三分类）、soft-keyboard（拼音）、videoDetail（互动+入口+创作者跳转）、player（字幕+弹幕层）、settings（弹幕项）、services/settings.js（新字段）
- CI：build_for_x7.yml 增加 ffmpeg + alsa 交叉编译步骤并开启 HAVE_FFMPEG/HAVE_ALSA
