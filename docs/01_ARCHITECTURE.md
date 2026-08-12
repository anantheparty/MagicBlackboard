# 01 — 架构与边界

本文描述 Foundation 完成后的结构和 Pressure Ink V2 的已实现浏览器扩展。Foundation 证据以
[`05_ACCEPTANCE_CRITERIA.md`](./05_ACCEPTANCE_CRITERIA.md) 为准；Pressure Ink V2 的实际状态
以 [`06_PRESSURE_INK_V2.md`](./06_PRESSURE_INK_V2.md) 和对应 baseline 为准。代码实现不
等同于最终固定 commit/hosted CI，也不等同于硬件或平台验证。

## 总览

```text
Browser / PWA
└─ apps/magic-blackboard                 product composition
   ├─ packages/drawnix                   reusable whiteboard UI/tools
   ├─ packages/magic-plait               PlaitCanvasAdapter
   ├─ packages/magic-runtime             per-board orchestration
   │  └─ packages/magic-core             pure contracts/events/features
   └─ packages/magic-console             optional diagnostics

Future, behind explicit phase gates
└─ Intent service port
   ├─ deterministic/replay implementation
   ├─ local small-model implementation
   └─ owned backend proxy -> hosted model provider
```

核心约束是“产品负责装配，通用库只暴露通用能力”。`packages/drawnix` 不认识 Magic runtime、教学模式、学科或模型；`magic-core` 不认识 React、DOM、Plait 或 provider SDK。

## 各层职责

### `apps/web`

上游 Drawnix 参考应用。它用于发现通用库的无意行为变化。Magic 功能不得直接加到这里；Drawnix 新增可选扩展点时，省略该 prop 的表现必须保持兼容。

### `apps/magic-blackboard`

产品 composition root，负责：

- 创建并持有本 board 的 runtime；
- 向 Drawnix 传入通用扩展点；
- board ready 后 attach canvas adapter，unmount 时反向 detach/dispose；
- 本地持久化、语言、产品 feature 默认值和开发控制台布局；
- 将来取得用户同意、选择上下文范围并调用模型 port。

它不应该复制 Drawnix 的工具实现，也不应直接散布 Plait 查询逻辑。

### `packages/drawnix`

保留自由画、形状、连接线、思维导图、文本、缩放、主题、导入导出等白板体验。Foundation 只允许添加最小、可选、向后兼容的扩展缝隙，例如追加 Plait plugins、利用已有 `afterInit` 取得 board、渲染通用 overlay。相同语义不能有两套 callback。

Pressure Ink V2 的通用 sample/curve/geometry/renderer、可选 schema、输入 lifecycle 和
bounded import validation 属于这里；它们不得
import Magic package。Magic 产品如何开关实验、展示诊断和保存策略仍由 app 与 Magic
packages 决定。具体格式和降级行为见
[`adr/0001-pressure-ink-v2-data-and-boundaries.md`](./adr/0001-pressure-ink-v2-data-and-boundaries.md)。

### `packages/magic-core`

纯 TypeScript 领域基础：typed event bus、bounded ring buffer、feature registry、settings 接口，以及不绑定具体 UI/画布的事件和值对象。它必须能在无 DOM 的单元测试中运行。订阅返回清理句柄；dispose 后行为可预测；ring buffer 固定容量。

### `packages/magic-plait`

反腐层。`PlaitCanvasAdapter` attach/detach 一个 board，并把 mutable Plait 状态转成 Magic 可消费的快照/事件：文档元素、当前选择、按 ID 查询、选择 bounds、viewport 与 world/screen 坐标转换。它拥有 Plait 监听器的注册与清理，外部不得依赖私有 Plait 字段。

### `packages/magic-runtime`

每 board 一个实例，聚合 runtime ID、features、events、settings 和 canvas port。构造不依赖全局变量；dispose 幂等并释放所有子资源。Actor 和 intent 在 Foundation 只能是明确的 port/availability 状态，不能返回伪造推断。

### `packages/magic-console`

开发可观测界面，读取公开 runtime/adapter 合约，不成为业务真相来源。关闭时不订阅或渲染
高频事件；production 默认不可见，仅通过公开的非密钥构建配置显式开启 console shell。
Pressure Ink V2 两个 feature 在 production build 中仍 unavailable。诊断数据有容量上限并
随 runtime 释放；关闭 console 只停止 UI subscription/rAF refresh，采集本身由独立
`magic.ink-diagnostics` feature 控制。

## 生命周期

一个正常的挂载顺序：

