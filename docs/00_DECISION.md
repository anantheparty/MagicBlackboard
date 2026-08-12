# 00 — 核心决策记录

- 状态：**Accepted**
- 决策日期：2026-08-12
- 适用里程碑：Foundation（基础白板与可持续迭代结构）
- 决策所有者：Magic Blackboard maintainers

## 产品判断

Magic Blackboard 不是“在白板旁放一个聊天框”。它的长期价值是从用户明确输入、当前选择、白板内容、交互轨迹和会话阶段中形成可解释的上下文，再识别用户此刻可能想做什么。教学/学习角色、数学/物理/语言等学科都只能作为带来源、时间和置信度的上下文候选；系统不能把一次推断永久固化成用户身份，更不能推断敏感个人属性。

当前先解决可靠白板、生命周期、可观测性和数据边界。AI、压感和自动 Actor 在没有基础设施与评估集前只会放大不确定性，因此不属于本里程碑。

## 已接受决策

| ID | 决策 | 理由 | 重新评估条件 |
| --- | --- | --- | --- |
| D-001 | 以 `plait-board/drawnix` `develop` 的 `b0d682ce9896784dc42889afde7bda95e456aa7d` 为可追溯上游基线 | 复用成熟的无限画布、自由绘制、图形、思维导图和导入导出能力，同时保留升级路径 | 只有在兼容性审计、迁移计划和许可证审查完成后才可换基线/引擎 |
| D-002 | 新产品使用独立 `apps/magic-blackboard`；`apps/web` 保留为上游回归参考 | 避免产品策略污染通用 Drawnix，也让 upstream diff 可审查 | 上游参考 app 的替代品拥有同等回归覆盖时 |
| D-003 | 第一条产品路线为响应式 Web，随后补齐 PWA；桌面浏览器与 iPad Safari 共用实现 | 开发、调试和发布路径最短，能尽快用真实设备验证 Apple Pencil/数位板输入，而不先维护两套渲染器 | 压感原型完成后，若 Web 无法达到已量化的延迟、笔迹质量、文件/系统集成或离线要求 |
| D-004 | 每块 board 创建一个 runtime，卸载时完整 dispose；禁止全局 runtime 单例 | 支持多实例、测试隔离和可靠清理，避免跨白板状态串扰 | 不重新评估；这是生命周期不变量 |
| D-005 | `magic-core` 保持无 React/DOM/Plait/模型 SDK；Plait 细节只存在于 `magic-plait` | 让意图、事件和特性契约可单测、可替换渲染器 | 需要一份说明新增耦合不可避免的 ADR |
| D-006 | 产品持久化 local-first、命名空间独立、数据结构版本化 | 基础白板无需账号或服务端；降低成本和数据暴露 | 引入同步/协作前，先设计身份、冲突、加密、保留期和导出/删除策略 |
| D-007 | Foundation 阶段不接模型、不装 AI SDK、不需要任何 API key | 先建立可重复评估、最小上下文和安全代理边界 | `04_MODEL_INTEGRATION.md` 的 Phase 1 评估门通过且用户明确选择 provider/预算/数据策略 |
| D-008 | 模型能力采用 provider-neutral port；云模型密钥只在自有服务端，浏览器永不持有 | 降低供应商锁定并保护公开仓库和用户费用 | 不允许降低密钥边界；provider 可替换 |
| D-009 | 意图输出是建议，不是无条件命令；低置信度、破坏性或大范围动作需要确认 | 推断会错，教育场景还可能包含未成年人内容 | 仅可针对明确、可撤销、用户主动触发的小范围动作优化确认流程 |
| D-010 | 高频原始输入只进入有容量上限的内存诊断，不持续写 IndexedDB/日志 | 防止性能退化、存储膨胀和行为数据泄露 | 经明确的研究同意、采样/脱敏/保留期设计和独立开关后 |
| D-011 | 公开仓库采用小步、可回退、可审计的频繁提交；`upstream` fetch-only | 易审查、易 bisect，同时避免误推上游 | 不重新评估；可调整提交粒度但不能牺牲审计性 |

## Foundation 的明确非目标

- 不实现 pressure ink、Apple Pencil 专属能力或预测笔迹。
- 不实现 LLM/NN 调用、OCR、意图识别、Actor 自动改板。
- 不实现账号、云同步、实时协作、WebSocket 或遥测上传。
- 不引入 Electron、Capacitor、Swift/iPadOS 工程或第二套画布引擎。
- 不批量升级主要依赖，不全仓重命名 Drawnix，不删除原 LICENSE。

占位接口和 feature 可以存在，但默认必须无行为影响，UI 必须写明“未实现”。

## 上下文原则

未来上下文快照必须把来源分开：

1. `explicit`：用户主动设置，例如“我正在教高中物理”。
2. `board`：从选择区、元素类型、可见区域得到的事实。
3. `interaction`：最近工具、选择和操作序列等短期信号。
4. `inferred`：规则或模型推断，必须带置信度、模型/规则版本和时间。

显式值优先于推断值；新证据可以使旧推断过期。默认不保存完整原始轨迹，不根据姓名、笔迹或内容推断年龄、能力、健康、情绪、身份等敏感属性。

## 决策变更流程

若改动触碰平台、数据边界、依赖方向、持久化格式、上游兼容或模型接入：

1. 先在本文件追加或修订带 ID 的决策；
2. 写清当前证据、被否决方案、兼容/迁移影响与回滚办法；
3. 在同一 PR 更新架构、验收标准和测试；
4. 对不可逆数据或公开 API 变化先获得 maintainer 明确批准。

“代码已经这样写了”不能作为决策依据。

## 研究依据（访问于 2026-08-12）

- [Drawnix upstream repository](https://github.com/plait-board/drawnix) 与本仓库保留的 baseline commit。
- [Plait repository and plugin architecture](https://github.com/worktile/plait)。
- [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)：统一 mouse/pen/touch，并定义 pressure、coalesced/predicted events；规范能力不等同于具体设备已验证。
- [Apple PencilKit](https://developer.apple.com/documentation/pencilkit)：原生低延迟 Apple Pencil 路线，作为后续对照而非当前实现。
- [Apple：在 iPad Safari 中把网站作为 App 添加](https://support.apple.com/en-au/guide/ipad/ipad8f1f7a29/ipados)：证明 Web/PWA 是可用的 iPad 分发入口，不证明压感质量。
