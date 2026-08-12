# NEXT ROUND ONLY — Pressure Ink V2

> **状态：NOT IMPLEMENTED / DO NOT EXECUTE DURING FOUNDATION**
>
> 只有当前 Foundation 按 `docs/05_ACCEPTANCE_CRITERIA.md` 完成、结果已记录且 maintainer 明确开始下一轮时，才执行本 prompt。本文件现在只是下一轮工作指令；创建它不代表压感、Apple Pencil 或数位板支持已经实现。

## 目标

在不破坏 Drawnix 默认自由画和旧 `.drawnix` 数据的前提下：

1. 建立可验证、可回放的 Pointer Events ink sample pipeline；
2. 用真实 pressure 改变笔迹宽度，能力不足时稳定降级；
3. 用开发控制台展示 bounded capability/quality diagnostics；
4. 在 iPad + Apple Pencil 与 desktop + pen tablet 上形成有设备信息的证据；
5. 据此决定继续 Web/PWA，还是启动一个独立 PencilKit 对照 spike。

本轮不做 AI/intent/Actor、协作、云同步、遥测上传、原生 app 或模型接入。

## Entry gate

开始前逐项确认并引用证据：

- Foundation 的 app/runtime/adapter/console/tests/CI 已完成；
- `npm ci`、lint、format check、tests、workspace build 在当前 commit 有真实结果；
- `magic.ink-diagnostics` 仍是 behavior-neutral placeholder；
- 已阅读 `docs/03_PLATFORM_STRATEGY.md` 和 W3C Pointer Events 当前规范；
- 已盘点现有 freehand create/smoother/type/generator/component、Plait pointer pipeline、export/import、undo/redo、fragment copy/paste 与 hit/bounds 行为；
- 已记录 current Freehand schema 和至少一个旧 `.drawnix` fixture；
- 已写下目标设备，没有真实设备时明确标为“模拟分支验证，不是硬件支持验证”。

若 Foundation 未完成，不要边补 Foundation 边实现 pressure；先报告阻塞并停止。

## 第一部分：先建立 baseline 和 capability probe

在任何笔迹行为变化前，记录：

- 当前 branch/commit/dirty status、Node/npm、Nx/Plait/Drawnix versions；
- mouse、touch、普通 freehand 的视觉/数据 baseline；
- 10 秒持续书写的 handler/render/long-task/memory baseline，说明测量方法；
- 导出→导入、undo/redo、copy/paste、selection bounds/hit test baseline。

实现 feature-gated capability probe，采集单次会话内：

- pointer type、buttons/button/isPrimary；
- pressure min/max/不同区间数量，以及是否疑似规范 fallback `0.5`；
- tiltX/Y、altitude/azimuth、twist、width/height 是否存在且变化；
- `getCoalescedEvents`、`getPredictedEvents`、`pointerrawupdate` 的 API availability；
- received/accepted/coalesced/dropped sample counts 和采样间隔摘要。

诊断默认只在 dev 可用，使用固定容量内存 ring buffer；不得把 raw pointer stream、device identifier 或完整 stroke history 持续写入 IndexedDB、console log、analytics 或网络。控制台关闭后停止高频 UI 更新。

注意：synthetic PointerEvent 只能验证逻辑；不能证明浏览器真的从硬件暴露 pressure/tilt。

## 第二部分：定义纯 ink sample pipeline

把下列步骤拆为纯函数/小对象并单测，不把全部逻辑塞进 React 或一个 Plait handler：

```text
PointerEvent
  -> capability-aware sample extraction
  -> coalesced sample expansion (or parent fallback, never double-process)
  -> screen/host/viewBox coordinate conversion
  -> monotonic ordering + duplicate/invalid sample rejection
  -> resampling/smoothing
  -> pressure normalization/calibration/fallback
  -> width/opacity mapping
  -> preview rendering
  -> compact persisted stroke geometry
```

建议 sample contract（可基于代码证据调整，调整要写文档）：

```ts
type InkSample = {
  point: readonly [number, number];
  time: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
};
```

约束：

- clamp/validate browser input；拒绝 NaN/Infinity 和倒序异常，不信任构造事件。
- 若 `getCoalescedEvents()` 返回非空，处理这组 samples；否则处理 parent。不能两者都处理。
- timestamp 使用事件提供的单调时间语义；不要依赖 wall-clock 计算热路径速度。
- pressure capability 不能由一个 sample 判断。无压感 mouse/pen 的 active `0.5` fallback 不应画成“恒定中压是硬件压感”。
- pen 有可靠 pressure 时用 pressure；没有时使用已有定宽或经测试的 velocity fallback。touch/mouse 保持可用。
- pointer cancel、lost capture、global pointer up、two-finger navigation、orientation/viewport change 必须有结束/取消语义。
- 不在 pointer hot path 做 storage/network/model calls、全量 element copy 或同步 console render。

先为 pressure curve 写纯函数和表驱动测试，再调手感。curve 必须连续、有 min/max、支持 sensitivity，不能让轻触宽度为负/不可见或最大压力突跳。

## 第三部分：向后兼容的数据与渲染

不要先假设现有 `Point[]` 足以保存 variable width。基于审计选择最小兼容方案，并记录 ADR：