```text
mount app
  -> load versioned preferences with safe defaults
  -> create runtime (unique id)
  -> create/install additional generic Plait plugins
  -> mount Drawnix
  -> Drawnix afterInit(board)
  -> canvasAdapter.attach(board)
  -> expose diagnostics

unmount app
  -> detach console subscriptions
  -> cancel stroke-local frame/pointer capture/input listeners
  -> dispose Drawnix-owned board/plugin/image/eraser resources
  -> dispose ink controller
  -> canvasAdapter.detach()
  -> runtime.dispose()
  -> remove app-level listeners/timers
```

初始化中途失败也必须走已经创建资源的反向清理。dispose 应幂等；React Strict Mode 下的 mount/unmount/remount 不能积累监听器。禁止 module-level runtime 或 board singleton。

## 状态与持久化

产品命名空间固定为：

- `magic_blackboard.board.v1`
- `magic_blackboard.preferences.v1`
- `magic_blackboard.features.v1`
- `magic_blackboard.console.v1`

`board.v1` 至少容纳 board children、viewport、theme 和必要 tool state；preferences、feature flags、console UI 状态相互隔离。保存层必须满足：

- schema/version 可识别，字段缺失有安全默认值；
- 解析或迁移失败不覆盖原值；
- 不支持、含隐私风险或不满足 schema 的 document 使该 storage slot fail closed，后续普通
  编辑也不能静默覆盖可恢复原值；
- 高频 pointer samples、事件流和模型 prompt/response 不进入这些 namespace；
- 未来格式变更先写 migration 与 round-trip 测试；
- “清空白板”与“清空设置/诊断”是不同操作。

`.drawnix` import 先验证 v1/web envelope discriminants、支持的 element schema/唯一 ID、finite tree、viewport
与 theme，再进行完整 document replacement。浏览器在读取/解析前限制文件为 32 MiB；最多
5,000 elements、2,000,000 tree values、深度 128。单个待嵌入图片源文件为 8 MiB 上限。上述
限制属于不可信文件边界；产品本地 storage 有独立的版本化校验，不复用 live mutable
Plait 对象作为长期契约。

浏览器存储不是加密保险箱。使用共享设备时，任何同一浏览器 profile 的人都可能访问内容；产品上线前需提供清晰的导出、删除和共享设备提示。

Foundation 不提供多 tab 同步或协作。同一 origin 的两个 tab/board instance 各自保留内存状态并写相同的版本化 namespace；写入采用 last-writer-wins，另一个已打开的实例不会收到实时更新。需要并发编辑前必须先设计文档 ID、冲突处理与跨 tab/服务端同步协议，不能把当前 localforage 行为描述为协作。

## 事件和快照

事件表示已经发生的事实，命令表示希望发生的动作，不要混用。建议 envelope：

```ts
type MagicEvent<TType extends string, TPayload> = {
  id: string;
  runtimeId: string;
  type: TType;
  occurredAt: number;
  payload: TPayload;
};
```

EventBus 必须同步或异步语义明确、订阅可 dispose、一个 handler 失败不造成不可解释的泄漏。控制台可保存 envelope 的裁剪摘要；board element 大对象和 pointer 原始序列应被摘要化。

Canvas snapshot 是调用时刻的不可变视图。选择/文档/viewport 事件只携带消费者真正需要的信息；若消费者需要完整内容，应通过 adapter 的显式查询读取，避免每次 pointer move 复制整块文档。

## 上下文与意图（未来）

目标数据流如下，但 Foundation 只提供前面的 runtime/event/canvas 基础和空 port：

```text
explicit mode + board snapshot + recent bounded events
  -> context assembler (provenance, freshness, confidence)
  -> intent candidate(s)
  -> policy gate (availability, confidence, scope, consent)
  -> previewable command plan
  -> user confirmation when required
  -> reversible board operation
  -> outcome event for evaluation
```

上下文不能是一个不断追加的巨大 prompt。推荐由四组可失效值组成：

- session：显式教学/学习/演示/自由创作模式；
- domain：数学、物理、语言等候选及来源；
- canvas：选择区、可见区、元素摘要、最近改动；
- interaction：短时间窗内的工具/操作序列。

每个推断值至少包含 `value`、`source`、`observedAt`、`confidence`、`version`。`unknown` 是正常结果。用户修正必须覆盖推断并成为评估反馈，但不得静默变成训练数据。

意图服务返回结构化候选而不是自由文本命令：

```ts
type IntentCandidate = {
  kind: string;
  confidence: number;
  rationaleCode: string;
  evidenceRefs: string[];
  proposedAction?: unknown;
  requiresConfirmation: boolean;
};
```

