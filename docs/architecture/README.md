# Architecture field guide

这是对 [`../01_ARCHITECTURE.md`](../01_ARCHITECTURE.md) 的开发速查，不替代正式决策记录。

## 先判断变化属于哪一层

```text
Is it reusable Drawnix UI/behavior?
  yes -> packages/drawnix (optional, backward-compatible API)
  no
  Is it a Plait-specific read/write/coordinate concern?
    yes -> packages/magic-plait
    no
    Is it a framework-free contract or data structure?
      yes -> packages/magic-core
      no
      Is it per-board orchestration/lifecycle?
        yes -> packages/magic-runtime
        no
        Is it diagnostics only?
          yes -> packages/magic-console
          no -> apps/magic-blackboard (product composition/policy)
```

未来 provider 或服务端实现不应被塞入上述任意包来绕过架构决策；先更新 `docs/00_DECISION.md`，再建立清晰 adapter/server 边界。

## 不变量检查表

- `magic-core` 能否在 Node 单测中运行且不 import React、DOM、Plait？
- `magic-runtime` 是否每 board 一个实例、无 module singleton、dispose 幂等？
- `magic-plait` 是否自己注册也自己移除所有监听？
- 新 `DrawnixProps` 是否可选，省略时 `apps/web` 行为不变？
- product persistence 是否留在 Magic app，namespace/version 是否正确？
- console 关闭时是否停止高频订阅/渲染？
- feature 关闭或未知时是否无行为变化？
- error path 是否和 success path 一样释放资源？
- 新状态能否导出/迁移/清除，而不是永久困在浏览器里？
- 是否发送、记录或提交了本可不需要的白板/用户数据？

## 常见错误落点

| 错误做法 | 原因 | 改法 |
| --- | --- | --- |
| 在 `packages/drawnix` import `magic-runtime` | 反向依赖且污染上游通用层 | app 通过可选 prop/plugin 组装 |
| runtime 直接遍历 Plait 私有字段 | 适配边界失效、升级脆弱 | 在 `magic-plait` 增加稳定查询 |
| console 持有自己的业务状态副本 | 诊断 UI 变成第二真相源 | 只读 runtime public snapshot/events |
| 把 raw pointer event 写 localforage | 性能、体积、隐私风险 | bounded in-memory diagnostics |
| 在 `VITE_*` 放模型 API key | 会进入客户端 bundle | server-only secret + backend proxy |
| 将 `unknown` 意图强行映射成动作 | 制造错误自动化 | 保持 unknown 或请求用户澄清 |

## 生命周期测试模板

每个拥有外部资源的组件/对象至少覆盖：

1. 第一次 attach/mount 创建预期资源；
2. 重复 attach 的语义明确（拒绝、替换或幂等）；
3. detach/unmount 移除 listeners/subscriptions/timers/workers；
4. dispose 两次不抛出、不重复发事件；
5. 两个 runtime 不共享状态；
6. 中途初始化失败仍清理已创建资源；
7. React Strict Mode 的 remount 不累积副作用。

## 架构变更证据

提交架构变化时，在 PR 中附上：变化前后依赖方向、被触碰的 public contract、兼容/迁移计划、自动测试、手工验证、性能/隐私影响和回滚路径。若改变 Accepted decision，同一 PR 必须更新决策与验收文档。
