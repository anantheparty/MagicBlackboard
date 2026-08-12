# 06 — Pressure Ink V2 实现与验收

- 当前阶段：**Pressure Ink V2 simulated/browser implementation automated gate complete**
- 功能实现：**Implemented**
- 最终固定代码 commit `15844cd51015ee7441f83ac56f690bc21011210c` 本地门禁：**Verified**
- Pressure Ink V2 hosted CI（exact head
  `6d980e2a76bc42f6ce8ea853dd792a69394ab810`）：**Verified**
- 硬件兼容：**Not run**
- 平台结论：**Unverified**
- 更新日期：2026-08-13

本文件区分三类事实：代码和固定 commit 本地自动门禁已经验证；PR #6 的 hosted Linux/macOS
CI 已验证；Safari、iPad、Apple Pencil、数位板、真实 touch 和 PWA 仍未运行。maintainer
授权的是可回放、默认关闭的浏览器实现，不是硬件豁免或兼容性声明。

Foundation 入口证据仍在
[`baseline/2026-08-12-pressure-ink-v2.md`](./baseline/2026-08-12-pressure-ink-v2.md)；本轮
实现提交、预最终运行和最终本地证据见
[`baseline/2026-08-13-pressure-ink-v2.md`](./baseline/2026-08-13-pressure-ink-v2.md)；六次最终
synthetic benchmark 的完整 summary JSON 见
[`baseline/2026-08-13-pressure-ink-v2-benchmarks.json`](./baseline/2026-08-13-pressure-ink-v2-benchmarks.json)。

## 已实现范围

### 输入、能力判断与宽度生成

- 校验 PointerEvent-like 输入：无效/过大坐标、负或非有限时间会丢弃该 sample；有限的
  pressure、tilt/angle/twist/contact 被 clamp 到规范/实现边界，非有限可选值被省略。异常
  getter fail closed，倒序和重复 sample 被忽略并计入 dropped count。
- `getCoalescedEvents()` 返回非空数组时只消费 coalesced samples；空数组、抛错或非数组时
  回退 parent，避免 parent 与 coalesced 双重重放。predicted/raw-update 目前只报告 API
  availability，不进入最终几何。
- 每 pointer type 独立做有界 capability probe。只有 pen 在至少 4 个 active pressure samples、
  至少 2 个按 0.01 分桶的不同值且 `max - min >= 0.04` 后，才使用 hardware-pressure
  strategy。active `0.5` 常量、mouse、touch、未知或证据不足均为定宽 legacy fallback；
  `pointerType === "pen"` 本身不是压感证明。
- 默认 pressure curve 将归一化 pressure 用 smoothstep 映射到基准宽度的 `0.35`–`1.65`
  倍；sensitivity 默认 `1`、有效范围 `0.25`–`4`。宽度平滑系数为 `0.4`，点平滑系数为
  `0.7`，重采样间距为 `1.5 / max(0.01, zoom)` board units。
- fallback 是原有定宽自由画路径；本版本没有 velocity-width mapping、opacity mapping 或
  predicted-stroke rendering。
- down/move/up/cancel/lost capture/global up/two-finger navigation/viewport 与 orientation change
  有显式结束路径。预览写入由每一笔自己的可取消 `requestAnimationFrame` 合并，结束或
  dispose 时释放 pointer capture、监听器与 frame。

### 可选文件格式与绘制

保留既有 `points` 和标量 `strokeWidth`，只增加以下 optional 数据：

```ts
type PressureInkV1 = {
  version: 1;
  widths: number[];
};
```

valid v1 的接受条件是：对象只含 `version`/`widths` 两个 key；`version === 1`；`widths` 是
dense、非空数组，与 `points` 一一对齐且不超过 20,000 项；每项为 `0.01`–`96` 的有限
number。导入接受范围内的任意有限小数；本实现自己生成/持久化宽度时才四舍五入到小数点
后 2 位。因此“最多两位小数”不是导入 schema 约束。

有效数据由 deterministic filled-SVG variable-width geometry 重绘。闭合 stroke 若重复首尾
point，则首尾 width 也必须一致；不一致时安全降级。坐标绝对值上限为 `1,000,000,000`。
missing、malformed、unknown-version、额外 ink key 或无法构造有限几何的数据都忽略 `ink`，
继续显示原 RoughJS stroke，不会让 element 消失。

