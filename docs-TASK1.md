# Task 1 技术验证 Spike —— jsapi 能力核查与媒体播放方案决策

> 状态：源码核查 + 联网调研 + 设计决策 + 代码准备已完成。
> 本机无 WSL，无法交叉编译/真机验证；所有"运行验证"项见文末遗留清单。
> 本文档为临时技术文档，后续要点将合并进代码注释与 README，不入 .trae。

---

## 1. jsapi 能力清单（源码核查结论）

### 1.1 HTTP（jsapi/src/Fetch.cpp/.hpp）— libcurl 实现，能力充足

| 项 | 结论 | 证据 |
|---|---|---|
| 实现库 | **libcurl**（系统 `libcurl.so`，版本 **7.79.1**，X7versionInfo 提供） | [Fetch.cpp](jsapi/src/Fetch.cpp) `curl_easy_init` 全流程；`jsapi/include/curl/curlver.h` |
| 自定义 Header | **支持**。`FetchOptions.headers`（`unordered_map<string,string>`）→ `CURLOPT_HTTPHEADER`，UA/Cookie/Referer/Range 均可传 | [Fetch.cpp:L146-150](jsapi/src/Fetch.cpp#L146-L150) |
| 方法 | GET / POST / 任意（CUSTOMREQUEST）；body 走 POSTFIELDS | [Fetch.cpp:L131-144](jsapi/src/Fetch.cpp#L131-L144) |
| 返回形态 | `Response{status, headers(map), body(string), ok}` + `json()` / `text()` | [Fetch.hpp:L38-50](jsapi/src/Fetch.hpp#L38-L50) |
| 流式 | 两种：`stream`（SSE，按行剥 `data: ` 前缀，AI 对话专用）与**本次新增 `rawStream`**（二进制直通 `RawStreamCallback`，供媒体缓存下载） | [Fetch.cpp:L120-135](jsapi/src/Fetch.cpp#L120-L135) |
| 取消 | `FetchOptions.cancelled`（`atomic<bool>`）→ xferinfo/写回调返回 0 中断 | [Fetch.cpp:L45-51](jsapi/src/Fetch.cpp#L45-L51) |
| 超时 | `timeout`（秒，0 = 不限）；redirect 跟随可关；SSL 校验已禁用（VERIFYPEER/HOST=0） | [Fetch.cpp:L107-111](jsapi/src/Fetch.cpp#L107-L111) |
| 错误处理 | `ASSERT_CURL_OK` 宏抛 `CurlError`（CURLE_ABORTED_BY_CALLBACK 视为正常取消） | [Fetch.hpp:L28-34](jsapi/src/Fetch.hpp#L28-L34) |
| CMake | `-Wl,-unresolved-symbols=ignore-all` 弱链接，运行时由笔端系统提供 libcurl 符号；注释的 `find_library(CURL_LIBRARY ...)` 已具备打开条件（X7versionInfo 已解压出 `jsapi/lib/libcurl.so`） | [CMakeLists.txt:L106-110](jsapi/CMakeLists.txt#L106-L110)、[CMakeLists.txt:L143-157](jsapi/CMakeLists.txt#L143-L157) |

**结论：B 站 API 请求（UA/Cookie/Referer/WBI）完全可行，无需另写 Fetch；媒体取流用新增 rawStream 模式。**

### 1.2 JS 侧宿主内置 jsapi（ui/src/@types/falcon.d.ts）

JS 侧可用的 `$falcon.jsapi` 只有两组，均为**笔端宿主框架内置（不在本仓库，不可改）**：

- `storage`：`setStorage/getStorage/getStorageInfo`（Promise 形态）——**设置与会话持久化用它**（key-value 字符串）。
- `http.request`：`{url, method, headers, data, timeout} → Promise<HttpResponse>`——声明支持自定义 headers，**但实现不可见，UA/Cookie 是否透传需真机验证**；不可靠时切到 custom 模块的原生 Fetch（见 1.3 接入方案）。

### 1.3 自定义模块接入点（jsapi/src/JSAPI.cpp）

- 注册方式：`module_init` 中 `JQModuleEnv::CreateModule(ctx, m, "custom")` → `env->setModuleExport("名字", createXxx(env.get()))`，模块名同步登记 `exportList`；AI/IME/ScanInput 三者现以注释形式保留。
- **本次已接入 `Media` 模块（默认启用）**：JS 侧 `import { Media } from 'custom'`。
- 绑定层 jqutil_v2 提供的关键机制（读 `jsapi/iot-miniapp-sdk/include/jqutil_v2/` 确认）：
  - 同步方法 `void m(JQFunctionInfo&)`；Promise 方法 `void m(JQAsyncInfo&)`（`SetProtoMethodPromise` 注册，**框架托管 Promise 生命周期，无需手写 JS_NewPromiseCapability**，在工作线程执行，`info.post/postError` 结算）；
  - **原生→JS 事件推送**：继承 `JQPublishObject`，`publish(topic, Bson)` 跨线程投递到 JS 线程；JS 侧对象实例自带 `on(topic, cb)` / `off(topic, cb)`（`JQPublishObject::InitTpl` 注册）。

### 1.4 Database（jsapi/src/Database/）

- `DATABASE` 类封装 sqlite3（`#include <sqlite3/sqlite3.h>`，X7versionInfo 已提供头文件与 `lib/libsqlite3.so`；同为弱链接，运行时由系统提供）。
- **它只是 C++ 内部组件**（langningchen 原项目给 AI 对话持久化用），并未导出给 JS；JS 侧持久化走 1.2 的宿主 `storage`。本项目设置/会话优先 `storage`；如需结构化缓存（如断点记录），再经 custom 模块包一层。

### 1.5 媒体能力（iot-miniapp-sdk）

- 全量 grep `audio|video|media|play|tts|sound|pcm|alsa` 于 `jsapi/iot-miniapp-sdk`：**零匹配**。本仓库内 SDK 仅含 QuickJS 绑定基础设施（jqutil_v2/looper/threadpool），**无任何媒体播放 JSAPI、无渲染表面访问 API**。
- 宿主组件注册表中存在 `video` 组件名（aiot-vue-cli `falcon-vue-precompiler/src/config.js` 的 `weexRegisteredComponents` 含 `video/web`），weex 事件表含 video 事件（start/pause/finish/fail），**但笔端宿主是否真实现了 `<video>` 的渲染与播放，本仓库无法证实 → 列为真机 PoC 项**。

### 1.6 UI 层（ui/src）与触摸手势

- 框架：Vue 3 SFC（`@vue/compiler-sfc`）+ `aiot-vue-cli` 打包（falcon-vue-loader / weex-template-compiler）；组件库 `falcon-ui@2.0.2`（npm）+ weex 内置组件。
- index 演示用到的组件与事件：`scroller`（scroll-direction）、`Button @click`、`slider :min/:max/:step @change`、`Switch @change v-model`。
- **手势结论（文档 F）**：aiot-vue-cli 事件白名单（`web-libs/falcon-vue-precompiler/src/config.js` `weexEvents`）**明确包含 weex 手势全家族**：`tap / touchstart / touchend / touchmove / swipe / panstart / panmove / panend / longpress`。即模板层 `@swipe="..."`、`@panstart/@panmove/@panend` 是框架设计内事件。
  - **主方案**：横滑用 `@swipe`（事件对象带 direction）或 pan 系列（自行累计位移判定方向，兼容性最好）。
  - **降级方案（保底必做）**：左右半屏点击热区 + 屏侧箭头按钮（Button @click），手势失效时交互不阻塞。
  - 列表滚动：`scroller` 组件原生支持垂直滚动；`weexRegisteredComponents` 还有 `list/cell/waterfall/refresh/loading`（下拉刷新/加载更多可用，需真机确认宿主实现）。
- image 组件（falcon-ui `packages/image/index.vue`）：包装原生 `image` 标签，`src` 响应式绑定（watch 生效即刷新）、`resize`（contain/cover/…）、`@load` 事件。**帧刷新路径 = 重绑 src**（见 §2.3）。

---

## 2. 联网调研结论（2 轮 6 主题）

### 第 1 轮

1. **falcon/aiot-vue-cli 手势与 image**：公开资料少（框架小众），但取得两处一手证据：a) 本仓库 vendored 的 aiot-vue-cli 事件白名单含完整手势族（见 1.6）；b) quickapp 等同类 IoT widget 体系 image 均支持 src 动态刷新与 complete/error 事件，佐证重绑 src 刷新思路是行业通用形态。
2. **词典笔媒体先例（PenUniverse/PenMods/langningchen）**：
   - PenMods（GPL，词典笔 2）：证明笔端 Linux 用户态有成熟音频栈；其"增强系统播放器，任何场景可倍速/复读"说明**系统自带音频播放器与解码能力**；
   - Lyrecoul/QtVideoPlayer：词典笔 2（rk3326）系统自带 **ffmpeg 3.4.8**，作者用它 + Qt 做出视频播放器 —— 软解路线在同类硬件上已被验证；
   - PenMods #195：系统为普通 Linux（可 chroot 跑发行版），无特殊媒体服务依赖；
   - doge-reader/doge-calculator（词典笔 OS 第三方 miniapp，quickjs+vue）：证明 miniapp 路线可承载复杂 JS 应用。
3. **qrcode-generator**：kazuhikoarase/qrcode-generator@1.4.4（MIT）为纯 JS 事实标准，无依赖、可嵌入；`qrcode(0, level)` 自动选版本，`isDark/getModuleCount` 直接给矩阵。falcon-ui 自带 `qr-code` 组件但其渲染走 `<canvas>`（笔端宿主 canvas 未证实），**弃用组件、自绘黑白块**。

### 第 2 轮

4. **ffmpeg 交叉编译**：标准参数范式确认（`--enable-cross-compile --arch=aarch64 --target-os=linux --cross-prefix=... --cc=... --sysroot=...`）；最小化编译范式确认（`--disable-everything` + 按需 enable decoder/demuxer/parser/protocol；`--disable-programs/--disable-doc`）；静态库链入 so 必须加 `--enable-pic`。buildroot 工具链交叉编译 ffmpeg 是成熟路径（多个 rk buildroot 案例）。
5. **langningchen/miniapp 与 penosext**：确认本项目上游架构（Vue 前端 + C++ JSAPI 后端 + jqutil 桥接）与 wiki《Project Architecture》一致；penosext 提供 X7 工具链与 X7versionInfo（含 curl/sqlite3）。
6. **quickjs 原生模块 Promise**：标准写法为 `JS_NewPromiseCapability` + 持有 resolve/reject 异步结算；**本项目的 jqutil_v2 已将此封装为 `SetProtoMethodPromise` + `JQAsyncInfo`（线程池执行），直接使用框架机制即可**，无需手写能力表。

---

## 3. 媒体播放方案决策（文档 B）

### 3.1 决策：**分层降级链，首发默认"软解-音频优先"，视频帧渲染作增强开关**

| 级别 | 方案 | 可行性 | 决策 |
|---|---|---|---|
| A | 系统 `<video>` 组件 / 系统播放器 intent | falcon 组件表有 `video` 名，但宿主实现未知；miniapp 无 intent/mediaplayer JSAPI（sdk 零匹配） | **真机 PoC 后决定**；若宿主 `<video>` 可用（src 支持本地文件 + Range），它是 0 成本最优解，设为"auto"档首选 |
| B | **ffmpeg 软解 + C++ Media JSAPI**（已实现代码框架） | PenMods/QtVideoPlayer 证明同类硬件软解可行；X7 Pro（rk3576，A76+A55）算力更充裕 | **主力方案**。音频：AAC→S16 重采样→ALSA/tinyalsa 直写（真机确认后二选一编译）；视频：H.264→YUV420P→(sws)YUVJ420P→**mjpeg 编码**→base64→JS `image` src=`data:image/jpeg;base64,...` 帧刷新 |
| C | 仅音频（DASH 64K AAC m4s） | B 的子集（videoUrl 传空） | **默认档**：刷视频场景可听音+封面（封面用 image 组件，可接受） |

**推荐**：设置项"默认解码器"= `auto`（默认）。`auto` 行为：先探测宿主 `<video>`（PoC 脚本渲染一次本地 mp4），可用→系统播放器；不可用→ffmpeg 软解；软解库未编译→仅音频；音频 sink 不可用→提示并停用播放。**首发包按"仅音频+封面"走通端到端，视频帧渲染在 `ffmpeg`/`video` 档迭代**。

### 3.2 关键设计决策与理由

1. **网络取流由 curl 承担，ffmpeg 编译为无网络版**（`--disable-network`，不出 tls/openssl 依赖）：Media::open 先以 rawStream 把 m4s 段下载到缓存目录（Fetch.timeout=0），再以 `file://` 协议解封装。代价是**边下边播退化为"先缓存后播"**（首帧延迟 = 段下载时间）；收益是 ffmpeg 静态库体积最小、无 TLS 证书维护、seek 直接在本地文件进行（体验反而好于流式 seek）。64K 音频段体积小，先缓存后播的延迟可接受。
2. **视频帧渲染走 mjpeg+base64+image 重绑 src**：
   - 帧率预期：480 宽 YUVJ420P，qmin3/qmax8，JPEG 每帧约 8~25KB，base64 后 +33%；QuickJS + Vue 响应式 + 原生图片解码链路，**保守预期 2~5 fps**，只适合"幻灯片式低帧率动画/封面增强"，不能当流畅视频看。
   - 该路径与 PenMods"视频播放器"体验差距大，故视频档定位为"增强"而非承诺。
3. **音频同步**：以音频管线 playedSamples 为时钟（positionMs = samples/rate），视频线程按 pts 差 sleep/丢帧（>150ms 提前量等待、<-400ms 丢弃）。
4. **倍速**：`setRate` 以重采样输出侧抽样实现（快放丢样本、慢放暂不补样本），变调不变速的精细方案留待迭代；0.25~4.0 夹取。
5. **seek**：`avformat_seek_file` + `avcodec_flush_buffers`，对本地缓存文件可靠。
6. **X7 Pro 系统无 ffmpeg 假设**：X7versionInfo 只含 curl/sqlite3，故自带静态 ffmpeg（tools/build_ffmpeg_x7.sh，产物入 `jsapi/thirdparty/ffmpeg`）。

### 3.3 "默认解码器"设置项选项集合（Task 11 使用）

| 值 | 行为 |
|---|---|
| `auto`（默认） | 系统播放器探测成功→系统；否则 ffmpeg 软解；未编译 ffmpeg→仅音频；全不可用→只展示封面并提示 |
| `system` | 强制宿主 `<video>`/系统播放器（不可用时报错回退 auto） |
| `ffmpeg` | 强制软解（音+视频帧渲染；无 ffmpeg 库时报错） |
| `audio_only` | 仅音频（DASH 64K AAC），界面显示封面+进度，最省电最稳 |

同时保留画质联动约定：`audio_only` 用 `fnval` 请求 64K 音频；`ffmpeg`/`auto` 软解档限 qn=16/32（H.264）；`system` 档按宿主能力再议。

### 3.4 音频输出后端（编译期选项，真机确认后定稿）

| 后端 | 开关 | 说明 |
|---|---|---|
| ALSA（libasound） | `-DHAVE_ALSA=ON` | 首选（用户态标准栈，需真机 `ls /usr/lib \| grep asound` 确认存在） |
| tinyalsa（libtinyalsa） | `-DHAVE_TINYALSA=ON` | rk buildroot 常见备选 |
| WAV 调试 | 运行时 `setAudioSink('wav')` | 无条件编译，写 `/tmp/media_debug.wav`，用于 PoC 验证解码正确性 |
| Null | 兜底 | 丢帧不出声，保证管线可跑 |

---

## 4. 新增 / 修改文件清单

### 新增

| 文件 | 说明 |
|---|---|
| `jsapi/src/Media/Media.hpp/.cpp` | 软解引擎：`open(audioUrl, videoUrl, cacheDir)/play/pause/resume/seek/setRate/getProgress/stop` + 回调；`#ifdef HAVE_FFMPEG` 包裹全部 ffmpeg 代码，未开时各方法运行时抛错 |
| `jsapi/src/Media/JSMedia.hpp/.cpp` | jqutil_v2 绑定（JQPublishObject 子类）：Promise 版 `open`，事件 `media_frame / media_ended / media_error / media_download_progress`；`createMedia(env)` 工厂 |
| `jsapi/src/Media/AudioSink.hpp/.cpp` | PCM 输出抽象 + ALSA/TinyALSA/WAV/Null 四实现（编译期开关） |
| `ui/src/utils/qrcode.js` | kazuhikoarase qrcode-generator@1.4.4（MIT，完整嵌入）+ `createQrMatrix(text, eccLevel='M')` 导出（typeNumber=0 自动选版本，byte 模式，覆盖 >120 字符 URL；v6-M=106B、v7-M=122B） |
| `tools/build_ffmpeg_x7.sh` | WSL 交叉编译最小 ffmpeg 静态库（n6.1.2，参数逐条注释；产物安装 `jsapi/thirdparty/ffmpeg`；`ENABLE_ASM=0` 默认关汇编） |
| `docs-TASK1.md` | 本文档 |

### 修改

| 文件 | 说明 |
|---|---|
| `jsapi/src/Fetch.hpp/.cpp` | 新增 `RawStreamCallback`/`FetchOptions.rawStream`（二进制直通，SSE 分支优先级不变） |
| `jsapi/src/JSAPI.cpp` | 接入 Media：`#include "Media/JSMedia.hpp"`、`exportList` 增 `"Media"`、`setModuleExport("Media", createMedia(env.get()))`（AI/IME/ScanInput 注释保持原样） |
| `jsapi/CMakeLists.txt` | 新增【可选8】`HAVE_FFMPEG`（默认 OFF；find_library 五个 .a + `-lz` + `HAVE_FFMPEG` 宏）与【可选9】`HAVE_ALSA`/`HAVE_TINYALSA`（默认 OFF，找不到库 FATAL_ERROR 提示放置路径） |

> 注：`file(GLOB_RECURSE ... src/*.cpp)` 已自动把 `src/Media/*.cpp` 收进构建源集，无需改源码列表。

### C++ 扩展设计要点（对接 Task 2/7 的 JS 用法）

```js
// Task 2: B 站 API 请求（宿主 http.request 验证失败时的后备）
import { Media } from 'custom'

const player = new Media()          // 或直接用模块导出的单例
player.setAudioSink('alsa')         // 'alsa'|'tinyalsa'|'wav'|'null'
await player.open(audioM4sUrl, videoM4sUrl, '/userdisk/bilibili_cache') // Promise，内部 curl 缓存→ffmpeg
player.play()
player.on('media_frame', ({ width, height, ptsMs, jpegBase64 }) => {
  // this.coverSrc = `data:image/jpeg;base64,${jpegBase64}`  → image 组件刷新
})
player.on('media_ended', () => { /* 连播切换 */ })
player.on('media_error', ({ message }) => { /* 降级提示 */ })
player.seek(30000); player.setRate(1.5)
const { durationMs, positionMs, paused, rate } = player.getProgress()
player.stop()
```

二维码渲染（Task 3）：

```js
import { createQrMatrix } from '../utils/qrcode.js'
const matrix = createQrMatrix(qrUrl, 'M') // boolean[][]
// 模板：<div v-for="row"><div v-for="cell" :style="{background: cell ? '#000' : '#fff'}"/></div>
// 建议单元格 5~6px（280 宽 ÷ ~37 模块 ≈ 7px），四周留 2 模块静区
```

**已验证（本机 Node 18 实跑）**：110 字符登录 URL → 45×45 矩阵（自动选 version 6-M，106 字节容量）；短链 → 25×25（v2-M）；ECC 'Q' → 49×49。版本自动选择覆盖 Task 描述中"版本 1-5、URL<120 字符"的缺口（v5-M 仅 84 字节，v6-M=106B / v7-M=122B 才能承载 110+ 字符）。

---

## 5. 遗留验证项（需 WSL / 真机，按优先级）

| # | 项 | 环境 | 命令/方法 |
|---|---|---|---|
| 1 | Media JSAPI 全量代码编译（含 HAVE_FFMPEG） | WSL | `bash tools/build_ffmpeg_x7.sh && cmake -S jsapi -B jsapi/build -DHAVE_FFMPEG=ON && make` |
| 2 | 笔端音频栈确认 | 真机 adb | `adb shell ls /usr/lib \| grep -E "asound\|tinyalsa\|audio"`；`adb shell ls /usr/bin \| grep -E "tinyplay\|aplay"` |
| 3 | 宿主 `<video>` 组件与 image data-URI/base64 支持 | 真机 | PoC 页面：`<video src="file:///userdisk/.../test.mp4">`；`<image src="data:image/jpeg;base64,...">` 各渲染一次 |
| 4 | `@swipe/@panstart` 事件是否真机触发 | 真机 | PoC 页面绑事件打印 direction/位移 |
| 5 | `$falcon.jsapi.http.request` 自定义 UA/Cookie 透传 | 真机 | 请求 `https://httpbin.org/headers` 或 B 站 nav 接口观察 |
| 6 | custom 模块（Media/Fetch）符号加载 | 真机 | 安装 .amr 后 `logcat`/宿主日志看 `custom_init_jsapis` 与 import 是否成功 |
| 7 | ALSA 直写无混音冲突 | 真机 | 播放期间系统发音（查词朗读）是否互掐；必要时切 tinyalsa 设备号 |
| 8 | ffmpeg n6.1.2 在 gcc 8.2（工具链）下无告警通过 | WSL | 构建脚本 step2 输出 |
| 9 | 软解性能基线（720p H.264 单帧耗时） | 真机 | PoC：media_frame 事件间隔统计，决定视频档上限画质 |

---

## 6. 结论一句话

**HTTP/存储/手势均可行；媒体走"系统 video PoC → ffmpeg 软解（音频直写 ALSA/tinyalsa + 视频 mjpeg-base64 帧刷新）→ 仅音频"降级链；首发默认 `auto`/`audio_only` 保底，全部代码骨架与构建脚本已就绪，待 WSL 编译与真机 PoC 收敛。**
