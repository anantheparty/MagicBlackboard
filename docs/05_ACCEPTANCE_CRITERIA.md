# 05 — Foundation 验收标准

本文件是完成定义，不是当前通过报告。只有附带 commit、命令/设备、结果和日期的条目才能标记 **Verified**。未运行写 **Not run**；失败写 **Failed** 并保留原因。未来 prompt、接口占位或截图不能代替可执行证据。

Foundation 已在 `21cc3a9abbd5f28999c7e44fe03c8b69fe9ae0d4` 合并；本文件保留该阶段的
历史证据和仍未运行的手工项。当前 Pressure Ink V2 阶段见
[`06_PRESSURE_INK_V2.md`](./06_PRESSURE_INK_V2.md)。后续阶段的实现不会倒推改变这里的
Foundation 验证范围，也不会自动勾选 Safari/iPad/touch/PWA 项。

截至 2026-08-13，Pressure Ink V2 simulated/browser 代码已在 working branch 实现，但其
最终 fixed-commit/hosted evidence 仍待记录。下方诸如“ink diagnostics unavailable”和“无
pressure mapping”的勾选项是 Foundation tested commit 的历史快照，不是当前代码状态；
当前状态只以 `06` 和新的 pressure baseline 为准。

## 证据头

每次完整验收在 `docs/baseline/YYYY-MM-DD.md` 记录：

```text
Date/timezone:
Commit:
Branch:
Dirty worktree before run:
Node/npm:
OS/architecture:
Browser/device (manual checks):
Command -> exit code -> duration -> relevant warning/error:
Unverified items:
```

若同日多次运行，文件中分 section 或带时间，不能用新结果覆盖旧失败而不解释。

截至 2026-08-12 的实际证据集中在
[`baseline/2026-08-12.md`](./baseline/2026-08-12.md)。其中保留了上游基线、中间失败、
工作树自动测试、system Chrome E2E 的失败/修复/3/3 通过、范围受限的浏览器 mount 检查和
依赖审计。最终本地自动门禁已在 clean commit
`e85e8e4dbc8c66c070a3c4901a43b0634ce1b011` 通过，包括 uncached workspace test/build、
Magic typecheck 和 system Chrome 3/3 E2E。PR #5 的 Foundation hosted Linux/macOS CI 随后在
修复 commit `5d6e679` 全部通过。完整手工工具矩阵、Safari、touch/iPad 与真实 PWA 场景仍
未验证，不能由自动证据替代。

## A. 来源与仓库治理

- [x] 原始 `MagicBlackboard_CODEX_FIRST_PROMPT.md` 保留且未当作实现文件改写（保留提交 `d28e818`）。
- [x] `origin` 指向 `anantheparty/MagicBlackboard`，`upstream` 指向 `plait-board/drawnix` 且 push disabled（2026-08-12 只读复核）。
- [x] 上游 baseline `b0d682ce9896784dc42889afde7bda95e456aa7d` 在 `NOTICE.md` 和决策文档可追溯。
- [x] 根 `LICENSE` 未删除/缩减；Drawnix 与 Plait 归属在 `NOTICE.md` 清晰保留。
- [x] `AGENTS.md`、`SECURITY.md`、`.env.example` 和 `docs/00`–`05` 存在且互相一致。
- [x] 本地 `.env*` 被忽略且 `.env.example` 可跟踪（2026-08-12 以 `git check-ignore -v` 验证）；tracked/staged 文件仍须在每次 push 前重新检查不含 secret 或真实用户/课堂数据。
- [x] tested commit 的 tracked worktree、diff 与文件名完成公开仓库检查；secret/key/个人路径
      模式无命中，只有预期可跟踪的 `.env.example`。证据文档提交前仍须再检查其 staged diff。

证据：`git remote -v`、`git config --get remote.upstream.pushurl`、`git diff --check`、tracked filename review；不得把 credential 输出复制进基线。

