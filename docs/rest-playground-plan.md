# REST Playground Plan

## 目标

在 `Chrome Extension + SolidJS + UnoCSS + Manifest V3` 的约束下，先落地一个面向开发者的 REST API 调试工具。

产品参考是 Firecamp 的 REST 体验，但第一阶段不追求完整复刻，而是优先覆盖最常用的 API 调试场景，让扩展先具备稳定、清晰、可持续扩展的基础能力。

## 产品定位

- 形态：Chrome 扩展
- 主工作区：扩展内的完整页面 `app.html`
- 快捷入口：点击扩展图标后打开主页面
- 全局配置：`options page`
- 当前范围：纯扩展能力内可实现的 REST Playground

## 为什么先做 REST

REST 是当前这款扩展最容易形成闭环的模块：

- 能直接使用扩展的跨域请求能力
- 能快速验证整个应用架构是否合理
- 能反向驱动环境变量、历史记录、收藏夹、响应查看等通用基础设施
- 后续很多工具能力都可以复用它的编辑器、存储和布局

## 对标参考

参考产品：

- Firecamp: https://firecamp.dev/
- Firecamp GitHub: https://github.com/firecamp-dev/firecamp

参考方式：

- 学习它的工作流和信息组织方式
- 不在第一阶段追求多协议、多协作、多脚本能力
- 优先做一个更聚焦的扩展版 REST Playground

## MVP 范围

第一阶段只做最核心的 REST 请求与响应体验。

### 包含

- 请求方法选择
- URL 输入
- Query Params 编辑
- Headers 编辑
- Body 编辑
- Body 类型：
  - `none`
  - `raw text`
  - `JSON`
  - `x-www-form-urlencoded`
  - `multipart/form-data`
- Auth：
  - `none`
  - `Bearer Token`
  - `Basic Auth`
  - `API Key`
- Send / Cancel
- Response 面板：
  - `status`
  - `headers`
  - `body`
  - `time`
  - `size`
- 历史记录
- 环境变量
- 请求保存与收藏

### 暂不包含

- GraphQL
- WebSocket
- Socket.IO
- Pre-request scripts
- Test scripts
- Code snippet generator
- 团队协作
- Postman 导入导出
- 高级 SSL / Proxy / 桌面级网络代理能力

## Chrome 扩展边界

这一版默认遵守纯扩展边界，不依赖本地 agent。

### 能做

- 跨域 HTTP/HTTPS 请求
- 请求编辑和响应查看
- 本地持久化历史记录、环境变量、收藏夹
- 文本格式化和差异查看

### 有限制

- 不能像桌面客户端那样控制底层 TLS/证书行为
- 某些受限请求头浏览器不允许手动覆盖
- Cookie、重定向、流式响应等行为会受浏览器环境影响
- 不提供原生 TCP 能力，因此不在当前范围内支持 SSH 和数据库原生协议

## 信息架构

主工作区使用完整页面，布局偏 IDE 风格。

### 建议布局

- 左侧：Collections / History / Environments
- 中间上方：Request Editor
- 中间下方：Response Viewer
- 顶部操作区：Send、Save、环境切换、请求名称

## 模块拆分

建议按 feature 分目录，而不是把逻辑都堆在入口文件里。

```text
src/
  features/
    rest/
      components/
      models/
      services/
      state/
    history/
    environments/
    collections/
  shared/
```

### `rest` 模块职责

- 请求编辑器
- Auth 面板
- Query / Header / Body 构建
- 请求执行
- 响应归一化

### `history` 模块职责

- 执行历史存储
- 历史过滤和清理
- 从历史恢复请求

### `environments` 模块职责

- 环境列表管理
- 变量编辑
- 变量解析

### `collections` 模块职责

- 保存请求
- 请求分组
- 后续导入导出能力的承载位置

## 核心数据模型

后续开发优先保持模型稳定，避免 UI 做完之后再回头重构存储结构。

### `RequestDraft`

