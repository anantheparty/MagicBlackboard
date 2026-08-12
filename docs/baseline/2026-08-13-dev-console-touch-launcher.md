# Development Console touch launcher follow-up — 2026-08-13

本文件记录 Pressure Ink V2 simulated/browser 自动门禁完成后的独立小型 follow-up。目标只是让
没有硬件键盘的 development build 可以打开 Console；没有扩大到模型、原生 App、PWA 或硬件
兼容性声明。

## 证据头

- 日期/时区：2026-08-13，Asia/Tokyo
- 分支：`agent/dev-console-touch-launcher`
- 固定代码 commit：`bb952355367d152de68c39cb9912f182bffee4b0`
- 基线：Pressure Ink V2 merge commit `c46d89402de0c9b7181b8a25c2d912fc9c741113`
- 固定代码 commit 门禁前后 worktree：**clean**
- OS/architecture：macOS `15.5 (24F74)`，Apple Silicon/arm64
- Node/npm：Node `20.20.2`，npm `10.8.2`；命令显式使用
  `PATH=/opt/homebrew/opt/node@20/bin:$PATH`
- system Chrome：`151.0.7922.109`
- hosted CI：**Verified**；PR #7 run `31626214413` 在 exact head
  `26b9e11aa42a011004d0e75184395c4a43836d88` 上 Linux/macOS 全部通过
- physical Safari/iPad/Pencil/tablet/touch/PWA：**Not run / Unverified**

## 结果与边界

- `packages/magic-console` 在关闭态渲染右侧居中的 `Dev Console` 原生按钮，复用组件既有
  open state 与 `onStateChange` 持久化回调；没有新增 app-owned console 状态或公共 prop。
- launcher 与 Close 按钮实测至少 44px；可见标签包含于 accessible name，点击打开后焦点
  到 Close，关闭后回到 launcher。快捷键路径保持原行为。
- `available=false` 仍在 DOM、keyboard listener、runtime subscription 之前返回 `null`；production
  默认隐藏边界由单元测试覆盖。本轮未把未成功执行的 production-preview 浏览器尝试写成通过。
- E2E 使用 system Chrome、390×844 viewport、`hasTouch:true`、`isMobile:true` 与合成移动 UA，
  并断言 `.drawnix--mobile`，避免只在桌面布局上假绿。它仍只是 Chromium 仿真。

## 固定代码 commit 本地门禁

除表内另有说明，命令均使用 Node 20 PATH 前缀。

| 命令/范围 | 结果 | duration / warning |
| --- | --- | --- |
| `npm ci` | **Verified**，exit 0；added 1,182 / audited 1,183 | 10.46s；保留既有 dependency deprecation 与完整 dev audit 摘要 |
| `npm run lint` | **Verified**，exit 0 | 0.75s |
| `npm run format:check` | **Verified**，exit 0；285 files | 0.81s，其中 formatter 183ms |
| `npm test -- --skip-nx-cache` | **Verified**，exit 0；9 projects / 302 tests | 12.30s；Console 8，其余项目计数与 Pressure fixed commit 相同 |
| `npm run build -- --skip-nx-cache` | **Verified**，exit 0；9/9 projects | 9.82s；保留既有 `NO_COLOR`、MaxListeners 与 chunk-size warnings |
| `npm exec nx -- run-many -t=typecheck --skip-nx-cache` | **Verified**，exit 0；9/9 projects | 8.42s；保留既有 MaxListeners warning |
| `npm exec tsc -- --noEmit -p packages/magic-console/tsconfig.spec.json` | **Verified**，exit 0 | focused spec typecheck |
| `npm exec tsc -- --noEmit -p apps/magic-blackboard-e2e/tsconfig.json` | **Verified**，exit 0 | E2E config/spec typecheck |
| `PLAYWRIGHT_USE_SYSTEM_CHROME=1 npm exec nx -- e2e magic-blackboard-e2e --workers=1 --skip-nx-cache` | **Verified**，exit 0；6/6 | 10.92s；新增一项 simulated touch viewport |
| 同上并加 `--grep "simulated touch viewport" --repeat-each=3` | **Verified**，exit 0；3/3 | 修复后的 focused stability run |
| `npm audit --omit=dev` | **Verified**，exit 0；0 production vulnerabilities | dependency/lockfile 未变 |
| `npm audit` | exit 1；45 findings：2 low / 26 moderate / 17 high / 0 critical | 既有完整 dev tree 结果；不能用 production audit 隐去 |