valid v1 已接入 bounds、hit test、marquee、move、rotate、undo/redo、copy/paste/fragment、
export/import 与产品本地持久化。当前无法无损表示 variable-width anisotropic resize，因此：

- 只要 selection 含 valid v1 ink，resize handle 不提供该操作；
- 若底层仍收到 resize 操作，整组 mixed selection 原子 no-op，不产生部分缩放或 history；
- move 与 rotate 继续工作；legacy freehand resize 保持原行为。

这是一项已知、显式的 V2 限制，不应描述为完整 variable-ink resize 支持。

### Feature、诊断、生命周期与持久化

- `magic.pressure-ink` 与 `magic.ink-diagnostics` 是独立 feature，均默认 off；一个不会暗中
  启用另一个。
- 两者只在 development build 标记 available；production build 中均 unavailable/fail closed，
  即使残留设置为 true 也不改变输入行为。
- diagnostics 是每 runtime、内存内、默认容量 256 的坐标无关摘要；不存 raw points、raw
  pressure stream、event object、设备 ID 或 wall-clock 历史，也不写 IndexedDB、日志、分析
  或网络。关闭 diagnostics feature 才停止采集；关闭 console 只停止 UI subscription/rAF
  refresh，不能被描述为关闭采集。
- 一个 board 拥有一个 runtime/ink controller。Strict Mode discarded mount、正常 unmount、
  plugin cleanup 和异常初始化均按资源所有者反向释放；console 不参与笔迹正确性。
- 产品存储仍由 `apps/magic-blackboard` 管理并版本化。合法最终宽度可保存；raw input 和可疑
  同义字段会触发 fail-closed storage lock。解析/校验失败不会用默认值覆盖可恢复的原槽位。
  `.drawnix` 导入是经完整校验后的 document replacement，不与当前 board 合并。

### 导入资源上限与隐私

浏览器在读取/解析前拒绝超过 32 MiB 的 `.drawnix` 文件。v1/web envelope 还限制最多
5,000 个 element、整个 JSON tree 最多 2,000,000 个 values、最大嵌套深度 128，并校验唯一
ID、支持的 element schema、有限数值、viewport 与 theme。单个待嵌入图片的源文件上限为
8 MiB，在 FileReader/decoder 分配前检查。Safari FileReader error/abort 走显式 reject。

这些限制控制导入分配与公开仓库数据边界，不构成对所有浏览器内存条件的保证。fixture 和
benchmark 只使用 synthetic 内容；没有新增 AI SDK、provider、API key、遥测 endpoint 或
第三方运行时依赖。

## 兼容性证据边界

- feature off、新 API prop 省略、mouse/touch/无可靠 variable pressure 时保持 legacy 路径，
  新 stroke 不含 `ink`。
- legacy/default-off capture 与单元素导入最多 100,000 points；达到上限后停止追加，仍可
  保存和恢复已接受的笔迹。该安全边界不作为 pressure feature 行为或硬件能力证据。
- 仓库内 legacy 与 valid-v1 `.drawnix` fixture 覆盖新消费者 round trip。
- 在独立临时 checkout 中，未修改的上游 baseline `b0d682c` Drawnix suite 加一个临时消费
  测试后为 11 files / 27 tests passed：旧 renderer 可显示含 optional `ink` 的 fixture，
  `Transforms.setNode` 和旧 serializer 保留未知字段。该证据说明这个具体旧消费者可忽略该
  additive field；不是所有旧客户端的普遍保证。临时 checkout 的独立 TypeScript 命令因其
  既有 SCSS/Vite 配置问题失败，未被写成通过。
- 固定代码 commit `15844cd51015ee7441f83ac56f690bc21011210c` 在 clean worktree 上通过本地
  install、lint、format、301 tests、build、typecheck、20 个 direct TypeScript config、Magic
  system-Chrome E2E 5/5、production dependency audit 与两种 mode 各三次 benchmark。完整命令、
  duration、warning 和限制保存在本轮 baseline。