GitHub API 还确认仓库为 public，secret scanning/push protection、Dependabot alerts/security
updates 和 private vulnerability reporting 已启用，Actions 默认权限为 read。`main` 已禁止
force push/deletion，但 required checks/reviews 尚未配置；详见
[`02_GITHUB_SETUP.md`](./02_GITHUB_SETUP.md)。

## B. 上游基线

在功能改动前或明确记录的 baseline commit 上运行：

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
```

- [x] 每个命令有真实 exit code；上游已有失败没有通过升级/跳过/弱化检查掩盖。
- [x] `.nvmrc` 与实际 Node 版本记录（`20.20.2`，npm `10.8.2`）。
- [x] Nx、React、Vite、Plait、Drawnix 版本从 checkout/lockfile 读取，而非凭记忆。
- [x] Foundation 在 clean commit `e85e8e4` 上重新运行 install/lint/format/test/build，均 exit 0。

证据见 [`baseline/2026-08-12.md`](./baseline/2026-08-12.md)：上游 5 个命令均通过；
Foundation 最终本地门禁也在固定 commit 上通过，且保留所有先前失败迭代。

## C. Magic Blackboard app

- [ ] `apps/web` 保留为 upstream reference 且 build 已通过；其 app mount assertion 在上游仍被注释，因此不能把 mount 标成已验证。
- [x] `apps/magic-blackboard` 是独立 React/Vite/Nx app，产品名显示 `Magic Blackboard`。
- [ ] app 提供占满可用 viewport 的无限白板，不因 console 打开/关闭破坏 resize。
- [ ] 现有 Drawnix hand/selection/freehand/eraser/shape/arrow/text/mind map、zoom/theme、undo/redo 和适用的 import/export 工具没有被有意移除。
- [x] 中文默认；英文 preference 的初始化/恢复有 app test，显式中文 teaching/physics context 的 reload 有 E2E 证据。
- [x] 运行时不需要 API key；生产代码静态检查无 model/telemetry endpoint 或调用。浏览器
      network 面板的独立手工复核仍未运行，service-worker 自身的允许列表 fetch 除外。
- [x] 根级 Magic start/build 脚本存在，`npm run build:magic`/workspace build 已运行；启动命令为 `npm run start:magic`。

### 持久化

- [x] 使用且仅使用预定 product namespaces（常量与单测锁定）：
  - `magic_blackboard.board.v1`
  - `magic_blackboard.preferences.v1`
  - `magic_blackboard.features.v1`
  - `magic_blackboard.console.v1`
- [ ] board children、viewport、theme、tool state 和 preference 在刷新后恢复。
- [x] 新建元素后触发产品 context/tutorial 等父层 rerender 不会用初始 `value` 覆盖当前文档；
      session 保存最新 children 而不触发热路径 React render，单测与 system Chrome
      “画笔→改 subject→Undo/元素仍在→立即 reload” E2E 均通过。
- [x] 初次访问、字段缺失、损坏 board/tool state、preference storage reject，以及 feature
      setting 的 malformed/read-error/write-error 均有 fail-closed 回归；失败槽位不会被默认值
      自动覆盖，tool pointer 使用 allowlist，preset index/数量/宽度受当前 UI 范围约束且未知字段
      会被投影掉；feature 运行期写失败也锁为 unavailable/disabled 而不改原存储值。
- [x] 两个 tab/实例采用 last-writer-wins、无 live sync；文档和双实例测试覆盖当前范围。
- [x] 不持续存储 raw `pointermove`、完整 event ring buffer 或 model prompt/response；事件 payload 可不保留且产品 storage 无这些槽位。

“画一笔后立即 reload”回归曾因 `pagehide` 中的异步 IndexedDB 写入未完成而失败；改成文档
mutation 即时保存后，focused system Chrome E2E 已恢复 3/3。完整 board/viewport/theme/tool
刷新矩阵尚未验证，所以组合条目仍未勾选；最终 commit 的 E2E 已通过，旧失败仍保留在
baseline。

## D. Drawnix 通用扩展点

- [x] 产品 app 可追加 Plait plugins，而不把 Magic-specific import 加入 `packages/drawnix`。
- [x] 使用已有 `afterInit` 取得初始化 board；adapter plugin 提供更早的通用监听 seam。
- [x] overlay API 是通用、可选且 ownership/position/lifecycle 明确。
- [x] 新 props 省略时 default Drawnix API/behavior 不变。
- [x] `apps/web` build/test 与 Drawnix default-props test 提供兼容证据。

## E. `magic-core`

- [x] 无 React、DOM、Plait、localforage 或 provider SDK runtime dependency。
- [x] typed `MagicEventBus` 支持 subscribe/emit/unsubscribe/dispose。
- [x] listener 移除、emit 中取消订阅、handler failure 和 dispose 后语义有测试。
- [x] ring buffer 容量固定，覆盖 wrap-around、顺序、容量边界和清空。
- [x] `MagicFeatureRegistry` 覆盖注册、查询、toggle/availability、重复/未知 ID 和 dispose。
- [x] settings store 是可替换接口，未把浏览器 storage 写死进 core。

## F. `magic-plait`

- [x] `PlaitCanvasAdapter` 支持 attach/detach，重复操作语义清晰。
- [x] snapshot、selection、按 IDs 查询、selection bounds、world/screen conversion 有测试。
- [x] document/selection/viewport events 正确转译且不泄露 mutable private internals。
- [x] detach/dispose 移除全部 listener/subscription；切换 board/双 adapter 不串扰。
- [x] 空选择、被删除 ID、空文档、非单位 zoom/offset 等边界有覆盖。
- [x] 高频 `set_node`/拖拽路径不对整板反复 clone/isEqual；document event 使用
      revision/changed IDs/theme/operation 摘要，完整 snapshot 只按需查询，并有昂贵 getter
      不被读取的回归测试。

## G. `magic-runtime`

- [x] `createMagicRuntime()` 每次返回唯一 runtime ID 和独立 features/events/settings/canvas state。
- [x] 两个 runtime 的 feature toggle/event/dispose 互不影响。
- [x] runtime 不使用 module/global singleton；一个 board 对应一个 runtime。
- [x] dispose 幂等并释放下属资源；订阅中途失败也清理已取得的资源。
- [x] actor/intent 明确显示 unavailable/not implemented，不产生虚假结果或白板变更。

## H. 开发控制台

- [x] `Cmd/Ctrl + Shift + D` 打开/关闭，listener 在 unmount 后清理。
- [ ] 可折叠、可调宽，并有 Overview、Features、Board Inspector、Input、Actors、Events。
- [x] 未实现能力明确标识；`magic.ink-diagnostics` 和 `magic.actor` unavailable 且不能启用。
- [x] feature 状态与 console UI 状态使用不同 namespace/store key 持久化。
- [x] dev 默认可用；production 默认隐藏；`VITE_ENABLE_DEV_CONSOLE=1` 可显式开启（代码路径静态验证）。
- [x] 关闭时不订阅 runtime events/features；event/input diagnostics 使用固定容量，pointer 展示写入做节流。
- [x] 键盘快捷键不会在可编辑输入中误触发，并有回归测试。

## I. App 装配与清理

- [x] 顺序为 create runtime → install additional plugins → board ready → attach adapter → render console。
- [x] unmount 反向 detach/dispose，React Strict Mode remount 不累计 listeners/timers/subscriptions。
- [x] app mount test 覆盖初始化成功与 storage reject/损坏值恢复路径。
- [x] runtime construction、board attach 和 plugin 初始化中途抛错时，已有 adapter/runtime/session 仍被清理并显示安全 fallback。

## J. CI 与质量门

- [x] GitHub `CI` workflow `332622627` 已 active；PR #5 run `31584732783` 在 Foundation
      commit `5d6e679` 上 Linux/macOS 全部通过。首次 run 的 Linux 时序失败与修复保留在
      baseline；若仅证据文档产生新 head，仍须检查该 head 的最终 run。
- [x] macOS hosted job 已验证 install、lint、format check、workspace tests 和 Magic build；
      run `31584732783` 于 1m15s 成功。
- [x] workflow 使用 read-only `permissions`、SHA-pinned actions，publish job 和根发布脚本在 Foundation 期间 fail-closed。
- [x] 自动测试已覆盖以下基础项：
  - product app mount；
  - upstream app/default Drawnix API 不受影响；
  - EventBus 与 ring buffer；
  - feature toggle；
  - 两 runtime 隔离；
  - CanvasAdapter selection/bounds/coordinates；
  - console shortcut；
  - mount/unmount listener cleanup。
- [x] `npm ci`、`npm run lint`、`npm run format:check`、uncached `npm test` 与 uncached
      `npm run build` 全部在 clean commit `e85e8e4` 运行并记录；102 tests 通过，build 9/9。

若格式化工具会改写不属于本次工作的用户文件，先停止并缩小目标；不能为了全绿提交无关格式化。

## K. 手工 smoke test

每项记录浏览器/OS；iPad 项必须记录物理设备，simulator 不能标成实机通过。

- [ ] Desktop Chromium：创建多类元素、选择/移动、自由画/擦除、zoom/pan、undo/redo、主题、刷新恢复。
- [ ] Safari macOS：mount、核心工具、快捷键、storage、resize。
- [ ] Narrow/touch viewport：toolbar 可达，无关键控件永久遮挡，手势不造成页面滚动/缩放冲突。
- [ ] iPad Safari：横竖屏、手指绘写/选择/缩放、Apple Pencil 作为普通笔输入、刷新恢复。
- [ ] Console：打开/关闭/调宽、feature toggle、events bounded、关闭时 board 操作正常。
- [ ] Two instances/tabs：状态隔离与当前同步限制符合文档。
- [ ] 导出文件使用合成内容；导入旧 Drawnix fixture 后未发生不可解释的数据丢失。
- [ ] PWA/service worker 在共享 origin、非根路径部署和更新场景下不越过预期 scope、不缓存其他应用。

Service-worker 已静态复核为 Magic-specific scope/cache prefix 和 shell allowlist，不拦截 API
或其他导航；但没有自动化 SW 测试，共享 origin、真实 subpath、offline/update/旧 cache、未来
client route fallback 与 iPad 安装仍为 **Not run**。

Foundation 的 iPad smoke test只证明普通白板输入；不得由此宣称 pressure/tilt/palm rejection 已支持。

## L. 明确禁止以此阶段“完成”名义交付

- [x] 无 AI SDK/model endpoint/API key。
- [x] 无 pressure mapping、预测笔迹或 Apple Pencil 专属逻辑。
- [x] 无 Actor 自动改板、WebSocket、collaboration、Electron/Capacitor/native iPad project。
- [x] 无永久 raw pointer telemetry。
- [x] 无 major dependency upgrades 或全仓 Drawnix rename；只采用经审计的最小 transitive security overrides。

这些复选框的正确完成含义是“确认不存在”，而不是要求实现。

## 最终交付格式

完成后输出：

1. 实施摘要；
2. 架构决定与任何偏差；
3. 修改文件列表；
4. 命令与真实结果；
5. 启动方式；
6. 手工验收步骤与设备；
7. 未验证/失败项；
8. 推荐 commit 拆分；
9. Foundation handoff 当时记录下一轮提示词为 `prompts/03_PRESSURE_INK_V2.md`，且未在
   Foundation 同轮执行。

该停止条件已经遵守。maintainer 随后单独授权的 Pressure Ink V2 simulated/browser 代码已
在 working branch 实现；它有独立的入口、ADR 和 baseline，最终固定 commit/hosted evidence
仍待记录，且仍不授权模型、production rollout 或原生 app。
