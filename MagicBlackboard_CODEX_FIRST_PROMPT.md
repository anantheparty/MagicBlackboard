# 直接交给本地 Codex 的第一轮 Prompt

请在当前仓库中建立 Magic Blackboard 的基础白板和可持续迭代结构。不要开始做 AI、压感或动画，先把地基搭稳。

## 一、阅读和检查

先阅读：

- `AGENTS.md`
- `docs/00_DECISION.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_GITHUB_SETUP.md`
- `docs/05_ACCEPTANCE_CRITERIA.md`

然后检查：

- Git 分支、remote、工作区状态；
- 当前 commit；
- `.nvmrc`；
- Nx、React、Vite、Plait、Drawnix 的实际版本；
- `apps/web`；
- `packages/drawnix/src/drawnix.tsx`；
- `packages/drawnix/src/hooks/use-drawnix.tsx`；
- 当前 CI；
- 当前测试和构建命令。

预期上游基线：

```text
plait-board/drawnix develop
b0d682ce9896784dc42889afde7bda95e456aa7d
Node 20.20.2
npm
```

运行基线：

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
```

把真实结果写入 `docs/baseline/<today>.md`。基线失败时记录原因，不允许通过批量升级依赖掩盖问题。

## 二、新建产品 App

保留 `apps/web` 为上游参考。

新增 `apps/magic-blackboard`：

- React/Vite/Nx；
- 使用 `@drawnix/drawnix`；
- 全屏无限白板；
- 保留所有现有 Drawnix 工具；
- 品牌显示 `Magic Blackboard`；
- 独立 localforage namespace：
  - `magic_blackboard.board.v1`
  - `magic_blackboard.preferences.v1`
  - `magic_blackboard.features.v1`
  - `magic_blackboard.console.v1`
- 保存 board children、viewport、theme、tool state、preference；
- 中文默认、英文可切换；
- 不接入模型。

增加根脚本：

```text
start:magic
build:magic
```

## 三、为 Drawnix 增加最小通用扩展点

不要写 Magic 专属逻辑进 `packages/drawnix`。

以向后兼容方式允许产品 App：

- 追加 Plait plugins；
- 取得初始化后的 board；
- 必要时渲染通用 board overlay。

优先利用现有 `afterInit`，避免造两个含义相同的 callback。新增 props 必须有测试，默认不改变 `apps/web`。

## 四、新建基础 packages

按当前 Nx 版本和仓库惯例建立：

```text
packages/magic-core
packages/magic-plait
packages/magic-runtime
packages/magic-console
```

创建前先查看 Nx generator 帮助，不要凭记忆使用旧参数。

### magic-core

实现：

- 强类型 `MagicEventBus`；
- 可 dispose；
- 固定容量 ring buffer；
- `MagicFeatureRegistry`；
- Settings Store 接口；
- 无 React/Plait 依赖。

### magic-plait

实现最小 `PlaitCanvasAdapter`：

- attach/detach board；
- snapshot；
- current selection；
- elements by IDs；
- selection bounds；
- world/screen conversion；
- selection/document/viewport events。

### magic-runtime

实现：

- `createMagicRuntime()`；
- runtime ID；
- features、events、settings、canvas；
- 每个 board 独立；
- dispose；
- actor 和 intent 只保留清晰接口，不伪造实现。

### magic-console

做一个集成在产品 App 右侧的开发控制台：

- `Cmd/Ctrl + Shift + D`；
- 折叠；
- 调宽；
- Overview；
- Features；
- Board Inspector；
- Input；
- Actors；
- Events；
- 当前未实现项明确显示；
- Feature 状态持久化；
- Console 关闭时不做高频无意义渲染；
- dev 默认可用；
- production 默认隐藏；
- `VITE_ENABLE_DEV_CONSOLE=1` 可开启。

注册占位 Feature：

```text
magic.ink-diagnostics
magic.actor
```

它们目前不得改变白板行为。

## 五、App 装配

在 `apps/magic-blackboard`：

```text
创建 Runtime
→ 安装 additional Plait plugins
→ board ready 后 attach Canvas Adapter
→ 渲染 Console
→ unmount 时完整 dispose
```

不得使用全局 Runtime 单例。

## 六、仓库治理

新增：

- `NOTICE.md`，保留 Drawnix/Plait 归属；
- 必要的架构 README；
- macOS build CI；
- Magic App build 检查。

不要：

- 删除 LICENSE；
- 全仓重命名 Drawnix；
- 升级主要依赖；
- 引入 AI SDK；
- 引入 WebSocket；
- 引入 Electron；
- 实现 pressure；
- 实现 Actor；
- 把 pointermove 日志永久写入 IndexedDB。

## 七、测试和验收

至少测试：

- 产品 App mount；
- 上游 App 不受影响；
- EventBus；
- ring buffer；
- Feature toggle；
- 两个 Runtime 隔离；
- CanvasAdapter selection/bounds；
- Console 快捷键；
- mount/unmount listener 清理；
- default Drawnix API 向后兼容；
- lint、format、test、build。

完成后运行真实命令，不得伪造通过。

## 八、最终输出

输出：

1. 实施摘要；
2. 架构决定；
3. 修改文件列表；
4. 命令与真实结果；
5. 启动方式；
6. 手工验收步骤；
7. 未验证项；
8. 推荐 commit 拆分；
9. 下一轮应该使用 `prompts/03_PRESSURE_INK_V2.md`，但本轮不要继续执行。

本轮完成后停止。