- PR [#6](https://github.com/anantheparty/MagicBlackboard/pull/6) 的
  [workflow run 31623248572](https://github.com/anantheparty/MagicBlackboard/actions/runs/31623248572)
  以 `pull_request` event 在 exact head `6d980e2a76bc42f6ce8ea853dd792a69394ab810`
  **Verified**：macOS foundation job `94203061929` PASS（1m35s），Linux job
  `94203061818` PASS（2m49s）。Linux 在安装 Playwright browsers 后通过 affected E2E，补齐了
  本机 upstream `web-e2e` 因 bundled browsers 未安装而无法启动的环境限制；这仍不是物理
  Safari、Pencil、tablet、touch 或 PWA 证据。

## 自动验收状态

以下测试/实现覆盖已经存在；勾选表示固定代码 commit 上已有自动覆盖，仍不代表硬件兼容：

- [x] sample validation、coalesced parent fallback、monotonic ordering、dedupe 与 hostile getter。
- [x] capability evidence window、`0.5` fallback、mouse/touch/unknown 与 variable pen 分支。
- [x] curve、sensitivity、point/width smoothing、resampling、batch/stroke budgets。
- [x] pointer identity、capture、cancel/lost/global/two-finger/viewport/orientation 和 dispose。
- [x] feature-off/default Drawnix、legacy fixture、malformed/unknown/fixed-width fallback。
- [x] valid v1 exact schema、renderer、closed stroke、bounds/hit/marquee 与 resize no-op。
- [x] undo/redo、copy/paste/fragment、export/import、product persistence 与 document replacement。
- [x] 两 runtime 隔离、Strict Mode/remount、listener/frame/plugin/console lifecycle。
- [x] diagnostics capacity、redaction、production unavailable 与关闭 console 后 UI 不再刷新。
- [x] file/image preflight limits、v1/web envelope 与 supported schema、Safari FileReader failure paths。
- [x] legacy 和 simulated-pressure 两种 benchmark 均在没有真实落盘目标 stroke 时 fail hard。
- [x] Pressure 自动门禁后的独立 follow-up 为 development Console 增加 44px 可触控 launcher，
      覆盖点击/焦点恢复、`available=false` fail-closed，以及 390×844 Chromium 移动布局仿真。
      固定代码 commit 与证据单独记录，且不改写本轮 Pressure fixed-commit 结果。

release evidence：

- [x] 在固定代码 commit 记录 `npm ci`、lint、format check、uncached workspace tests/build、
      Magic targets 和 system-Chrome E2E 的命令、退出码、日期与 warning。
- [x] 在相同固定代码 commit 重新运行 legacy 与 simulated-pressure benchmark 各三次，保留
      完整 summary JSON、方法和局限。
- [x] PR #6 的 hosted Linux/macOS CI 已记录 workflow run `31623248572`、exact head
      `6d980e2a76bc42f6ce8ea853dd792a69394ab810` 和两个 PASS job。

额外尝试 upstream `web-e2e` 时，其 Chromium、Firefox、WebKit 三个 project 都在 launch 前因
本机未安装对应 Playwright bundled browser 而失败，没有执行 product assertion。这个本地环境
限制被原样保留，不能写作本地测试通过；hosted Linux CI 已安装 Playwright browsers，并通过
affected E2E，从托管环境补齐了该限制。

## 物理设备与平台停止条件

以下均为 **Not run**，不能被 Foundation merge、单元测试、Chromium E2E 或 synthetic
PointerEvent 自动勾选：

- 完整 desktop Chromium 手工工具/持久化/console/two-tab/import-export 矩阵；
- Safari macOS mount、工具、快捷键、storage、resize 和可选数位板；
- 窄屏与真实 touch 的 toolbar、gesture、页面滚动和多指冲突；
- iPad Safari tab 与 Home Screen web app 的横竖屏、Apple Pencil、刷新恢复和输入质量；
- 命名 PC/macOS 数位板及其 driver；
- 共享 origin、真实 subpath、offline/update/旧 cache/client-route/install 等 PWA 场景。

开发控制台 launcher follow-up 的 390×844 `hasTouch` + 移动 UA E2E 只验证 Chromium 中的
入口可达性、44px 命中区和 mobile layout 分支；它不关闭上面的真实 touch、Safari、iPad、
Pencil 或 PWA 项。

命名矩阵见 [`03_PLATFORM_STRATEGY.md`](./03_PLATFORM_STRATEGY.md)。下一步需要 maintainer
提供或采购明确型号的 iPad/Apple Pencil 与 desktop tablet，并按同一任务
记录 OS、浏览器、driver、capability、fallback、p50/p95、long tasks、丢点、误触与主观问题。
在此之前，输出仍是 **Unverified**，既不是 **Continue Web/PWA**，也不是 **Run native
PencilKit comparison spike**。