- 旧 freehand elements 仍可打开、选择、复制、导出和重绘，视觉不发生无意改变；
- 新 element 的 `points`/bounds/hit test 与旧消费者兼容；若增加 optional compact pressure/width samples，定义 schema version、缺失默认值、长度一致性和 migration；
- 只保留重绘所需的压缩 geometry/pressure，不保留无必要的 device ID、原始 event、wall-clock 或全部诊断字段；
- 旧客户端遇到新数据的降级行为必须实际验证；不能假设 unknown JSON fields 一定安全；
- undo/redo、copy/paste、fragment、export/import、clear 与 local persistence 有 round-trip tests；
- pressure feature disabled 时，新代码不改变 Drawnix 默认渲染和文件格式。

如果 variable-width rendering 需要新依赖，先比较现有 SVG/RoughJS 路径、轻量自有 outline 和成熟 library：记录 bundle size、license、maintenance、hit test/bounds、closed stroke、zoom 和 theme 影响。禁止仅凭 demo 引入大依赖或第二套 canvas engine。

把通用 ink primitive 放在正确的通用/adapter 层；Magic-specific toggle、diagnostics 和实验 policy 留在 Magic app/package。不得让 `packages/drawnix` import Magic runtime。

## 第四部分：feature rollout

- pressure ink 默认 **off**，旧 Drawnix app 与 Magic 用户原有笔迹行为不变；
- 通过 `magic.ink-diagnostics` 或拆分出的明确 experimental feature 开启；命名与行为不再是 placeholder 时更新文档；
- production 是否可见必须单独决定，不能因为 dev 实验通过自动开启；
- 在 UI 显示 detected capability 和实际策略：hardware pressure / velocity fallback / fixed width；不要显示虚假的“Apple Pencil supported”；
- per-board runtime 保持隔离，toggle 不影响另一块 board；
- capability/readings 在 detach/dispose 后停止，remount 不重复 listener。

## 测试要求

至少覆盖：

- extract/clamp invalid pressure/tilt/time samples；
- coalesced non-empty、empty、API absent，确保 parent 不重复；
- fallback `0.5` 识别基于多 sample/capability 状态；
- pressure curve endpoints、monotonicity/continuity、sensitivity；
- resampling/smoothing 的 deterministic fixtures；
- pointerdown/move/up/cancel/lost capture/two-finger cancellation；
- zoom/pan 坐标转换；
- old element render、new element round trip、missing optional data、malformed data；
- undo/redo、copy/paste、import/export、bounds/hit test；
- feature off exact compatibility；
- two runtimes/toggles isolated；
- mount/unmount/remount listener cleanup；
- diagnostics capacity 与 console-closed render behavior；
- app mount、upstream app compatibility、lint/format/test/build。

用 fixture 比较数据结构/几何不变量；视觉 regression 如果使用 snapshot，应同时说明允许的抗锯齿/平台差异。不要用一次手工画线代替自动 round-trip 测试。

## 物理设备验收

至少计划以下矩阵；无设备的行写 **Not run**，不能标 pass：

1. iPad Safari tab + compatible pressure-sensitive Apple Pencil（不要用无压力感应的 Apple Pencil (USB-C) 作为压感验收设备）；
2. iPad Home Screen web app + 同一 pressure-sensitive Pencil；
3. desktop Chromium + 一块明确型号/driver 的 pen tablet；
4. desktop mouse；
5. touch-only device；
6. Safari macOS（有/无 tablet 分开记录）。

对每个环境保存合成测试任务的数值摘要，而不是用户真实笔迹：慢/快直线、轻到重、重到轻、圆、短点、交叉、长时间连续书写、同时导航/取消。记录 device/stylus、OS/browser/driver、capabilities、fallback、p50/p95 handler/frame 指标、丢点/long tasks、主观问题。

不要把真实签名、学生笔迹或个人板书 fixture 提交到 public repo。

## Web/PWA 与 PencilKit 决策输出

结束时按 `docs/03_PLATFORM_STRATEGY.md` 的 gate 给出：

- **Continue Web/PWA**：目标设备数据充分且达到事先写下的质量/性能目标；或
- **Run native PencilKit comparison spike**：列出具体失败指标和 Web 已尝试的修复；或
- **Unverified**：缺少物理设备/测量，不能作平台结论。

不能在本轮直接创建 iPadOS app；原生 spike 需新决策与新 prompt。

## 完成与停止

运行并记录真实命令；更新 architecture/decision/acceptance/baseline/NOTICE（如依赖变化）。最终输出：实现摘要、schema/算法决定、文件列表、命令结果、设备矩阵、性能与兼容数据、隐私/存储说明、未验证项、回滚/关闭方式、平台建议和提交拆分。

完成后停止。不要继续接模型或建立原生 app。

## 开始时重新核对的来源

- [W3C Pointer Events latest published version](https://www.w3.org/TR/pointerevents3/)
- [Apple PencilKit](https://developer.apple.com/documentation/pencilkit)
- [Apple Safari developer resources](https://developer.apple.com/safari/)
- 当前目标浏览器的 release notes / Web Platform Tests

这些链接记录方向；兼容性结论必须在执行当天和物理设备上重新验证。