完整 test 仍保留 jsdom canvas、`NO_COLOR` 与 MaxListeners informational warnings；build 仍保留
既有大 chunk warning。本 follow-up 没有依赖、数据 schema 或 pressure pipeline 变化。

## 浏览器布局预检

本地 development server 使用 `npm exec nx -- serve magic-blackboard --host=127.0.0.1`。通过
受控 Chromium 页面读取实际 DOM rectangle，而不是仅检查 CSS 声明：

- 1280×720：launcher `123.84×44`，距右侧 12px；打开后 panel `310×720` 且完全位于 viewport；
  Close `44×44`；console error/warn 为空。
- 390×844：launcher `123.84×44`；打开后 panel `310×844` 且 `x=80..390`；Close `44×44`；
  E2E 同时断言真实进入 `.drawnix--mobile` 分支。
- 820×1180：额外检查 launcher、panel、Close 均在 viewport 内，launcher 与 Close 都为 44px 高。

首次窄屏 E2E 暴露 Close 按钮在 flex header 中被压缩为约 `40.28px`；增加 `flex:none` 后，focused
测试连续 3/3 通过。该失败作为真实迭代证据保留，没有被写成一次性成功。

## Hosted CI

PR [#7](https://github.com/anantheparty/MagicBlackboard/pull/7) 的 `pull_request` run
[`31626214413`](https://github.com/anantheparty/MagicBlackboard/actions/runs/31626214413) 在 exact head
`26b9e11aa42a011004d0e75184395c4a43836d88` 上成功：

- Linux job
  [`94213120681`](https://github.com/anantheparty/MagicBlackboard/actions/runs/31626214413/job/94213120681)：
  **Verified**，2026-08-12 18:09:18Z–18:11:30Z（2m12s）；`npm ci`、Playwright 安装、lint、
  format、affected test/build/E2E 全部通过。
- macOS foundation job
  [`94213120722`](https://github.com/anantheparty/MagicBlackboard/actions/runs/31626214413/job/94213120722)：
  **Verified**，2026-08-12 18:09:18Z–18:10:33Z（1m15s）；`npm ci`、lint、format、workspace
  tests 与 Magic build 全部通过。

本节记录的是包含固定代码 commit 与本文件初版的 exact head。追加本 hosted 证据会产生一个仅文档
的新 PR head；合并前仍须在 PR 上检查该最终 head 的 Linux/macOS checks，避免把旧 SHA 的结果冒充为
最终 SHA 的 hosted evidence。

## 尚未验证

- 完整 desktop 手工工具、Console 调宽、所有 tab、two-tab 与长时间 diagnostics 操作：**Not run**。
- Safari macOS、物理 iPad Safari、Apple Pencil、命名数位板/driver、真实手指手势：
  **Not run / Unverified**。
- Home Screen、shared-origin/subpath、offline/update/旧 cache/install 等 PWA：
  **Not run / Unverified**。
- 追加 hosted 证据后产生的最终仅文档 PR head：必须在合并前检查 exact-head Linux/macOS CI；
  该递归证据记录在 PR 检查/评论中，不回写本文件制造无限 evidence commit。

因此这份证据只关闭“development Console 无键盘入口”的 browser-simulated 操作缺口，不改变
Pressure Ink V2 的物理设备停止条件，也不能被表述为 iPad、Safari、Pencil 或真实 touch 支持。