```ts
type KeyValueItem = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "api-key"; key: string; value: string; addTo: "header" | "query" };

type RequestBody =
  | { type: "none" }
  | { type: "raw"; contentType: string; value: string }
  | { type: "json"; value: string }
  | { type: "form-urlencoded"; entries: KeyValueItem[] }
  | { type: "multipart"; entries: KeyValueItem[] };

type RequestDraft = {
  id: string;
  name: string;
  method: string;
  url: string;
  query: KeyValueItem[];
  headers: KeyValueItem[];
  body: RequestBody;
  auth: RequestAuth;
};
```

### `Environment`

```ts
type EnvironmentVariable = {
  id: string;
  key: string;
  value: string;
};

type Environment = {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
};
```

### `HistoryEntry`

```ts
type HistoryEntry = {
  id: string;
  request: RequestDraft;
  responseStatus: number | null;
  responseTimeMs: number;
  responseSize: number;
  createdAt: string;
};
```

### `Collection`

```ts
type Collection = {
  id: string;
  name: string;
  requestIds: string[];
};
```

## 核心服务

REST Playground 最先要稳定的不是页面样式，而是下面这些服务层。

### `variable-resolver`

负责把请求里的变量替换成当前环境值，例如：

```text
{{baseUrl}}/users/{{userId}}
```

### `request-builder`

负责把编辑器状态转换成真正可执行的请求配置：

- 拼接 query
- 过滤未启用项
- 注入 auth
- 处理 body
- 生成 headers

### `request-executor`

负责发起请求、取消请求、统计耗时，并返回标准化结果。

### `response-normalizer`

负责统一整理：

- status
- statusText
- headers
- bodyText
- size
- content type
- elapsed time

## 状态管理建议

当前阶段优先简单可靠：

- 页面局部状态：Solid signal / store
- 可复用模块状态：`src/features/*/state`
- 持久化：`chrome.storage.local` 或 `chrome.storage.sync`

建议：

- 设置类数据放 `sync`
- 历史记录和较大数据放 `local`

## UI 组件建议

第一阶段先不引入重组件库。

建议做法：

- 布局和基础样式：UnoCSS
- 常规输入组件：自己封装
- 弹层、菜单、Tabs 如果复杂度上来，再评估引入 headless 组件

这样可以保持扩展包体更轻，也更利于后期做产品化视觉统一。

## 开发阶段

按阶段推进，每个阶段都要保证可运行。

### Phase 1: REST 编辑器底座

目标：

- 定义 `rest` 相关类型
- 建立请求编辑器布局
- 支持 method、url、query、headers、body 基础编辑

交付结果：

- 完整页面中出现可交互的 REST Playground 主界面

### Phase 2: 请求执行与响应面板

目标：

- 接入真实 `fetch`
- 支持发送请求
- 展示 status、headers、body、time、size
- 支持取消请求

交付结果：

- 可以从扩展中发起 API 请求并查看响应

### Phase 3: 历史记录

目标：

- 保存请求历史
- 展示历史列表
- 支持从历史恢复请求

交付结果：

- 形成基本可回溯的工作流

### Phase 4: 环境变量

目标：

- 添加环境切换
- 支持变量占位符替换

交付结果：

- 请求可在不同环境间复用

### Phase 5: 收藏与 Collection

目标：

- 保存请求草稿
- 组织成 collection

交付结果：

- 工具从一次性调试走向可管理工作区

### Phase 6: Auth 与表单增强

目标：

- Bearer / Basic / API Key
- `multipart/form-data`
- `x-www-form-urlencoded`

交付结果：

- 覆盖更多真实 API 调试场景

## 当前执行顺序

接下来按这个顺序推进：

1. 建立 `src/features/rest` 目录和类型定义
2. 实现 REST Playground 页面骨架
3. 接入请求执行逻辑
4. 再补历史记录和环境变量

## 完成标准

第一阶段完成时，需要满足：

- 可以输入 URL 并发送 GET/POST 请求
- 可以编辑 query、headers、body
- 可以看到结构化响应
- 页面结构足够支撑后续历史、环境变量和收藏模块接入

## 文档使用方式

这份文档作为当前 REST 模块的开发基线。

后续每完成一个阶段时：

- 更新阶段状态
- 记录变更点
- 如果范围有变化，先修改文档再改实现
