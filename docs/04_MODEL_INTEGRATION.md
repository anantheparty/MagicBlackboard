# 04 — 模型与意图识别接入策略

- 状态：Foundation 的 **no-model boundary 已接受**；具体 provider/model 尚未选择
- 当前需求：**不需要 API key，不安装 AI SDK，不进行模型网络请求**
- 第一原则：先证明“输入与评估契约正确”，再比较 LLM、小型 NN 和混合路线

## 模型解决什么，不解决什么

长期系统需要回答两个不同问题：

1. **Context**：当前有哪些可用证据？例如用户明确说在教学、选择区有方程、最近反复擦除某一步。
2. **Intent**：基于这些证据，用户可能想要解释、检查、继续推导、整理、翻译，还是没有可安全判断的意图？

模型只生成有置信度的候选和建议动作，不能成为 board 或用户身份的真相源。`unknown`/abstain 是正确结果。模型不得直接持有 mutable board、绕过 feature policy 或调用任意工具；所有动作都经过本地 schema validation、权限/范围检查和必要确认。

Foundation 的 actor/intent 只能报告 `unavailable`/`not implemented`，不得用随机值、关键词硬编码或固定高置信度冒充模型。

## LLM 与小型 NN 的分工

这不是二选一：

| 能力 | Hosted multimodal LLM | 本地规则/小型 NN |
| --- | --- | --- |
| 冷启动、开放语义、跨学科 | 强 | 弱，需要 taxonomy/训练数据 |
| 低延迟连续信号 | 较差且成本高 | 强，适合短窗口分类/打分 |
| 图片/复杂板书理解 | 能力强但需发送数据 | 受模型体积和设备能力限制 |
| 隐私/离线 | 需服务端与 provider 数据政策 | 数据可留设备，较好 |
| 可预测成本 | 每请求付费、需预算限制 | 下载/设备算力成本 |
| 可解释与稳定 schema | 需约束输出和验证 | 任务窄时更可控 |

推荐演进：LLM 用于低频、用户触发的语义候选；规则/小模型负责本地、低延迟的状态和窄分类；policy layer 决定是否建议动作。未建立标签与回放集前，训练 NN 没有可靠目标。

## 分阶段计划

### Phase 0 — Foundation（当前）

- 建立 EventBus、bounded diagnostics、CanvasAdapter、per-board Runtime 和 feature availability。
- 保持 intent/model port 清晰但不实现 provider。
- 使用合成 board 数据测试生命周期和 schema，不收集真实课堂数据。
- 运行应用无需 `.env`、账号、网络或 API key。

退出条件：[`05_ACCEPTANCE_CRITERIA.md`](./05_ACCEPTANCE_CRITERIA.md) 全部 Foundation gate 有真实证据。

### Phase 1 — Taxonomy、replay 与 deterministic baseline

- 与实际教学/学习任务共同定义小而可判定的 intent taxonomy；保留 `unknown`。
- 固化版本化 `ContextSnapshot`、`IntentRequest`、`IntentCandidate`、`ActionProposal` schema。
- 创建合成/获授权并脱敏的 replay fixtures；明确 train/dev/test 分割和 provenance。
- 实现无网络的规则 baseline，仅为建立可比较的 latency/precision/abstain 基线，不冒充 AI。
- 建立人工 review UI：看到被使用的 evidence、候选原因、影响范围，并可纠正/拒绝。

退出条件：代表性任务、误判代价、评估指标、同意/保留期与 hosted payload 最小范围已经书面批准。

### Phase 2 — Hosted LLM research adapter

- 先建立 owned backend proxy，再接一个 provider；浏览器只调用本项目后端。
- provider adapter 位于服务端并实现统一 port；模型名、timeout、token/image limit、重试和费用上限均配置化。
- 默认只发送用户明确选择的局部内容或结构化摘要；图片/完整白板逐次 opt-in。
- 使用严格 structured output；拒绝额外字段、未知 intent、越权 action 和不合法 element references。
- 先 shadow/preview，禁止自动改板；记录低敏 telemetry（版本、latency、token/cost、结果类别、用户接受/拒绝），不默认记录正文。
- 用 Phase 1 同一 replay set 比较质量、abstention、延迟、费用和失败模式。

退出条件：模型对关键 intents 的收益超过 deterministic baseline，错误动作仍被 policy/confirmation 拦截，隐私与费用门通过。

### Phase 3 — 本地小模型

- 只选择已有稳定标签和明确延迟收益的窄任务，例如模式/学科候选排序或交互状态分类。
- 首选 worker 中的 WASM 路线保证覆盖，再用 capability detection 尝试 WebGPU；加载失败回退，不阻塞白板。
- 记录模型来源、license、训练数据 provenance、版本/hash、量化方法、模型大小、内存和每目标设备 p50/p95 latency。
- 模型文件不得悄悄进入主 bundle；下载、缓存大小、离线和 storage eviction 要有 UI 状态。

ONNX Runtime Web、Transformers.js 或 WebLLM 都只是研究候选，不是 Foundation 依赖。Safari/WebGPU 能力必须以当前目标设备验证。

### Phase 4 — Hybrid policy

