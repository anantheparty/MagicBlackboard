# Pressure Ink V2 simulated implementation — 2026-08-13

本文件记录实现提交、迭代期间真实运行过的预最终命令，以及最终验收必须补填的
位置。除明确写作 Foundation/old-consumer evidence 的部分外，下面的自动结果发生在 dirty
working tree，且结果后仍有 schema/lifecycle/resource-cleanup 改动；因此它们是 **pre-final
iteration evidence**，不是最终固定 commit 的 release evidence。

## 证据头

- 日期/时区：2026-08-13，Asia/Tokyo
- 分支：`agent/pressure-ink-v2`
- Pressure Ink V2 实现提交：`b3c992f`（完整 SHA 在最终门禁后补录）
- Pressure Ink V2 最终 commit：**Pending**
- final gate 前 worktree：**Pending**
- hosted CI head/run：**Pending**
- OS/architecture：macOS `15.5 (24F74)`，Apple Silicon/arm64
- Node/npm：Node `20.20.2`，npm `10.8.2`，命令显式使用
  `PATH=/opt/homebrew/opt/node@20/bin:$PATH`
- Nx：`22.6.5`
- system Chrome：`151.0.7922.109`
- physical device/browser/driver：**Not run**

## Working-tree 实现摘要

- exact optional `ink: { version: 1, widths }`，保留 legacy `points`/`strokeWidth`；generated
  widths 量化到 2 位，但 importer 接受范围内任意有限小数。
- capability-aware pen pressure、coalesced parent fallback、deterministic smoothing/resampling、
  filled-SVG geometry，以及 legacy/malformed/unknown fallback。
- `magic.pressure-ink` 与 `magic.ink-diagnostics` 分离、development-only available、各自默认
  off；production unavailable。
- 每 board lifecycle、stroke-local cancellable rAF、bounded coordinate-free diagnostics、
  console subscription throttling，以及 product-owned fail-closed persistence。
- `.drawnix` preflight/schema/element/tree/image limits、full document replacement、valid-v1 和
  legacy fixtures/round trips。
- valid-v1 ink 的 move/rotate 可用；含它的单选或 mixed selection resize 原子 no-op，legacy
  resize 不变。

精确 schema、阈值、数据边界和限制见
[`../06_PRESSURE_INK_V2.md`](../06_PRESSURE_INK_V2.md) 与
[`../adr/0001-pressure-ink-v2-data-and-boundaries.md`](../adr/0001-pressure-ink-v2-data-and-boundaries.md)。

## 预最终自动运行

下表只记录真实发生过的命令/结果。后续改动使这些结果不能代替最终 rerun。

| 命令/范围                      | 结果                                                            | 证据边界                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | exit 0；1,182 packages，约 19s                                  | 安装成功；npm 完整 audit 当时报告 45 项，见下文；最终仍须重跑                                                               |
| `npm run lint`                 | exit 0                                                          | 后续代码/文档有变化，最终仍须重跑                                                                                           |
| `npm run format:check`         | 首次因一个 `magic-console` spec 失败；格式化该文件后重跑 exit 0 | 旧失败保留；最终仍须重跑                                                                                                    |
| 9 projects typecheck           | exit 0；保留 `MaxListenersExceededWarning`                      | warning 不应被隐去；后续变化后需重跑                                                                                        |
| `npm test -- --skip-nx-cache`  | exit 0；9 projects / 254 tests                                  | 当时为 core 17、react-text 1、react-board 7、runtime 6、plait 13、console 7、drawnix 142、web 1、app 60；后续新增测试未包含 |
| focused Magic app test         | exit 0；65 tests                                                | 发生于后续部分修订后，但不是最终树                                                                                          |
| focused Drawnix test           | exit 0；148 tests                                               | 发生于后续部分修订后，但不是最终树                                                                                          |
| uncached workspace build       | exit 0；9 targets                                               | Magic 构建保留约 533.86 KiB、1,155.86 KiB 与 1,443.12 KiB chunk warnings                                                    |
| `npm audit --omit=dev`         | exit 0；0 production vulnerabilities                            | 只说明 lockfile 的 production dependency 集合                                                                               |
| `npm audit`                    | exit 1；2 low / 26 moderate / 17 high / 0 critical              | 45 项均在完整 dev tree；不能被 production-only 结果掩盖                                                                     |
| system-Chrome Pressure Ink E2E | exit 0；5/5，约 6.5s                                            | 合成浏览器路径；运行后仍有 schema/lifecycle 修订，且不是 Safari/设备/PWA 证据                                               |

最终文档不得把 254、65 和 148 相加成一次 suite，也不得把曾通过的 5/5 写成最终 head 的
E2E。最终命令完成后，在下方新增独立结果而不是改写此表。

## 旧消费者隔离证据

在 `/private/tmp` 的独立 checkout 中使用未修改上游 baseline
`b0d682ce9896784dc42889afde7bda95e456aa7d`，只加入一次性消费测试，并运行：

```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH \
  npx nx test drawnix --run --skip-nx-cache
```

