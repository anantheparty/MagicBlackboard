# Versioned work prompts

本目录保存未来里程碑的工作指令。Prompt 是 scope/gate，不是实现记录；只有代码、测试和基线证据能证明功能已完成。

## Prompt 目录

| 顺序 | 文件 | 状态 | 说明 |
| --- | --- | --- | --- |
| Foundation source | [`../MagicBlackboard_CODEX_FIRST_PROMPT.md`](../MagicBlackboard_CODEX_FIRST_PROMPT.md) | 当前基础里程碑的原始输入，保留在根目录 | 建立白板 app、runtime、adapter、console 与治理 |
| 03 | [`03_PRESSURE_INK_V2.md`](./03_PRESSURE_INK_V2.md) | **Next round / Not implemented** | Foundation 验收后，实测 Pointer Events 并实现 feature-gated pressure ink |

编号与产品 milestone 对齐，目录中没有文件并不表示可以跳过 gate。不要自动连续执行多个 prompt。

## 使用规则

1. 开始前读取 `AGENTS.md`、`docs/00_DECISION.md`、对应 prompt 及上轮验收证据。
2. 先验证 entry criteria；缺失时停止并报告，而不是补做另一个里程碑的无限范围工作。
3. 不把 prompt 中的“预期结构”当作代码现状；检查当前 branch/commit/source/tests。
4. 把真实命令、设备和失败写入 `docs/baseline/YYYY-MM-DD.md`。
5. 完成 prompt 的 stop condition 后停止，等待 maintainer 决定下一轮。

新增 prompt 时使用不可变、描述性的文件名；已经执行过的 prompt 不原地改写需求含义，改为新增版本并在此记录 supersedes 关系。
