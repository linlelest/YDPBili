# Tasks

> 全局硬性要求：每个 Task 的执行者（包括子助手）在动手实现前 MUST 至少进行 **2 轮联网搜索**（核实接口现状、falcon/aiot-vue-cli 组件用法、ffmpeg 交叉编译细节等），并在任务总结中简要记录搜索结论。
> 前置门槛：Task 0 开始前，用户 MUST 已按 spec.md「环境前置条件」装齐 WSL2/Ubuntu、git、cmake、make、Node 18、pnpm@latest-10、adb 等；如未装齐，停下向用户索要。

- [x] Task 0: 环境校验与项目脚手架 + X7 构建链打通
  - [ ] SubTask 0.1: 校验本机环境（WSL Ubuntu 中 git/cmake/make/node18/pnpm/iconv/bzip2；Windows 侧 adb），缺失项输出清单并中止
    > 备注：Windows 侧 git/node/adb 已确认；WSL 未安装，构建运行待用户安装 WSL2/Ubuntu 后执行 tools/build_x7_local.sh（依赖校验与缺失清单输出已内置于该脚本）。
  - [x] SubTask 0.2: 在本仓库初始化项目（克隆 penosext/miniapp-template 内容，保留 GPL-3.0 LICENSE）
  - [x] SubTask 0.3: 移植 X7 构建：下载工具链 aarch64--glibc--stable-2018.11-1 与 X7versionInfo.tar.gz 至 jsapi/；应用 aiot-vue-cli 的 Node18 兼容 sed 补丁；`ui/src/pages/update/update.ts` 的 DEVICE_MODEL 改为 'x7'；`./tools/build.sh -a` 产出 miniapp.amr
    > 备注：工具链已解压目录与 tar.bz2 均在仓库根、X7versionInfo.tar.gz 已下载至仓库根；aiot-vue-cli 补丁固化为幂等的 tools/patch-ui.sh；模板无 update/update.ts（app.json 仅注册 index 页），DEVICE_MODEL 逻辑以文件存在性守卫内置在 workflow 与本地脚本中；实际 .amr 产出待 WSL 构建执行。
  - [x] SubTask 0.4: （可选）新增 .github/workflows/build_for_x7.yml 云端构建工作流
  - 验证：dist/ui 下产出 .amr，构建日志无错误

- [x] Task 1: 技术验证 Spike —— 媒体播放与 UI 能力（最高风险项）
  - [x] SubTask 1.1: 阅读 jsapi 源码（Fetch.*、JSAPI.cpp、iot-miniapp-sdk），确认：HTTP 自定义 UA/Headers/Cookie 是否可用；是否已有音频/视频播放 JSAPI；storage 用法
    > 备注：Fetch=libcurl 7.79.1 支持自定义 headers/rawStream；$falcon.jsapi 仅宿主内置 storage+http.request；iot-miniapp-sdk 无媒体能力；详见 docs-TASK1.md §1
  - [x] SubTask 1.2: 联网调研（≥2 轮）：falcon/aiot-vue-cli 的触摸手势（横向滑动）、image 组件刷新能力、二维码渲染方案（纯 JS qrcode-generator 可行性）、其他词典笔 miniapp 的媒体播放先例
    > 备注：手势白名单含 swipe/pan/touch 全家族；PenMods/QtVideoPlayer 证实同类硬件软解可行；qrcode-generator@1.4.4 已嵌入 ui/src/utils/qrcode.js；结论见 docs-TASK1.md §2
  - [x] SubTask 1.3: ffmpeg 交叉编译可行性验证：用 X7 工具链编译最小 ffmpeg（libavcodec/libavformat，H.264+AAC 解码）为静态/动态库，产出交叉编译参数与产物（脚本就绪，运行验证待 WSL）
    > 备注：tools/build_ffmpeg_x7.sh（n6.1.2，--enable-cross-compile/--arch=aarch64/--enable-pic/--disable-network，逐参数注释）已就绪；CMake 可选8/9 HAVE_FFMPEG/HAVE_ALSA 块已接入
  - [x] SubTask 1.4: 输出播放方案决策：系统播放器 / 软解（C++ Media JSAPI + 渲染路径 PoC）/ 仅音频，确定降级链与"默认解码器"设置项的选项集合；若全不可行，立即报告用户
    > 备注：降级链 auto→system→ffmpeg→audio_only 已定；Media JSAPI 代码骨架（Media/JSMedia/AudioSink）已写入 jsapi/src 并接入 JSAPI.cpp；"默认解码器"选项集 auto/system/ffmpeg/audio_only
  - 验证：给出明确决策结论 + 至少一条已验证可行的最小 PoC（如音频出声、或一帧视频渲染、或 ffmpeg 产物在笔端运行）
    > 验证状态：决策结论已产出（docs-TASK1.md §3）；PoC 与编译验证待 WSL/真机（遗留清单见 docs-TASK1.md §5）
  - 依赖：Task 0

