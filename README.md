# Magic Blackboard

Magic Blackboard 是一个面向教学与学习的、本地优先的无限黑板。当前 Foundation 版本先把可靠白板、上下文显式输入、持久化、运行时边界和开发诊断搭稳；意图识别、模型调用、Actor 和压感笔迹尚未实现。

第一条开发路线是响应式 Web/PWA：同一套代码优先覆盖桌面浏览器与 iPad Safari，并在后续用真实 iPad + Apple Pencil 做能力门槛验证。项目在没有 API key、账号或后端的情况下即可运行。

## 快速开始

需要 Node `20.20.2` 与 npm `10.8.2`（见 `.nvmrc` 和根 `package.json`）：

```bash
npm ci
npm run start:magic
```

打开终端显示的本地地址。开发环境中按 `Cmd/Ctrl + Shift + D` 可打开 Magic Console。

常用质量命令：

```bash
npm run test:magic
npm run build:magic
npm run lint
npm run format:check
```

## 当前结构与文档

- `apps/magic-blackboard`：Magic Blackboard 产品 App 与四个独立 localforage 命名空间。
- `packages/magic-core`：无 React/DOM/Plait 依赖的事件、feature、settings 与未来智能接口。
- `packages/magic-plait`：Plait Canvas Adapter。
- `packages/magic-runtime`：每块 board 独立的 runtime 与生命周期。
- `packages/magic-console`：仅开发诊断，不参与白板正确性。
- `apps/web`：保留的上游 Drawnix 回归参考 App。

从 [`docs/README.md`](docs/README.md) 阅读决策、架构、平台路线、模型接入边界和验收记录。贡献前请阅读 [`AGENTS.md`](AGENTS.md)、[`SECURITY.md`](SECURITY.md) 与 [`NOTICE.md`](NOTICE.md)。公开仓库不得提交 API key、真实课堂内容或用户数据。

下一阶段工作单是 [`prompts/03_PRESSURE_INK_V2.md`](prompts/03_PRESSURE_INK_V2.md)，Foundation 阶段不会执行它。

Foundation 目前只支持本地开发；继承的容器/包发布入口已 fail-closed 禁用，尚未声明 hosted/production-ready。

---

## 上游 Drawnix 参考说明

本仓库基于 `plait-board/drawnix` 的 MIT 版本建立，并保留原始白板 App、历史与以下上游说明。确切 baseline 和归属见 [`NOTICE.md`](NOTICE.md)。

<p align="center">
  <picture style="width: 320px">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h.svg?raw=true" />
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h_dark.svg?raw=true" />
    <img src="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h.svg?raw=true" width="360" alt="Drawnix logo and name" />
  </picture>
</p>
<div align="center">
  <h2>
    开源白板工具（SaaS），一体化白板，包含思维导图、流程图、自由画等
  <br />
  </h2>
</div>

<div align="center">
  <figure>
    <a target="_blank" rel="noopener">
      <img src="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/product_showcase/case-2.png" alt="Product showcase" width="80%" />
    </a>
    <figcaption>
      <p align="center">
        All in one 白板，思维导图、流程图、自由画等
      </p>
    </figcaption>
  </figure>
  <a href="https://hellogithub.com/repository/plait-board/drawnix" target="_blank">
    <picture style="width: 250">
      <source media="(prefers-color-scheme: light)" srcset="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=4dcea807fab7468a962c153b07ae4e4e&claim_uid=zmFSY5k8EuZri43&theme=neutral" />
      <source media="(prefers-color-scheme: dark)" srcset="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=4dcea807fab7468a962c153b07ae4e4e&claim_uid=zmFSY5k8EuZri43&theme=dark" />
      <img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=4dcea807fab7468a962c153b07ae4e4e&claim_uid=zmFSY5k8EuZri43&theme=neutral" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54"/>
    </picture>
  </a>

  <br />

  <a href="https://trendshift.io/repositories/13979" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13979" alt="plait-board%2Fdrawnix | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

[*English README*](https://github.com/plait-board/drawnix/blob/develop/README_en.md)

## 特性

- 💯 免费 + 开源
- ⚒️ 思维导图、流程图
- 🖌 画笔
- 😀 插入图片
- 🚀 基于插件机制
- 🖼️ 📃 导出为 PNG, JSON(`.drawnix`)
- 💾 自动保存（浏览器缓存）
- ⚡ 编辑特性：撤销、重做、复制、粘贴等
- 🌌 无限画布：缩放、滚动
- 🎨 主题模式
- 📱 移动设备适配
- 📈 支持 mermaid 语法转流程图
- ✨ 支持 markdown 文本转思维导图（新支持 🔥🔥🔥）


## 关于名称

***Drawnix***  ，源于绘画(  ***Draw***  )与凤凰(  ***Phoenix***  )的灵感交织。

凤凰象征着生生不息的创造力，而 *Draw* 代表着人类最原始的表达方式。在这里，每一次创作都是一次艺术的涅槃，每一笔绘画都是灵感的重生。

创意如同凤凰，浴火方能重生，而  ***Drawnix***  要做技术与创意之火的守护者。

*Draw Beyond, Rise Above.*


## 与 Plait 画图框架

*Drawnix* 的定位是一个开箱即用、开源、免费的工具产品，它的底层是 *Plait* 框架，*Plait* 是我司开源的一款画图框架，代表着公司在知识库产品([PingCode Wiki](https://pingcode.com/product/wiki?utm_source=drawnix))上的重要技术沉淀。


Drawnix 是插件架构，与前面说到开源工具比技术架构更复杂一些，但是插件架构也有优势，比如能够支持多种 UI 框架（*Angular、React*），能够集成不同富文本框架（当前仅支持 *Slate* 框架），在开发上可以很好的实现业务的分层，开发各种细粒度的可复用插件，可以扩展更多的画板的应用场景。


## 仓储结构

```
drawnix/
├── apps/
│   ├── web                   # drawnix.com
│   │    └── index.html       # HTML
├── dist/                     # 构建产物
├── packages/
│   └── drawnix/              # 白板应用
│   └── react-board/          # 白板 React 视图层
│   └── react-text/           # 文本渲染模块
├── package.json
├── ...
└── README.md
└── README_en.md

```

## 应用

[*https://drawnix.com*](https://drawnix.com) 是 *drawnix* 的最小化应用。

近期会高频迭代 drawnix.com，直到发布 *Dawn（破晓）* 版本。


## 开发

```
npm install

npm run start
```

## Docker

```
docker pull pubuzhixing/drawnix:latest
```

## 依赖

- [plait](https://github.com/worktile/plait) - 开源画图框架
- [slate](https://github.com/ianstormtaylor/slate)  - 富文本编辑器框架
- [floating-ui](https://github.com/floating-ui/floating-ui)  - 一个超级好用的创建弹出层基础库



## 贡献

欢迎任何形式的贡献：

提交 Issue 或 Pull Request 前，请先阅读 [贡献指南](CONTRIBUTING.md)。

- 提 Bug

- 贡献代码

## 感谢支持

特别感谢公司对开源项目的大力支持，也感谢为本项目贡献代码、提供建议的朋友。

<p align="left">
  <a href="https://pingcode.com?utm_source=drawnix" target="_blank">
      <img src="https://cdn-aliyun.pingcode.com/static/site/img/pingcode-logo.4267e7b.svg" width="120" alt="PingCode" />
  </a>
</p>

## License

[MIT License](https://github.com/plait-board/drawnix/blob/master/LICENSE)
