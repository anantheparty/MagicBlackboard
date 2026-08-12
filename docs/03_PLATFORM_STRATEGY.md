# 03 — 平台策略：Web/PWA first

- 状态：**Accepted Web/PWA-first direction; Pressure Ink V2 platform conclusion Unverified**
- 决策日期：2026-08-12
- 当前目标：用已实现的 React/Plait/Drawnix simulated/browser 路径进入命名设备真实输入实验

## 结论

先做响应式 Web，再把同一应用补齐为可安装 PWA。Pressure Ink V2 simulated/browser 路径已经
实现；最终 fixed-commit release evidence 仍待记录。真实输入验证计划覆盖 iPad Safari +
Apple Pencil，以及 PC/macOS + 常见数位板。现在不建 Swift/iPadOS、Electron 或 hybrid
wrapper 工程。截止 2026-08-13，真实输入矩阵全部 **Not run**，平台建议只能是
**Unverified**。

这个选择优化的是“最快获得真实产品与输入证据”，不是宣称 Web 已经等同原生。PWA 是安装、离线与启动体验层，不会自动改善笔迹采样和渲染延迟。

## 为什么这是最简单的第一条路

- 现有基线已经是 Nx + React + Vite + Plait/Drawnix，保留全部白板能力的改动最少。
- Pointer Events 用同一事件模型表达 mouse、touch、pen；可以先做 capability probe，再用同一数据管线评估 Apple Pencil 和数位板。
- iPad 支持将网站添加到主屏并以 Web App 方式打开，Safari Web Inspector 也能从 Mac 检查 iPad 页面/Home Screen web app。
- URL 部署让设备矩阵和反馈迭代更快，不需要先维护 App Store signing/review。
- Web/PWA 验证出的 runtime、context、intent contracts 将来可以被原生外壳复用，即使 ink renderer 最终原生化。

## 三条路线对比

| 维度                  | Web/PWA（当前）                   | 原生 iPadOS + PencilKit（候选） | 桌面原生/Electron（暂缓） |
| --------------------- | --------------------------------- | ------------------------------- | ------------------------- |
| 复用当前 Drawnix      | 最高                              | 低；需 bridge 或重做 canvas     | 高但包装成本额外          |
| 首次可用速度          | 最快                              | 较慢，需 Swift/Xcode/signing    | 中等                      |
| 一套实现覆盖桌面+iPad | 是                                | 否                              | 不覆盖 iPad               |
| Apple Pencil 最深集成 | 需实机验证浏览器能力              | 最强，PencilKit 原生低延迟/工具 | 不适用                    |
| 发布/更新             | URL/PWA 即时                      | App Store/TestFlight 流程       | installer/store/updater   |
| 离线                  | service worker 后可用，需显式测试 | 原生可控                        | 可控                      |
| 文件/系统集成         | 浏览器能力受限                    | 最强                            | 较强                      |
| 维护面                | 当前最小                          | 新技术栈与双端一致性            | 新包装层与安全更新        |

Hybrid wrapper 不应被当作“免费原生能力”：如果核心仍是 WebView，输入质量限制可能仍存在；若嵌入原生 PencilKit，则必须解决两套坐标、数据模型、撤销栈和导入导出一致性。

## 输入能力不是布尔值

Pointer Events 规范定义 `pointerType`、`pressure`、tilt/angle、`getCoalescedEvents()` 与 predicted events，但浏览器、OS、driver、硬件可能只实现子集。规范规定：不支持压力的 active pointer 可返回 `0.5`，因此看到非零值不能证明硬件压感工作。

以后声称“支持某设备”前，capability report 至少记录：

- device、stylus/tablet 型号；
- OS 与浏览器精确版本；
- `pointerType`、pressure 的 min/max/不同值数量；
- tilt/altitude/azimuth/twist 是否随动作变化；
- coalesced/predicted/raw update 是否可用；
- 丢点、误触、palm/scroll 行为；
- 主观笔迹质量与可重复的 latency/jank 测量；
- Safari tab 与 Home Screen web app 是否一致。

