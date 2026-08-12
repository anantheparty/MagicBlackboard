# 02 — GitHub 与公开仓库工作流

## 已核对的仓库拓扑

核对日期：2026-08-12。

```text
GitHub account (gh): anantheparty
origin fetch/push:   https://github.com/anantheparty/MagicBlackboard.git
pushDefault:         origin
repository:          PUBLIC
default branch:      main
upstream fetch:      https://github.com/plait-board/drawnix.git
upstream push:       DISABLED
upstream baseline:   develop @ b0d682ce9896784dc42889afde7bda95e456aa7d
working branch:      agent/bootstrap-foundation (at time of inspection)
```

分支名是一次检查快照，不是永久要求；remote 角色和 baseline 是架构来源信息。不要把个人 access token、`gh auth token` 输出或 credential helper 内容放进文档/issue/日志。

本地只读复核：

```bash
gh auth status
gh repo view anantheparty/MagicBlackboard \
  --json nameWithOwner,visibility,defaultBranchRef,url
git remote -v
git config --get remote.upstream.pushurl
git rev-parse HEAD
```

若在新 clone 中恢复安全 remote 拓扑：

```bash
git remote rename origin upstream
git remote set-url upstream https://github.com/plait-board/drawnix.git
git remote set-url --push upstream DISABLED
git remote add origin https://github.com/anantheparty/MagicBlackboard.git
git remote set-url --push origin https://github.com/anantheparty/MagicBlackboard.git
git config remote.pushDefault origin
```

执行前逐条看 `git remote -v`；已有正确 remote 时不要重复运行。

## 分支与提交节奏

允许并鼓励频繁提交，但每次提交都要可解释、可检查、尽可能可回退。推荐 foundation 拆分：

1. `docs: record product and platform decisions`
2. `chore: scaffold magic packages and app`
3. `feat(core): add runtime primitives`
4. `feat(plait): add canvas adapter and Drawnix extension seam`
5. `feat(app): compose local-first Magic Blackboard`
6. `feat(console): add bounded development diagnostics`
7. `test: cover lifecycle and compatibility contracts`
8. `ci: verify Magic Blackboard on macOS`

实际拆分以依赖顺序为准；不要为了匹配列表把无法构建的半成品推到 `main`。提交前：

```bash
git status --short
git diff --check
git diff --staged --stat
git diff --staged
```

只 stage 本次意图内的文件。多人/多 agent 共用 worktree 时，不得提交、格式化或回退他人改动。禁止 force-push `main`，禁止向 upstream push。

## PR 约定

- 标题和摘要说明用户可见结果，而不是只写“update files”。
- 填写 `.github/pull_request_template.md` 的 Validation 和 AI Assistance。
- 列出真实命令、exit status、未运行项；UI 改动附无个人内容的截图。
- 通用 Drawnix API 变化说明 `apps/web` 兼容证据。
- storage/schema 变化说明 migration、回滚和旧数据保留方式。
- 模型/遥测相关变化说明发送哪些数据、给谁、为何需要、保存多久、如何关闭/删除。

## GitHub 安全设置状态

通过 GitHub API 于 2026-08-12 复核，以下设置已经在公开仓库
`anantheparty/MagicBlackboard` 生效：

- secret scanning：enabled；push protection：enabled；
- secret scanning 的 non-provider patterns 与 validity checks：disabled（可选增强项，不能把它们
  误写成已启用）；
- Dependabot alerts（vulnerability alerts）：enabled；Dependabot security updates：enabled；
- private vulnerability reporting：enabled；
- Actions 默认 workflow 权限：read；workflow 不能批准 pull request review；
- `main` branch protection：禁止 force push，禁止删除。

当前 `main` **尚未**配置 required status checks 或 required pull-request reviews。Foundation
分支的 CI 还没有在 GitHub 上获得首轮通过证据，因此不能把“CI 必须通过”提前设成一个
不存在的检查名。发布分支并确认实际 check 名称后，应补上 required checks；若仓库进入多人
维护，再要求至少一个 review。当前保护降低了误删和改写风险，但不等同于“所有变更必须经
PR 合并”。

仍待后续发布阶段处理：

- 为 container/package 发布环境设置独立 environment protection 和最小 secrets；
- 保护 release tag，并在发布前核对 `NOTICE.md`、`LICENSE` 与来源 commit；
- 当前 Foundation publish path 双重 fail-closed：提交 `cdb319a` 中的 workflow 只有
  `workflow_dispatch`、`contents: read` 和一个不读 secret/不产物的说明 step；GitHub workflow
  `332597386` 也已手动 disable。根级发布脚本同样 fail-closed。建立产品镜像、发布审批和
  回滚方案前不得重新启用任何一层。

2026-08-12 push 时，GitHub 针对当时仍在远端 `main` 的旧上游 lockfile 显示 88 条 Dependabot
findings。这个数字属于旧远端快照，不能与 Foundation 工作树的 `npm audit` 结果混用；
Foundation lockfile 合入后等待 GitHub 重新分析，再记录新的远端结果。

参考：[GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)、[push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)、[repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)、[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository)。访问于 2026-08-12。

## 公开仓库发布前安全门

每次 push 前回答“否”：

- staged diff 是否包含 token/key/password/cookie/private key/connection string？
- 是否包含 `.env`、本地配置、浏览器 profile、认证文件或命令历史？
- fixture、截图、board export 是否含真实学生/教师姓名、邮箱、课程内容或手写样本？
- URL、日志、error snapshot 是否暴露内部 host、query token、完整 prompt/response？
- source map 或前端 env 是否意外暴露服务端配置？
- 依赖/素材/模型是否缺少允许公开再分发的许可证和归属？

当前 Foundation 不需要 API key。`.env.example` 只能出现变量名与无敏感默认值；本地 `.env*` 必须被 `.gitignore` 排除。`VITE_*` 会进入客户端，应一律视为公开。

如果 secret 曾进入 commit，即使尚未 push，也先停止：撤销/轮换凭据，再在不破坏他人工作的前提下清理。若已 push，立即 revoke/rotate、检查使用记录并按 [`../SECURITY.md`](../SECURITY.md) 协调处置；“从最新 commit 删除”不能使旧历史中的 secret 失效。

## 同步 upstream

Foundation 期间不主动大规模同步。需要同步时单独开分支/PR：

```bash
git fetch upstream develop
git log --oneline --left-right --cherry-pick HEAD...upstream/develop
```

先审查 release notes、license、依赖和 Drawnix public API；把 upstream merge 与 Magic 产品功能分开提交，运行上游 app 与 Magic app 全套回归，更新 `NOTICE.md` 中的 adopted baseline。不要通过 rebase/force push 抹掉已公开的 Magic 历史。