- 结果：exit 0，11 files / 27 tests passed（旧 suite 26 + 临时消费测试 1）。
- 含 optional valid-v1 `ink` 的 JSON Blob 被旧 importer 接受；旧 FreehandGenerator 走 RoughJS
  并保持可见；旧 `Transforms.setNode` 修改 `strokeWidth` 后仍保留 `ink`；旧 serializer 也
  保留 additive field。
- 临时 checkout 的独立 TypeScript 命令因其既有 SCSS/Vite config 问题失败。该失败保留，
  不能标成旧 consumer typecheck 通过。

这只证明这个明确 baseline consumer 对 additive field 的行为，不证明所有旧版本或第三方
消费者兼容，也不证明 variable geometry。

## 预最终 synthetic performance runs

在 system Chrome `151.0.7922.109`、macOS `15.5 (24F74)`、dev server、同一 benchmark
脚本上分别运行三次 legacy 和 simulated-pressure，约 10 秒/次。脚本会在没有真实持久化
目标 stroke 时 fail hard；simulated-pressure 还要求 valid v1、points/widths aligned/non-empty
且 widths 有 spread。

这些 run 发生在最终 lifecycle/schema freeze 之前，而且后续将 `PerformanceObserver` 改为
只观察 run 内 longtask，避免混入 buffered page-load 数据。以下数值因此只保留作迭代痕迹；
最终 commit 必须两种 mode 各自重跑，不能直接复用。

### Legacy mode（3 次）

| Run | moves | dispatch p50/p95/max (ms) | frame p50/p95/max (ms) | long tasks | DOM mutations | persisted result     | heap delta |
| --: | ----: | ------------------------: | ---------------------: | ---------: | ------------: | -------------------- | ---------: |
|   1 |   601 |           0.5 / 0.9 / 1.9 |      8.3 / 10.1 / 25.0 |          0 |         1,291 | 601 points；无 `ink` | -575,846 B |
|   2 |     — |           0.5 / 1.2 / 1.7 |        — / 10.0 / 24.9 |          — |             — | stroke；无 `ink`     | -628,358 B |
|   3 |     — |           0.8 / 1.4 / 1.9 |        — / 10.1 / 33.7 |          — |             — | stroke；无 `ink`     | -639,454 B |

### Simulated-pressure mode（3 次）

| Run | moves | dispatch p50/p95/max (ms) | frame p50/p95/max (ms) | long tasks | DOM mutations | persisted result                  |      heap delta |
| --: | ----: | ------------------------: | ---------------------: | ---------: | ------------: | --------------------------------- | --------------: |
|   1 |   599 |           0.1 / 0.2 / 0.4 |        8.3 / 9.2 / 9.4 |          0 |         1,239 | 3,127 points = widths；spread 2.4 | about +5.697 MB |
|   2 |   600 |           0.1 / 0.2 / 0.4 |        8.3 / 9.2 / 9.4 |          — |         1,241 | 3,133 points = widths；spread 2.4 | about -0.693 MB |
|   3 |   600 |           0.1 / 0.2 / 0.4 |        8.3 / 9.3 / 9.4 |          — |             — | 3,133 points = widths；spread 2.4 | about +4.529 MB |

`—` 表示当前 handoff 没有保留该 run 的精确字段，不表示零；最终 rerun 必须保留完整 JSON。

限制：synthetic dispatch cost 不是 pen-to-ink latency；heap delta 未控制 GC；dev server、显示
刷新率和系统负载影响 frame；这些 event 没有 driver、palm rejection、真实 coalescing 或
硬件采样。数值不能外推到 Safari、iPad、Apple Pencil、数位板、touch 或 PWA。

## 最终 fixed-commit gate（Pending）

最终代码和文档 freeze 后必须追加，不得预填成功：

```text
Commit: Pending
Dirty worktree before run: Pending
npm ci: Not run on final commit
npm run lint: Not run on final commit
npm run format:check: Not run on final commit
npm test -- --skip-nx-cache: Not run on final commit
npm run build -- --skip-nx-cache: Not run on final commit
Magic app build/typecheck: Not run on final commit
Pressure Ink E2E with system Chrome: Not run on final commit
legacy benchmark repetitions: Not run on final commit
simulated-pressure benchmark repetitions: Not run on final commit
public-repo staged diff/filename/secret scan: Not run on final commit
hosted Linux/macOS CI head/run: Not run
```

记录真实 command、exit code、duration、suite count、browser version、meaningful warning 和
hosted run URL/ID；若失败，保留失败并修复后另加一行，不得覆盖历史。

## 手工与平台状态

- Safari macOS：**Not run**
- 物理 iPad Safari + Apple Pencil：**Not run**
- iPad Home Screen PWA：**Not run**
- desktop Chromium/Safari + 命名数位板/driver：**Not run**
- 实体 mouse/trackpad 完整任务：**Not run**
- touch-only/narrow viewport：**Not run**
- shared-origin/subpath/offline/update/old-cache/install PWA：**Not run**
- Apple Pencil、tablet、Safari、touch、PWA compatibility：**Unverified**
- Continue Web/PWA vs native PencilKit comparison：**Unverified**

下一阶段只有在最终自动门禁完成后才进入命名硬件矩阵；simulated implementation 不能改变
上述状态。
