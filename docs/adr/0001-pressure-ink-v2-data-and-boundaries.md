# ADR 0001 — Pressure Ink V2 数据与边界

- 决策状态：**Accepted**
- 实现状态：**Implemented at `b3c992f`; final fixed-commit verification Pending**
- 决策日期：2026-08-12
- 实现更新：2026-08-13
- 适用范围：Pressure Ink V2 simulated implementation
- 关联工作单：[`../../prompts/03_PRESSURE_INK_V2.md`](../../prompts/03_PRESSURE_INK_V2.md)
- 入口证据：[`../baseline/2026-08-12-pressure-ink-v2.md`](../baseline/2026-08-12-pressure-ink-v2.md)
- 实现/待补最终证据：[`../baseline/2026-08-13-pressure-ink-v2.md`](../baseline/2026-08-13-pressure-ink-v2.md)

## 背景

Foundation merge `21cc3a9abbd5f28999c7e44fe03c8b69fe9ae0d4` 已提供白板、每 board
runtime、Plait adapter、feature registry、开发控制台和产品持久化。Pressure Ink V2 需要在
不改变 Drawnix 默认自由画、不破坏旧 `.drawnix` 文件且不扩大输入数据收集面的前提下，
增加可关闭的 variable-width 实验路径。

commit `b74a392380e482298c080924d6a3e10f54ca0af4` 保存了旧 freehand synthetic fixture。
它只有既有 `points`、标量 `strokeWidth` 和其他旧字段，没有 `ink`；两项回归锁定 legacy
序列化/读取基线。这个 fixture 是兼容性证据，不是压感实现证据。

## 决策

### 1. 保留既有字段，增加可选最终几何

现有 `points` 和标量 `strokeWidth` 的含义、形状与必要性不变。Pressure Ink V2 只允许增加
一个可选字段：

```ts
type PressureInkV1 = {
  version: 1;
  widths: number[];
};

type FreehandElement = ExistingFreehandElement & {
  ink?: PressureInkV1;
};
```

`widths` 与最终 `points` 一一对应，保存的是重绘所需的派生宽度几何，不是浏览器原始
pressure stream。v1 的 exact 接受条件为：对象只含 `version` 与 `widths` 两个 key；
`version === 1`；`widths` 是 dense、非空数组，与 `points` 等长且不超过 20,000 项；每项是
`0.01`–`96` 的有限 number。导入接受范围内的任意有限小数；本实现自己生成/持久化的
widths 才量化为小数点后 2 位，不能把生成策略误写成 importer 约束。

坐标的绝对值上限为 `1,000,000,000`。闭合 stroke 使用重复首尾 point 时，首尾 width 也
必须相同才进入 variable renderer，否则降级 legacy。以上约束由表驱动 schema/geometry
测试锁定。

不进行破坏性 eager migration，也不删除或改写旧字段。仓库内 valid-v1 fixture 与独立旧
baseline consumer 测试表明 additive `ink` 会被该旧消费者保留并由旧 RoughJS 路径显示；
这不是所有历史或第三方客户端的普遍保证。

### 2. 旧数据与错误数据 fail closed

- 没有 `ink` 的 legacy element：继续走原 RoughJS 自由画渲染。
- `ink.version` 未知、宽度数组缺失/长度不一致、NaN/Infinity 或其他 malformed 数据：忽略
  `ink`，继续走原 RoughJS 路径；不得导致 element 消失、文档拒绝加载或覆盖可恢复原值。
- pressure feature 关闭：新输入保持 Foundation 的默认自由画行为和文件形状。
- valid v1 ink 的 import/export、undo/redo、copy/paste、fragment、local persistence、bounds、
  hit test、marquee、move 与 rotate 已实现并有自动回归。
- valid v1 ink 的 anisotropic resize 当前无法无损表达：含它的 selection 隐藏 resize handle，
  底层 resize 操作对整个 mixed selection 原子 no-op；legacy resize 不变。该限制不能被
  描述为完整 resize 支持。

### 3. 数据最小化

文档只可保存上述最终宽度几何，不保存：

- raw pressure、完整 `PointerEvent` 或 coalesced/predicted event 对象；
- device/stylus identifier、driver fingerprint 或跨会话 capability fingerprint；
- wall-clock timestamp；
- tilt/altitude/azimuth 的完整历史；
- 开发控制台的 raw ring buffer 或完整诊断记录。

capability/质量诊断只能是每 board、固定容量、内存内的短期数据；dispose 后释放，默认不上
IndexedDB、console log、analytics 或网络。未来若研究需要持久化或上传，必须另写同意、
采样、脱敏、保留期和删除策略，不属于本 ADR。

### 4. feature 必须拆分并默认关闭

- `magic.ink-diagnostics`：只控制有界开发诊断和能力摘要，默认 **off**。
- `magic.pressure-ink`：只控制 pressure-aware capture/width/render 实验，默认 **off**。