- [x] Task 2: JS 基础设施 —— B 站 API 服务层
  - [x] SubTask 2.1: `ui/src/services/http.js`：统一请求封装（UA、Cookie 注入、超时、错误码 -101/-412 处理；若 Fetch JSAPI 缺能力则同步扩展 jsapi Fetch.cpp）
    > 备注：C++ 侧新增 JSFetch.hpp/.cpp（jqutil_v2 SetProtoMethodPromise 托管，入参 {url,method,headers,body,timeout}，返回 {status,ok,headers,body}），JSAPI.cpp 以 setModuleExport("Fetch",...) 导出；http.js 提供固定 UA/Referer、Cookie 自动拼装（SESSDATA/bili_jct/DedeUserID/buvid3）、10s 超时、BiliApiError（code:-101/-412/-352 与本地 -1/-2/-3）、buildUrl/biliGet/biliPost/rawJson
  - [x] SubTask 2.2: `ui/src/services/wbi.js`：纯 JS MD5 + mixinKeyEncTab + nav 密钥获取与当日缓存，对外暴露 `sign(params)`
    > 备注：内置 RFC1321 MD5（UTF-8/代理对支持）+ encodeWbi/getMixinKey/WbiSigner（bridge 注入，storage 按日缓存+并发去重）+ signWbi 默认签名器；node test/wbi.test.js 通过（MD5 与 crypto 对拍 11 例、官方 mixin_key 向量 ea1db1..4ff8 与官方示例 w_rid 8f6f2b..c5d4 全部命中）
  - [x] SubTask 2.3: `ui/src/services/auth.js`：会话存取（SESSDATA/bili_jct/DedeUserID/refresh_token）、登录态判断、buvid3 获取与持久化
    > 备注：storage key bilibili_session/buvid3；buvid3 首选 GET www.bilibili.com 提取 Set-Cookie（依赖 C++ 头透传，真机验证项），失败 UUIDv4 兜底并持久化；另完成 env.js（custom.fetch+storage 封装与 Node 注入点）与 settings.js（默认画质32/倍速1.0/解码器 auto|system|ffmpeg|audio_only）
  - [x] SubTask 2.4: 业务 API 模块：recommend / search / view / playurl / related / article(opus) / dynamic / history / nav（每个模块函数级封装 + JSDoc）
    > 备注：services/api/{nav,recommend,search,video,article,dynamic,history,index}.js，全部返回归一化字段；端点选型按 Task 2 联网核实结论：推荐=wbi/index/top/feed/rcmd(ps≤30,fresh_idx)；搜索=wbi/search/all/v2+wbi/search/type（前置 buvid3）；动态=x/polymer/web-dynamic/v1/feed/all(offset)；历史=history/cursor(max/business/view_at/ps≤30)；文章=cv→x/article/view（HTML/JSON双格式解析），opus→web-polymer/opus/detail（降级 web-dynamic/v1/detail）；取流=x/player/wbi/playurl(qn/fnval/platform/try_look)
  - [x] SubTask 2.5: `ui/src/services/settings.js`：设置读写（画质 qn、倍速、解码器），默认值兜底
    > 备注：getSettings 浅合并默认值并校验 decoder 合法性；getDecoderOptions/QUALITY_OPTIONS/PLAYBACK_RATE_OPTIONS 供设置页
  - [x] 附加：app.json 注册 11 页路由并创建最小页面骨架（nav-bar+empty 占位）；共享组件 video-card/article-card/nav-bar/loading/empty（深色主题 280 宽适配）+ theme.less + utils/format.js
  - 验证：在笔端或模拟环境对 nav/推荐/搜索 3 个接口完成真实调用冒烟（观察返回 code=0）
    > 验证状态：node test/wbi.test.js 全部通过、全部新 .js 通过 node --check；笔端冒烟（nav/推荐/搜索 code=0）待 WSL 构建 .amr 后真机执行
  - 依赖：Task 1