不支持或尚未证明 variable pressure 时必须保持原有定宽 fallback；本版本没有 velocity-width
mapping。mouse/touch/keyboard 不能退化。

## Foundation 支持范围

Foundation 只承诺白板基础功能的浏览器体验，不承诺压感：

| 环境                              | 自动/手工目标                       | Foundation 结论             |
| --------------------------------- | ----------------------------------- | --------------------------- |
| Chromium desktop（macOS/Windows） | build、核心工具、保存恢复、快捷键   | 一等开发目标                |
| Safari macOS                      | mount、核心工具、storage、布局      | 必须手工 smoke test         |
| iPad Safari（横/竖屏）            | 打开、绘写/选择/缩放、toolbar、恢复 | 必须实机验证后才标 Verified |
| iPad Home Screen web app          | 启动、storage、viewport/rotation    | PWA 阶段验证                |
| PC/macOS + 数位板                 | 普通 pointer、capability 与压感质量 | Pressure V2 实机 gate       |

自动化模拟的 `PointerEvent` 只能验证代码分支，不能替代物理笔、driver、Safari 和实际屏幕刷新测试。

## Pointer Events 与 Safari 一手来源矩阵

访问日期均为 2026-08-12。表中的“发布/实现”只说明公开版本或 WebKit 代码状态；没有一项
代替本仓库在命名 iPad/Pencil/数位板上的实测。