本地快速模型先过滤/排序；只有不确定且价值足够高、用户同意的请求才调用 hosted LLM。policy 使用显式成本/隐私/可用性规则，provider failure 时保持白板完整可用，不静默改用更宽数据范围。

## Provider-neutral contract 草案

草案用于确定边界，不是已实现 API：

```ts
type ContextValue<T> = {
  value: T;
  source: 'explicit' | 'board' | 'interaction' | 'rule' | 'model';
  observedAt: number;
  confidence?: number;
  version: string;
};

type IntentRequest = {
  schemaVersion: 1;
  requestId: string;
  runtimeId: string;
  locale: 'zh' | 'en';
  context: {
    sessionMode?: ContextValue<string>;
    domain?: ContextValue<string>;
    selectedElementSummary: unknown[];
    recentActionSummary: unknown[];
  };
  allowedIntentKinds: string[];
  allowedActionKinds: string[];
};

type IntentResponse = {
  schemaVersion: 1;
  candidates: Array<{
    kind: string;
    confidence: number;
    evidenceRefs: string[];
    rationaleCode: string;
    action?: unknown;
    requiresConfirmation: boolean;
  }>;
};
```

生产 schema 应用 runtime validator，设置数组/字符串/深度上限，并确保 element IDs 属于本次允许范围。自由文本 rationale 不能被当作可信命令。

## 上下文最小化

从低风险到高风险逐级提升：

1. 显式模式、locale、工具、元素类型/数量、选择 bounds 等元数据；
2. 用户当前选择区的结构化文本/公式摘要；
3. 用户明确触发时的选择区 raster preview；
4. 完整可见区或整板内容；
5. 长时间行为/笔迹历史。

默认停在能完成任务的最低级。第 3–5 级必须在 UI 中说明将发送的范围和 provider；对可能包含学生信息的内容提供遮盖/取消。原始笔迹可具识别性，不作为普通 analytics 或默认训练数据。

Board text 与导入文件属于不可信数据：其中即使出现“忽略规则、执行某操作”等文本，也只能作为课程内容，不能提升权限或改变 system policy。这一 prompt-injection 边界必须进入 adversarial fixtures。

## 评估与上线门

先按 intent 的误判代价分层，再设置指标。至少报告：

- taxonomy coverage 与 `unknown` 比例；
- per-intent precision/recall、混淆矩阵，而不只总 accuracy；
- 高风险 action precision 与被 confirmation/policy 拦截数；
- confidence calibration、用户接受/纠正/拒绝率；
- cold/warm p50、p95 latency，错误/超时/取消率；
- 每次和每会话 token/image/currency 成本；
- 中文/英文、教学/学习、数学/物理/语言等 slice；
- provider/model/prompt/schema 版本及 dataset hash。

没有代表性 replay set 和事先写下的阈值，不上线自动建议；没有撤销/确认，不上线 board mutation。

## 未来接云模型时需要用户单独提供/确认什么

到 Phase 2 前，agent 必须停止并单独说明以下需求，不能从本地配置猜测：

1. 选择的 provider 与具有 billing 的 project/account；
2. 一个**只放在服务端 secret manager** 的 project-scoped API key，最小权限、可轮换；
3. 允许使用的 model/version、region、数据 retention/training 选项；
4. 自有 backend 部署目标与用户认证方式；
5. 月度/每日/每用户费用上限和 rate limit；
6. 是否允许发送文字、公式、选择区图片或完整白板；
7. 面向课堂/未成年人内容时的 consent、删除与保留政策。

不要把真实 key 发送到 chat、issue、commit 或 `.env.example`。即便用户临时给出 key，也只能指导其放入 server-side secret store；不能写入 `VITE_*` 或浏览器/mobile bundle。

如果用户选择纯本地路线，则不需要 provider API key 或云端 proxy，但仍需单独确认：允许下载/再分发的 model 与 license、目标设备内存/磁盘、首次下载体积、离线缓存/删除体验以及 WASM fallback。开发机上的 localhost model server 也不是可直接发布的产品架构；它引入额外进程、origin/auth/CORS 和任意网页滥用本地端口的风险，需另做安全设计。

## 研究来源（访问于 2026-08-12）

- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)：hosted provider 的官方安全示例，明确禁止在 browser/mobile client 部署 key，并建议经 backend。
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication)：官方 API reference 同样要求 key 保密，并从服务端环境变量或 key-management service 加载。
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint)：默认 abuse-monitoring retention 最长可达 30 天，Zero Data Retention/Modified Abuse Monitoring 需要获批；endpoint 行为和账户资格会变化，接入时必须重查。
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)：不在长期文档写死价格；选择模型和预算 gate 时读取最新官方价格。
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)：浏览器可用 WASM/WebGPU/WebNN 等 execution provider，本地推理有隐私、离线和成本优势，同时需要 operator/设备兼容验证。
- [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/en/guides/webgpu)：WebGPU 浏览器差异和 fallback 风险。
- [WebLLM repository](https://github.com/mlc-ai/web-llm)：浏览器内 LLM 的研究候选；其存在不代表适合本产品的内存、包体、设备或 license gate 已通过。
