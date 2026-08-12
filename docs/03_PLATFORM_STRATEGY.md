# 03 — 平台策略：Web/PWA first

- 状态：**Accepted for Foundation**
- 决策日期：2026-08-12
- 当前目标：一套 React/Plait/Drawnix 实现同时覆盖桌面与 iPad 的真实输入实验

## 结论

先做响应式 Web，再把同一应用补齐为可安装 PWA。第一轮主要开发/自动化环境使用桌面浏览器；真实输入验证同时覆盖 iPad Safari + Apple Pencil，以及 PC/macOS + 常见数位板。现在不建 Swift/iPadOS、Electron 或 hybrid wrapper 工程。

这个选择优化的是“最快获得真实产品与输入证据”，不是宣称 Web 已经等同原生。PWA 是安装、离线与启动体验层，不会自动改善笔迹采样和渲染延迟。

## 为什么这是最简单的第一条路

- 现有基线已经是 Nx + React + Vite + Plait/Drawnix，保留全部白板能力的改动最少。
- Pointer Events 用同一事件模型表达 mouse、touch、pen；可以先做 capability probe，再用同一数据管线评估 Apple Pencil 和数位板。
- iPad 支持将网站添加到主屏并以 Web App 方式打开，Safari Web Inspector 也能从 Mac 检查 iPad 页面/Home Screen web app。
- URL 部署让设备矩阵和反馈迭代更快，不需要先维护 App Store signing/review。
- Web/PWA 验证出的 runtime、context、intent contracts 将来可以被原生外壳复用，即使 ink renderer 最终原生化。

## 三条路线对比

| 维度 | Web/PWA（当前） | 原生 iPadOS + PencilKit（候选） | 桌面原生/Electron（暂缓） |
| --- | --- | --- | --- |
| 复用当前 Drawnix | 最高 | 低；需 bridge 或重做 canvas | 高但包装成本额外 |
| 首次可用速度 | 最快 | 较慢，需 Swift/Xcode/signing | 中等 |
| 一套实现覆盖桌面+iPad | 是 | 否 | 不覆盖 iPad |
| Apple Pencil 最深集成 | 需实机验证浏览器能力 | 最强，PencilKit 原生低延迟/工具 | 不适用 |
| 发布/更新 | URL/PWA 即时 | App Store/TestFlight 流程 | installer/store/updater |
| 离线 | service worker 后可用，需显式测试 | 原生可控 | 可控 |
| 文件/系统集成 | 浏览器能力受限 | 最强 | 较强 |
| 维护面 | 当前最小 | 新技术栈与双端一致性 | 新包装层与安全更新 |

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

不支持 pressure 时必须保持可用的定宽/速度映射 fallback；mouse/touch/keyboard 不能退化。

## Foundation 支持范围

Foundation 只承诺白板基础功能的浏览器体验，不承诺压感：

| 环境 | 自动/手工目标 | Foundation 结论 |
| --- | --- | --- |
| Chromium desktop（macOS/Windows） | build、核心工具、保存恢复、快捷键 | 一等开发目标 |
| Safari macOS | mount、核心工具、storage、布局 | 必须手工 smoke test |
| iPad Safari（横/竖屏） | 打开、绘写/选择/缩放、toolbar、恢复 | 必须实机验证后才标 Verified |
| iPad Home Screen web app | 启动、storage、viewport/rotation | PWA 阶段验证 |
| PC/macOS + 数位板 | 先验证普通 pointer 行为 | pressure 留给下一轮 prompt |

自动化模拟的 `PointerEvent` 只能验证代码分支，不能替代物理笔、driver、Safari 和实际屏幕刷新测试。

## 购买与测试设备建议

资金不是首要限制，仍应按证据顺序采购：

1. Foundation 可先用现有 Mac/PC 完成结构和自动化。
2. 进入 pressure prompt 前准备一台仍受支持的 iPad 与其明确兼容、**具备压力感应**的 Apple Pencil，并保留一台 Mac 用于 Safari Web Inspector/Xcode simulator。预算不是约束时，主测试机优先选择当时在售、支持 Apple Pencil Pro 的 iPad Pro + Apple Pencil Pro，以覆盖压力、倾斜、hover 等硬件上限；后续再用更普及的 iPad 做兼容测试。不要为压感研究购买 Apple Pencil (USB-C)：Apple 的功能对比明确标示它没有 pressure sensitivity。浏览器是否暴露 Pencil Pro 的全部能力仍必须实测。
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

## 官方资料（访问于 2026-08-12）

- [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)：pressure 范围、无压感时的 `0.5` 语义、coalesced/predicted events。
- [Apple PencilKit](https://developer.apple.com/documentation/pencilkit)：原生 Apple Pencil/触摸采集和低延迟 canvas 的对照路线。
- [Apple Pencil feature comparison](https://www.apple.com/apple-pencil/) 与 [Apple Pencil compatibility](https://support.apple.com/en-la/108937)：采购前核对 pressure capability 以及 Pencil/iPad 型号配对；Apple Pencil (USB-C) 不支持压力感应。
- [Apple Support: Turn a website into an app in Safari on iPad](https://support.apple.com/en-au/guide/ipad/ipad8f1f7a29/ipados)：iPad Home Screen web app 安装入口。
- [Apple Developer: Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)：从 Mac 检查 iPad webpage、service worker 和 Home Screen web app。
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)：manifest、HTTPS 与不同平台安装要求。MDN 是实现指南，最终仍以目标 Safari/Chromium 实机为准。