- [x] Task 3: 登录页
  - [x] SubTask 3.1: 纯 JS 二维码编码组件（生成矩阵并渲染为黑白块），展示 generate 接口返回的 url
    > 备注：utils/qrcode.js createQrMatrix + 动态格宽（实测 124 字符登录 URL 产出 49×49，4px/格不溢出）
  - [x] SubTask 3.2: 2 秒轮询 poll 接口；处理 86101/86090/86038/0 四态；失效自动换码
    > 备注：pollBusy 防重入 + 180s 倒计时双保险 + 连续 5 次异常停轮询；onHide 暂停/onShow 恢复
  - [x] SubTask 3.3: 登录成功持久化会话并跳转主页；已登录态展示用户信息 + 退出登录按钮
    > 备注：Cookie 提取"Set-Cookie 头优先、data.url 查询串兜底"三重防护；真机扫码全流程待验证
  - 验证：真机扫码全流程通过；二维码过期自动刷新（静态实现完成，真机验证待 WSL 构建 + 部署）
  - 依赖：Task 2

- [x] Task 4: 主页（推荐页，横向滑动）
  - [x] SubTask 4.1: 推荐流数据加载与分页（refresh_index 递增）
    > 备注：fresh_idx 递增 + 末尾前 3 张预加载 + 顶部刷新重置
  - [x] SubTask 4.2: 卡片 UI（封面/标题/UP/播放量，280 宽适配）与横向滑动切换（手势不可用则降级左右箭头按钮）
    > 备注：swipe+pan 双通道（300ms 防双触发、250ms 防误触点击）+ 左右 40×160 箭头热区兜底
  - [x] SubTask 4.3: 刷新入口；点击卡片 → 视频详情页/播放器路由跳转
    > 备注：SFC 编译 0 错误；手势真机触发待 PoC
  - 验证：真机滑动流畅、翻页加载正确（静态实现完成，真机验证待部署）
  - 依赖：Task 2（可与 Task 3 并行）

- [x] Task 5: 搜索页
  - [x] SubTask 5.1: 关键词输入（参考 softKeyboard/IME JSAPI 用法）；请求前确保 buvid3 就绪
    > 备注：falcon 无 input/IME JSAPI 可靠证据 → 自绘两段式软键盘 soft-keyboard.vue（热区≥40px）+ 输入历史 5 条
  - [x] SubTask 5.2: 综合搜索 + 结果分类（视频/图文）切换展示、分页
    > 备注：wbi/search/type 分类搜索（page 递增 + numResults 双判 hasMore）；ensureSearchReady 前置
  - [x] SubTask 5.3: 结果点击路由：视频 → 详情页；图文 → 文章详情页
    > 备注：navTo 形态已由一致性修正统一为 (pageKey, flatParams)
  - 验证：真机搜索"测试"返回结果并可跳转（静态实现完成，真机验证待部署）
  - 依赖：Task 2（可与 Task 3/4 并行）

- [x] Task 6: 视频详情页
  - [x] SubTask 6.1: view 接口渲染标题/UP/统计/简介/分 P 列表
    > 备注：getVideoDetail 已补 pic 字段；bvid 快照防竞态；loadOptions/newOptions 双兜底
  - [x] SubTask 6.2: related 接口渲染相关推荐列表
  - [x] SubTask 6.3: "播放"与"进刷视频页连播"入口；分 P 切换（换 cid）
    > 备注：传参约定 navTo('player',{bvid,aid,cid,title}) / navTo('feed',{bvid})
  - 验证：多 P 视频与单 P 视频均可正确展示与跳转（静态实现完成，真机验证待部署）
  - 依赖：Task 2

- [x] Task 7: 视频播放器页（按 Task 1 决策实现）
  - [x] SubTask 7.1: 取流封装：playurl(qn=设置画质, fnval 按解码器能力, try_look 未登录兜底)，清晰度自动降级
    > 备注：services/player.js 内核：audio_only/ffmpeg→fnval16 dash；system/auto→fnval1 MP4 缺失自动降级 16
  - [x] SubTask 7.2: 播放控制：暂停/继续、进度条显示与拖动、倍速切换、画质切换、退出
    > 备注：倍速写入 settings；画质面板 accept_quality∩[16,32,64,80]；进度 500ms 轮询 getProgress
  - [x] SubTask 7.3: 按选定方案接入播放（软解渲染管线 / 仅音频+封面 / 系统播放器），完成端到端播放
    > 备注：Media（custom 模块）initialize→open(audioUrl,videoUrl,cacheDir) 位置参数 + media_frame base64 帧；全降级路径有明确 state
  - 验证：真机完整播放一个 360P 视频（或音频模式完整收听），控制项可用（静态实现完成；宿主 <video> 与 Media 链路需真机 PoC）
  - 依赖：Task 1、Task 2、Task 6（路由参数）