| 规范/浏览器节点            | 日期或版本                                        | 一手证据                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 可以得出的结论                                                                                                                                                                       | 仍需实机确认                                                                |
| -------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| W3C Pointer Events Level 3 | Recommendation，2026-06-30                        | [W3C REC](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/)                                                                                                                                                                                                                                                                                                                                                                                                | 定义 `pressure`、tilt/altitude/azimuth、`getCoalescedEvents()`、`getPredictedEvents()` 和 `pointerrawupdate`；`pressure` 为 `[0,1]`，无压力能力的 active pointer 可用 `0.5` fallback | 某浏览器/设备是否实现、采样率、质量与 driver 行为                           |
| Safari 13                  | 13.0 / 15608.2.11，2019-09-19                     | [Apple release notes](https://developer.apple.com/documentation/safari-release-notes/safari-13-release-notes)、[WebKit feature note](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/)                                                                                                                                                                                                                                                              | Safari 13 引入 Pointer Events；WebKit 明确提到统一 mouse/trackpad/touch/Apple Pencil，并包含 pressure 与 tilt                                                                        | Apple Pencil 型号、iPadOS 版本上的压力/tilt 值是否可靠且会变化              |
| Safari 18.2                | 18.2 / 20620.1.16，2024-12-11；适用于 iPadOS 18.2 | [Apple release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_2-release-notes)、[WebKit 18.2 Web API notes](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/#web-api)                                                                                                                                                                                                                                               | 发布 `getCoalescedEvents()`、`getPredictedEvents()`、`altitudeAngle` 与 `azimuthAngle`                                                                                               | iPad Safari tab/Home Screen 模式的事件数量、顺序、角度精度、延迟和 fallback |
| Safari 26.2                | 2025-12-12 release note                           | [WebKit 26.2 pointer/touch notes](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/#pointer-and-touch-events)                                                                                                                                                                                                                                                                                                                                        | PointerEvent/TouchEvent 坐标改为支持 fractional values，减少子像素信息丢失                                                                                                           | 对本应用坐标转换、缩放和笔迹质量的实际影响                                  |
| Safari 26.6                | 2026-07-27；适用于 iPadOS 26.6                    | [WebKit 26.6 notes](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)                                                                                                                                                                                                                                                                                                                                                                               | 本轮一手 release note 没有新增相关 Pointer Events 能力；不能据此把先前 API 写成硬件 verified                                                                                         | 当前 iPadOS 26.6/Safari 26.6 的完整 capability 与性能                       |
| WebKit `pointerrawupdate`  | 截止 2026-08-12 未实现                            | [WebKit bug 277296](https://bugs.webkit.org/show_bug.cgi?id=277296)、[WebKit source FIXME](https://github.com/WebKit/WebKit/blob/6dd9ed3d3ea1fd36f678f2652c05097f61b0caa7/Source/WebCore/dom/GlobalEventHandlers%2BPointerEvents.idl#L32-L34)、[expected WPT failures](https://github.com/WebKit/WebKit/blob/6dd9ed3d3ea1fd36f678f2652c05097f61b0caa7/LayoutTests/imported/w3c/web-platform-tests/pointerevents/pointerevent_pointerrawupdate.https-expected.txt) | Safari 路径不能依赖 `pointerrawupdate`；必须 feature-detect 并用 `pointermove` + 可用时的 coalesced events 降级                                                                      | 未来 Safari/WebKit 版本是否实现；目标设备的实际 dispatch/coalescing         |

规范还要求对未支持的 tilt/angle 使用默认值，并把 `getCoalescedEvents()`、
`pointerrawupdate` 置于 secure context；predicted events 只应信任到下一次实际事件。即使方法
存在，返回数组仍可能为空，应用必须处理 parent fallback 且不能双重消费。

对应规范直达章节为 [`pressure`](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/#dom-pointerevent-pressure)、
[`altitudeAngle`/angle conversion](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/#dom-pointerevent-altitudeangle)、
[`getCoalescedEvents()`](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/#dom-pointerevent-getcoalescedevents)、
[`predicted events`](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/#predicted-events) 和
[`pointerrawupdate`](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/#the-pointerrawupdate-event)。
未支持时 `tiltX/tiltY` 默认为 `0`、`altitudeAngle` 默认为 π/2、`azimuthAngle` 默认为 `0`；
这些默认值和 active pointer 的 `pressure === 0.5` 一样，都不能被当作硬件能力证据。

WebKit 的 [rAF alignment bug 210454](https://bugs.webkit.org/show_bug.cgi?id=210454) 截止
2026-07-17 仍为 open；官方讨论确认 coalesced events 已落地，但 pointer event dispatch 仍
不能假定与 animation frame 对齐。因此热路径必须测量，不能用规范或 Chrome 结果外推 Safari。

## Pressure Ink V2 目标设备矩阵

模拟/browser 实现已完成，但以下全部是当前真实状态：

| 环境                      | 精确设备要求                                                                       | 状态        | 当前结论                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| iPad Safari tab           | 仍受支持的 iPad + 明确兼容且具备 pressure 的 Apple Pencil；记录型号、iPadOS/Safari | **Not run** | 不能声称 Apple Pencil/pressure/tilt/palm rejection 支持 |
| iPad Home Screen web app  | 与上行同一设备和笔                                                                 | **Not run** | 不能声称安装态、storage、rotation、offline 或输入等价   |
| Desktop Chromium + tablet | 命名数位板、pen、driver、OS、Chrome 精确版本                                       | **Not run** | system Chrome synthetic mouse 不是 tablet 证据          |
| Desktop mouse             | 命名实体 mouse/trackpad 与手工任务                                                 | **Not run** | 合成 60 Hz mouse 只提供代码/性能 baseline               |
| Touch-only device         | 命名手机/平板、OS/浏览器                                                           | **Not run** | 不能声称手势、滚动、palm 或窄屏可用                     |
| Safari macOS，无 tablet   | macOS/Safari 精确版本                                                              | **Not run** | 不能由 Chromium build/E2E 外推                          |
| Safari macOS + tablet     | 命名数位板、driver、macOS/Safari                                                   | **Not run** | 不能由 iPad 或 Chromium 结论互相外推                    |

因此当前平台输出不是 **Continue Web/PWA**，也不是 **Run native PencilKit comparison
spike**，而是 **Unverified**。完成模拟实现不改变这一结论。

## 购买与测试设备建议

资金不是首要限制，仍应按证据顺序采购：

1. 先完成当前实现的 fixed-commit 本地门禁与 hosted CI；这些自动证据仍不替代实机。
2. 下一 gate 准备一台仍受支持的 iPad 与其明确兼容、**具备压力感应**的 Apple Pencil，并
   保留一台 Mac 用于 Safari Web Inspector。预算不是约束时，主测试机优先选择当时在售、
   支持 Apple Pencil Pro 的 iPad Pro + Apple Pencil Pro，以覆盖压力、倾斜、hover 等硬件
   上限；后续再用更普及的 iPad 做兼容测试。不要为压感研究购买 Apple Pencil (USB-C)：
   Apple 的功能对比明确标示它没有 pressure sensitivity。浏览器是否暴露 Pencil Pro 的
   全部能力仍必须实测。
3. 准备一块主流 PC/macOS 数位板，测试其 driver 在 Chromium/Safari 暴露的 Pointer Events 数据；品牌结论不能互相外推。
4. 只有 Web 压感 gate 失败后，再投入原生 iPadOS spike；先做短期对照原型，不立刻迁移整个白板。

## 重新评估原生 iPadOS 的 gate

完成 `prompts/03_PRESSURE_INK_V2.md` 的 capability probe 和同一组绘写任务后，若出现至少一个不可接受且无法通过 Web 层修复的问题，才启动 PencilKit spike：

- 笔到墨水延迟或稳定帧率未达到团队事先写下的目标；
- Safari 丢失产品必需的 pressure/tilt/coalesced data；
- palm rejection、hover、double tap/squeeze 或预测笔迹是核心需求而 Web 无可靠路径；
- 大文档下的笔迹质量/内存无法满足接受标准；
- 产品必须有 Web 无法可靠提供的系统文件、后台任务、分享或课堂设备管理集成。

对照 spike 必须复用同一输入 fixture/用户任务，并记录总开发成本、数据格式兼容和双端维护成本。性能“感觉更好”不足以触发迁移。

## PWA 的后续门槛

PWA 不在 Foundation 强制范围。进入时至少需要 manifest/icons、HTTPS、service worker 更新策略、offline shell、旧缓存恢复、storage eviction 提示、安装说明和 Safari/Chromium 实机测试。不能缓存私密模型响应或把 service worker 当 secret storage。

## 其他一手资料（访问于 2026-08-12）

- [W3C Pointer Events Level 3 Recommendation](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/)：pressure 范围、无压感时的 `0.5` 语义、angle、coalesced/predicted/raw update。
- [Apple: Handling input from Apple Pencil](https://developer.apple.com/documentation/uikit/handling-input-from-apple-pencil)、[Getting high-fidelity input with coalesced touches](https://developer.apple.com/documentation/uikit/getting-high-fidelity-input-with-coalesced-touches) 与 [Minimizing latency with predicted touches](https://developer.apple.com/documentation/uikit/minimizing-latency-with-predicted-touches)：只用于未来原生 UIKit/PencilKit 对照；UIKit 的 force/频率/预测保证不能套到 Safari JavaScript。
- [Apple PencilKit](https://developer.apple.com/documentation/pencilkit) 与 [`PKStrokePoint`](https://developer.apple.com/documentation/pencilkit/pkstrokepoint)：原生 stroke 数据路线的对照，不是当前实现。
- [Apple Pencil feature comparison](https://www.apple.com/apple-pencil/) 与 [Apple Pencil compatibility](https://support.apple.com/en-la/108937)：采购前核对 pressure capability 以及 Pencil/iPad 型号配对；Apple Pencil (USB-C) 不支持压力感应。
- [Apple Support: Turn a website into an app in Safari on iPad](https://support.apple.com/en-au/guide/ipad/ipad8f1f7a29/ipados)：iPad Home Screen web app 安装入口。
- [Apple Developer: Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)：从 Mac 检查 iPad webpage、service worker 和 Home Screen web app。
