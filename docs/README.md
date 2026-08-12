# Magic Blackboard 文档索引

这里记录产品与工程决策；代码只能说明“现在是什么”，这些文档还说明“为什么这样做”以及“何时可以进入下一阶段”。

## 建议阅读顺序

1. [`00_DECISION.md`](./00_DECISION.md)：已接受的决策、非目标与变更门槛。
2. [`01_ARCHITECTURE.md`](./01_ARCHITECTURE.md)：运行时、白板适配器、上下文与未来意图管线。
3. [`architecture/README.md`](./architecture/README.md)：开发时使用的依赖边界和改动落点速查。
4. [`02_GITHUB_SETUP.md`](./02_GITHUB_SETUP.md)：仓库拓扑、提交节奏与公开仓库安全。
5. [`03_PLATFORM_STRATEGY.md`](./03_PLATFORM_STRATEGY.md)：为什么先做 Web/PWA，何时重新评估原生 iPadOS。
6. [`04_MODEL_INTEGRATION.md`](./04_MODEL_INTEGRATION.md)：零密钥起步、LLM/小模型分工和隐私边界。
7. [`05_ACCEPTANCE_CRITERIA.md`](./05_ACCEPTANCE_CRITERIA.md)：Foundation 的完成定义、CI 证据与仍未运行的手工项。
8. [`06_PRESSURE_INK_V2.md`](./06_PRESSURE_INK_V2.md)：Pressure Ink V2 simulated/browser 实现、限制与当前验收状态。
9. [`adr/0001-pressure-ink-v2-data-and-boundaries.md`](./adr/0001-pressure-ink-v2-data-and-boundaries.md)：可选 ink 数据、旧格式降级、feature 与依赖边界。

原始第一轮需求保留在仓库根目录的 [`MagicBlackboard_CODEX_FIRST_PROMPT.md`](../MagicBlackboard_CODEX_FIRST_PROMPT.md)。未来工作指令放在 [`prompts`](../prompts)；提示词只表达工作范围，不代表功能已经实现。

## 状态约定

- **Accepted**：当前实现必须遵守；改变它需要同步修改决策记录并说明取舍。
- **Proposed**：可实验，但不能作为兼容性或交付承诺。
- **Implemented**：已有代码；仍不等同于已验证。
- **Verified**：在明确 commit、设备或命令上获得了可复现证据。
- **Planned**：尚未实现。
- **Pending**：已接受范围或设计，但实现/最终门禁证据尚待完成。
- **Not run**：明确要求的命令、手工场景或设备尚未运行。
- **Unverified**：证据不足以作出兼容性、质量或平台结论。

基线结果写入 `docs/baseline/`。Foundation 证据在
[`baseline/2026-08-12.md`](./baseline/2026-08-12.md)，Pressure Ink V2 入口证据在
[`baseline/2026-08-12-pressure-ink-v2.md`](./baseline/2026-08-12-pressure-ink-v2.md)，working-tree
实现与待补最终证据在
[`baseline/2026-08-13-pressure-ink-v2.md`](./baseline/2026-08-13-pressure-ink-v2.md)。记录
commit、环境、完整命令、退出码和未验证项；不得把 working-tree/pre-final 结果写成最终
fixed-commit 通过，也不得把合成 PointerEvent 或桌面浏览器结果写成物理笔、Safari/iPad 或
PWA 验证。