真实 schema 在模型阶段通过版本化测试确定。不要在 Foundation 伪造固定置信度或“已识别”状态。

## 安全边界

浏览器是非可信客户端。未来云模型调用路径只能是：

```text
browser --authenticated, minimized request--> owned backend proxy
        --server-side credential--> provider
```

代理需做身份/权限、schema 校验、大小限制、超时、速率与费用上限、内容裁剪、审计元数据和 provider 错误归一化。provider key 不得进入 `VITE_*`、bundle、浏览器存储、board 文件、日志或 GitHub。默认只发送选择区/必要摘要；完整白板、图片、历史笔迹需要逐次清晰同意。

## 性能边界

- 热输入路径不做网络、存储、模型调用或全 React tree 更新。
- 原始输入诊断使用固定容量 ring buffer；控制台关闭后停止高频订阅。
- adapter 事件合并策略需要写清；消费者不得同时重复处理 parent pointer event 和全部 coalesced events。
- 大 board 查询按 ID/选择范围进行；整板 snapshot 的频率必须可控。
- 性能结论需注明设备、浏览器、OS、元素量和采样方法。

## Pressure Ink V2 已实现数据流

状态：**Implemented in working tree; final fixed-commit verification Pending**。

```text
PointerEvent (+ coalesced events when available)
  -> validated samples; non-empty coalesced XOR parent fallback
  -> monotonic ordering / deduplication / bounded capture
  -> per-pointer capability evidence
  -> variable pen pressure OR fixed-width legacy fallback
  -> coordinate conversion
  -> point smoothing 0.7 + resample spacing 1.5 / zoom
  -> pressure curve 0.35..1.65 + width smoothing 0.4
  -> stroke-local rAF transient preview
  -> compact final widths (2-decimal generation) aligned with existing points
```

热路径不保存 raw event、device ID 或完整 pressure history。旧 element 和无效/未知 `ink`
数据继续走原 RoughJS 路径；pressure feature 默认关闭，mouse/touch/constant `0.5`/证据不足
也不会生成 `ink`。只有 pen 在至少 4 个 active samples、至少 2 个 0.01 pressure buckets 且
spread `>= 0.04` 后进入 variable strategy；没有 velocity 或 predicted geometry。

optional v1 `ink` 只接受 exact `{ version: 1, widths }`；dense/non-empty/aligned widths 最多
20,000 项，每项为有限 `0.01`–`96`。legacy/default-off 笔迹不含 `ink`，capture 与单元素
import 上限为 100,000 points，避免产品生成无法再次加载的文档。import 接受范围内任意有限小数，只有本实现生成值量化
到 2 位。有效 v1 使用 filled SVG geometry；missing/malformed/unknown 回退 RoughJS。有效 v1
的 move/rotate 可用，resize 对整个含 ink 的 mixed selection 原子 no-op，legacy resize 不变。

Drawnix 承担通用机制，Magic app/core/runtime/console 承担 feature、每 board 生命周期、产品
持久化与有界诊断 policy。`magic.pressure-ink` 与 `magic.ink-diagnostics` 只在 development
available、分别默认 off；production 均 unavailable/fail closed。

## 扩展一个新能力时放在哪里

| 变化                                           | 正确落点                                     |
| ---------------------------------------------- | -------------------------------------------- |
| 通用 Drawnix 可选 callback/overlay/plugin seam | `packages/drawnix`，带默认兼容测试           |
| Plait selection/bounds/coordinate 读取         | `packages/magic-plait`                       |
| 无框架事件、feature、settings 契约             | `packages/magic-core`                        |
| runtime 生命周期或能力装配                     | `packages/magic-runtime`                     |
| Magic 品牌、布局、持久化与用户 consent         | `apps/magic-blackboard`                      |
| 开发诊断视图                                   | `packages/magic-console`                     |
| provider 具体实现                              | 未来独立 adapter/server 边界，先更新决策记录 |

## 研究依据（访问于 2026-08-12）

- [Plait 官方仓库](https://github.com/worktile/plait)：核心与 UI 框架解耦、plugin-based 的既有设计。
- [Nx project graph mental model](https://nx.dev/docs/concepts/mental-model)：以 project/task graph 管理 monorepo 边界与 affected work。
- [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)：pressure 与 coalesced/predicted event 的语义和隐私注意事项。
- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)：以 hosted provider 为例，官方明确要求不要把 key 部署在浏览器/移动客户端，应经自有 backend。
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication)：API reference 要求 key 从服务端环境变量或 key-management service 加载。
