# Pressure Ink V2 entry baseline — 2026-08-12

本文件只记录 Pressure Ink V2 行为改动前的已运行证据。Foundation 的完整失败/修复、审计与
hosted CI 历史仍在 [`2026-08-12.md`](./2026-08-12.md)。后续实现结果必须追加新的 commit/
命令，不能覆盖本 baseline。

## 证据头

- 日期/时区：2026-08-12，Asia/Tokyo
- 分支：`agent/pressure-ink-v2`
- Foundation merge：`21cc3a9abbd5f28999c7e44fe03c8b69fe9ae0d4`
- Entry/legacy fixture commit：`b74a392380e482298c080924d6a3e10f54ca0af4`
- tracked worktree：entry capture 时 clean；后续共享工作树实现改动不属于本节证据
- OS/architecture：macOS `15.5 (24F74)`，Apple Silicon/arm64
- Node/npm：Node `20.20.2`，npm `10.8.2`（显式固定
  `PATH=/opt/homebrew/opt/node@20/bin:$PATH`）
- Nx：`22.6.5`
- Plait：`@plait/core`、`@plait/common`、`@plait/draw` 均为 `0.93.4`
- Drawnix package：`0.4.0`
- Browser：system Chrome `151.0.7922.109`

版本来自本 checkout 的 engines/package manifest、resolved install 和实际命令，不由记忆推断。

## Foundation 入口引用

Foundation merge commit 为 `21cc3a9`。PR #5 hosted run `31584732783` 在其 PR head
`5d6e679` 上验证：macOS Foundation job 1m15s 通过，Linux Foundation/E2E job 2m37s
通过。该 run 证明 Foundation PR head 和 hosted runner 链路，不应描述为在 merge SHA 上
重跑，更不证明 Pressure Ink V2。

Foundation 仍有 **Not run** 的 desktop 完整手工工具矩阵、Safari macOS、窄屏/真实 touch、
物理 iPad/Apple Pencil 和共享 origin/subpath/offline/update 等真实 PWA 场景。maintainer 已
授权在这些设备缺失时继续 simulated implementation；这不是硬件豁免或兼容性证据。

## Legacy freehand fixture

commit `b74a392` 新增 synthetic legacy `.drawnix` fixture 和 2 项回归。fixture 保留旧
freehand 形状：`points`、标量 `strokeWidth: 2` 及原有字段，没有 `ink`。它用于锁定旧读取/
序列化，不含真实笔迹或用户数据。

Foundation 既有 Drawnix suite 为 **28/28**。加入两项 legacy fixture 测试后，entry commit
的真实复跑为 **30/30**：

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  npx nx test drawnix --run --skip-nx-cache
```

- 结果：exit `0`
- Vitest：11 files / 30 tests passed
- Vitest 报告时长：1.95s

`28/28` 是改动前 suite 数量，`30/30` 是 `b74a392` 的实际 suite；两者不能混写成同一次
运行。

## Magic build entry check

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  npx nx build magic-blackboard --skip-nx-cache
```

- 结果：exit `0`
- Nx：Magic app 及其 7 个依赖 target 通过
- Vite：`8.0.16`，2054 modules transformed
- 保留 warning：mindmap chunk 约 `533.86 kB`、main 约 `1,111.59 kB`、ELK worker 约
  `1,443.12 kB`，均触发 `>500 kB` chunk warning

这是 entry build，不是 Pressure Ink V2 完成门；实现后的 clean install/lint/format/test/build
仍为 **Pending**。

## 10 秒 system Chrome 合成输入 baseline

先启动本地服务：

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  npx nx serve magic-blackboard --host=127.0.0.1 --port=7300
```

再运行：

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  PLAYWRIGHT_USE_SYSTEM_CHROME=1 node scripts/benchmark-ink.mjs
```

方法：在 system Chrome 中沿合成 mouse path 以约 60 Hz dispatch 10 秒；`dispatch` 指标是
从事件 capture 到 bubble 返回的同步 dispatch cost。frame interval 来自页面 animation-frame
观测。该 run 发生时 JSON 尚未输出 `browserVersion` 字段；Chrome shell 另行记录为
`151.0.7922.109`，后续脚本才补该字段。

| 指标                           |                    结果 |
| ------------------------------ | ----------------------: |
| duration                       |               10,000 ms |
| pointer moves / dispatch count |               601 / 601 |
| dispatch p50 / p95 / max       |   0.70 / 1.30 / 1.80 ms |
| frame interval sample count    |                   1,237 |
| frame interval p50 / p95 / max | 8.30 / 10.00 / 49.30 ms |
| long tasks                     |                       0 |
| heap delta                     |         7,375,309 bytes |
| DOM mutations                  |                   1,291 |
| rendered freehand elements     |                       1 |
| SVG node count                 |                      55 |

限制：

- synthetic mouse 不提供可信 pressure/tilt/angle、driver、palm rejection 或真实硬件采样；
- dispatch cost 不是端到端 pen-to-ink latency；
- 一次 heap delta 未控制 GC，不能证明没有内存泄漏；
- frame samples 受显示刷新率、dev server、浏览器调度和后台负载影响；
- 没有运行 Safari、iPad Safari、Home Screen PWA、touch 或 desktop tablet。

因此这些数值只能作为同脚本、同环境的实现前比较点。平台状态仍是 **Unverified**。

## 规范/平台调研状态

已核对 W3C Pointer Events Level 3 Recommendation（2026-06-30）以及 Apple/WebKit 对
Safari 13、18.2、26.2、26.6 的一手记录。截止 2026-08-12，WebKit
`pointerrawupdate` 仍未实现；计划实现必须 feature-detect 并在 Safari 上使用
`pointermove` 与可用时的 coalesced events。直接链接、版本与限制集中在
[`../03_PLATFORM_STRATEGY.md`](../03_PLATFORM_STRATEGY.md)。

## Entry 后的 Pending 清单

- Pressure sample/curve/coalesced/ordering/cancellation 实现与测试：**Pending**
- optional `ink: { version: 1, widths }` validator/render/round trips：**Pending**
- split diagnostics/pressure features、per-board lifecycle、console evidence：**Pending**
- feature-off exact compatibility 与完整 workspace gates：**Pending**
- 实现后的同方法 performance comparison：**Pending**
- Safari/iPad/Pencil/tablet/touch/mouse 手工矩阵：**Not run**
- PWA shared-origin/subpath/offline/update/install：**Not run**
- Continue Web/PWA 或 PencilKit spike 平台决定：**Unverified**