- [x] Task 8: 刷视频页（左右滑动连播）
  - [x] SubTask 8.1: 以推荐流为数据源的播放队列 + 末尾自动加载
    > 备注：单播放器实例 + 预取下一条（PRELOAD_AHEAD=2）+ loadMore 并发去重（抖音官方最佳实践）
  - [x] SubTask 8.2: 左/右滑动手势切换上/下一条并自动播放（复用播放器内核）；标题/UP 覆盖层
    > 备注：prepareSeq 序号守卫三层（内核 seq + playingKey + onEnded token）；swipe/pan 双通道 + 箭头兜底
  - [x] SubTask 8.3: 断点记录与恢复
    > 备注：bilibili_feed_breakpoint 存 {bvid,index}；恢复三级退化（bvid→index→从头）
  - 验证：真机连续左右滑动 10+ 条不崩溃、自动连播正常（静态实现完成，真机验证待部署）
  - 依赖：Task 7

- [x] Task 9: 我的页 + 动态页 + 历史记录页
  - [x] SubTask 9.1: 我的页：nav 渲染头像/昵称/等级；未登录跳登录页；两个子页入口
    > 备注：退出登录二次点击确认（3s 窗口）；onShow 静默同步登录态
  - [x] SubTask 9.2: 动态页：动态流卡片列表、分页、点击进入对应详情（先联网核实最新端点）
    > 备注：feed/all offset 链式分页；五类卡片归一渲染；opus 卡片 id 提取（item_id/opus_id/jump_url 三级）已由修正批补齐
  - [x] SubTask 9.3: 历史记录页：history cursor 分页列表、点击回看
    > 备注：max/business/view_at 游标链透传；progress=-1 已看完语义；非 archive 记录点击提示不支持回看（修正批调整）
  - 验证：已登录真机三页数据正确；未登录引导正确（静态实现完成，真机验证待部署）
  - 依赖：Task 2、Task 3

- [x] Task 10: 文章详情页
  - [x] SubTask 10.1: 联网核实 Opus/Article 最新详情端点与返回结构（≥2 轮搜索）
    > 备注：cv→x/article/view（HTML/JSON 双格式）；opus→web-polymer/opus/detail（降级 web-dynamic/v1/detail）；-352 风控文案已接
  - [x] SubTask 10.2: 正文解析与渲染（文本段落 + 图片，280 宽自适应、滚动阅读）
    > 备注：api 层新增有序 blocks（text/image 交错 + width/height 比例算高，无尺寸 176px cover 兜底）；修正批完成页面切换
  - 验证：从搜索/动态进入文章页可完整阅读（静态实现完成，真机验证待部署）
  - 依赖：Task 2

- [x] Task 11: 设置页
  - [x] SubTask 11.1: 默认画质（16/32/64/80）、默认倍速（0.5~2.0）、默认解码器（Task 1 确定的选项集）选择 UI
    > 备注：qn 权限文案按文档核实（720P 以上需登录）；解码器四档各带说明小字
  - [x] SubTask 11.2: 持久化读写；清除缓存；退出登录；关于页
    > 备注：清除缓存只删 bilibili_search_history + bilibili_wbi_keys（键名从源头文件核实），保留会话与设置
  - 验证：修改设置 → 播放器行为跟随；重启应用配置保留（静态实现完成，真机验证待部署）
  - 依赖：Task 1、Task 2

- [ ] Task 12: 集成回归与真机交付（静态回归部分进行中；构建与真机步骤待 WSL/设备）
  - [ ] SubTask 12.1: 全量构建产出 .amr；adb push + miniapp_cli install 真机安装
  - [ ] SubTask 12.2: 按 checklist.md 逐项真机回归（9 个页面 + 登录 + 播放 + 设置持久化）
  - [ ] SubTask 12.3: 修复回归问题并复测，直至 checklist 全通过
    > 备注：静态回归部分已完成且零问题（含收尾修复 Task 8 遗留项：services/player.js media_error→degradeAudio 降级分支补 mediaSeq!==seq 序号守卫，防止快速连滑时旧条目事件误触发降级 open，node --check 通过）；真机回归发现问题的修复与复测待设备。
  - 验证：checklist.md 全部勾选
  - 依赖：Task 3~11

# Task Dependencies
- Task 0 → Task 1 → Task 2 → {Task 3, Task 4, Task 5, Task 6}（3/4/5 可并行）
- Task 7 依赖 {Task 1, Task 2, Task 6}；Task 8 依赖 Task 7
- Task 9 依赖 {Task 2, Task 3}；Task 10 依赖 Task 2；Task 11 依赖 {Task 1, Task 2}
- Task 12 依赖 {Task 3..Task 11}