两者不能互相暗中启用。未知、不可用、settings read/write failure 均 fail closed。每 board
runtime 的开关与监听必须隔离，detach/dispose/remount 不得遗留 listener。当前两者只在
development build available；production build 中均 unavailable/fail closed。未来 production
rollout 需要新的明确决定，dev 模拟通过不会自动授权。

diagnostics 默认容量为每 runtime 256 条坐标无关摘要。关闭 diagnostics feature 停止采集；
关闭 console 只停止 UI subscription/rAF refresh。摘要和 collection lifecycle 不能依赖
console 是否打开。

### 5. 通用机制与产品 policy 分层

| 层                       | 责任                                                                                                                                                 | 禁止                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/drawnix`       | 通用 sample validation、coalesced expansion、curve/width、optional schema/validator、variable-width render primitive、legacy fallback、通用可选 seam | import Magic feature/runtime；写产品 storage；宣称 Apple Pencil 支持 |
| `apps/magic-blackboard`  | 产品 composition、默认关闭的 rollout、产品持久化、用户可见 capability/fallback 文案                                                                  | 把 raw input 持久化；复制一套 Drawnix renderer                       |
| `packages/magic-core`    | framework-free typed contracts、feature 定义、bounded summary/ring buffer                                                                            | React/DOM/Plait/provider SDK                                         |
| `packages/magic-runtime` | 每 board feature/diagnostics lifecycle 与 dispose                                                                                                    | module-level singleton 或硬件品牌 policy                             |
| `packages/magic-console` | dev-only capability/quality 摘要；关闭时停止高频 UI 更新                                                                                             | 成为业务真相源或决定笔迹正确性                                       |
| `packages/magic-plait`   | 仅在需要时翻译 Plait board/coordinate/lifecycle 细节                                                                                                 | Magic 产品 rollout 或 live mutable Plait 泄漏                        |

### 6. 回滚

出现兼容、性能或输入质量问题时，先关闭 `magic.pressure-ink` 和
`magic.ink-diagnostics`；新输入回到旧自由画路径。由于 `points`、`strokeWidth` 和 legacy
renderer 均保留，回滚不需要重写已有文档。已经含 valid v1 `ink` 的文件仍由
variable-width renderer 显示；缺失、无效或未知 `ink` 由 RoughJS 显示。若需要彻底回退
variable renderer，必须先定义现有 valid-v1 文件的降级/迁移策略，不能删字段或静默丢失。

### 7. 算法与资源界限

- 只有 pen 在至少 4 个 active pressure samples、至少 2 个按 0.01 分桶的值且 spread
  `>= 0.04` 后进入 hardware-pressure；其他输入使用原有定宽 fallback，没有 velocity 或
  predicted geometry。
- 默认 pressure factor 为 `0.35`–`1.65`，sensitivity 范围 `0.25`–`4`；宽度平滑 `0.4`，
  点平滑 `0.7`，重采样间距 `1.5 / max(0.01, zoom)`。
- `.drawnix` 在读取/解析前限制 32 MiB；最多 5,000 elements、2,000,000 tree values、深度
  128。单个待嵌入图片源文件限制 8 MiB，并在 FileReader/decoder 前检查。
- legacy/default-off freehand capture 与单元素导入最多 100,000 points；达到边界后停止追加，
  使产品生成的旧格式笔迹仍处于相同的导出、导入和恢复契约内。
- 产品 storage 对 raw input、同义敏感字段或无效 schema fail closed，保留可恢复原槽位；
  导入是完整 document replacement，不与现有 board 合并。

## 被否决方案

- 用 raw pressure 数组、浏览器 event 或设备 ID 直接作为长期文档格式：数据多于重绘所需，
  增加隐私、体积和浏览器耦合。
- 替换 `points` 或把 `strokeWidth` 改成数组：破坏旧消费者与默认路径。
- 让一个诊断 feature 同时改变笔迹：观察与行为无法独立关闭，回滚和实验归因不清。
- 把 Magic feature policy 放入 Drawnix：造成反向依赖并污染上游通用层。
- 现在引入 PencilKit/Swift、hybrid wrapper 或第二 renderer：没有物理设备和 Web gate 证据，
  超出当前授权。

## 验证门

实现及对应自动回归已覆盖 legacy、missing/malformed/unknown-version、valid v1、feature-off、
`apps/web` compatibility、round trip、persistence、bounds/hit test 与 lifecycle。它们在
实现提交中是 **Implemented**；最终固定 commit 的 clean gates 与 hosted CI 仍为
**Pending**，不得由本 ADR 的 Accepted 状态替代。

Safari、iPad/Pencil、desktop tablet、实体 mouse、touch 和真实 PWA 的命名设备矩阵全部
**Not run**。synthetic handler/frame/long-task/memory 数据只比较浏览器代码路径，不能证明
硬件 latency 或质量。平台结论必须保持 **Unverified**。
