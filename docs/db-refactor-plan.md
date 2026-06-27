# DB 模块重构方案（参考 dbx）

> 状态：**仅方案，未改代码**。供过目。
> 目标：把 devX 的数据库前端从"乱"理顺，借鉴 https://github.com/t8y2/dbx 的前端组织方式。

---

## 0. 先澄清一个核心误解：要不要"把驱动换成命令"

**不要换，也不需要换——你现在已经是"发命令"的模式了。**

| | devX（你现在） | dbx |
|---|---|---|
| 前端 | Solid + TS（Chrome 扩展） | Vue 3 + TS（Tauri webview） |
| 后端 | Go + GORM 原生驱动 | Rust + sqlx/redis-rs/mongodb 原生驱动 |
| 前端↔后端 | WebSocket JSON 命令 | Tauri IPC command |
| **前端驱动数** | **0** | **0** |
| 驱动位置 | 后端二进制内 | 后端二进制内 |

- 你担心的"驱动很多"——驱动只在 **Go 后端**里，是编译期 import，体积增量极小，且统一在 GORM 一个接口后。前端 `package.json` **一个 DB 驱动都没有**。
- "连不同库只需发命令、TCP/HTTP 返回"——**这正是你现在做的事**（`service.ts:637` `executeDbSocketCommand` → WebSocket → `server/.../db.go` → GORM）。
- "全换成命令行 CLI（`psql`/`mysql`/`redis-cli`）"——dbx 自己都明确**没这么做**（"native drivers rather than relay servers or CLI tools"）。CLI 方案要求用户装齐各家命令行、解析脆弱文本输出、丢失类型，强烈不推荐。

**结论：架构层面你和 dbx 是同一思路，无需改。乱的是前端 TypeScript 的代码组织。**

---

## 1. 真正的痛点（按严重度排序）

| 文件 | 行数 | 问题 |
|---|---|---|
| `components/db-panel.tsx` | **4736** | 巨型组件：连接管理 + explorer 树 + tab + 查询执行 + 结果网格 + 弹窗全塞一个文件 |
| `service.ts` | **1577** | 混了传输(WebSocket)、workspace 持久化、tab 状态规范化、SQL 生成、结果解析 |
| `adapters/base-sql.ts` | **713** | 前端在生成 explorer/count/索引/外键/主键等大量 SQL |
| 10+ 个 adapter | ~2000 | 每个 DB 一个 OOP 子类，重复的 SQL 拼接逻辑 |

**症结**：dbx 把 SQL 生成放**后端**、前端用**数据驱动的能力模型**；devX 把 SQL 生成放**前端**、用**每库一个子类的 OOP 继承**。后者随 DB 种类增长而膨胀，正是"乱"的来源。

---

## 2. dbx 前端值得抄的 4 个模式

调研自 `t8y2/dbx` 的 `apps/desktop/src/`：

### 2.1 数据驱动的能力清单（替代 OOP adapter 继承）
- dbx 没有"每个数据库一个类"。它有一份**清单** `database-drivers.manifest.json`，每个 DB 声明：`runtimeMode`、`supportLevel`、16 个布尔能力位（`queryExecution`/`tableDataEdit`/`sqlExplain`/`schemaSearch`/`diagram`...）。
- 前端用 `supportsFeature(dbType, capability)` **查表**决定 UI 显隐，而不是 `instanceof` / 多态。
- 差异极大的库（Redis/Mongo/KV）才有专门的 `lib/redis*.ts` / `lib/mongo*.ts` 模块 + 对应组件目录。

### 2.2 单一 `api.ts` 门面 + 可切换传输层
```
UI/store  →  lib/api.ts (门面，带计时/错误日志)  →  lib/tauri.ts | lib/http.ts
```
- 组件/store **从不直接** `invoke`。门面在运行时选后端（Tauri 桌面 or HTTP web）。
- 对 devX 的价值：你已有 WebSocket 传输，把它收敛成一个 `api` 门面，组件就与传输解耦。

### 2.3 SQL 生成下沉到后端
- dbx 前端的 `lib/*Sql.ts` 都是**薄包装**，真正建 SQL 的是 Rust：`build_table_select_sql` / `build_count` / `build_explain_sql` / DDL 全在后端。
- 前端只留：**标识符引号**（`quoteTableIdentifier` 按方言）、**EXPLAIN 结果解析可视化**、方言推断、CodeMirror 方言映射。

### 2.4 状态按职责拆 store（composable 粘合）
- `connectionStore`：连接列表 + explorer 树（懒加载子节点、pinned、自动补全元数据缓存）。
- `queryStore`：查询 tab + 执行 + EXPLAIN + 分页/取消（client 端生成 `executionId`）。
- **结果网格不进 store**：靠 `components/grid/` + `lib/dataGrid*.ts` + composable。

---

## 3. devX 的落地方案（保留 Go 后端 + WebSocket，只理前端）

> Solid.js 没有 Pinia，用 `createStore` / context + 模块化 service 对应即可。

### 阶段 A：拆 `db-panel.tsx`（4736 → 多个 < 500 行组件）
按 dbx 的 feature 分组（不是按 DB 分），拆为：
- `components/connections/`：连接列表、连接弹窗、保存的连接（已有 `db-connection-modal.tsx` 等可归入）
- `components/explorer/`：左侧 schema/对象树（懒加载、搜索、右键菜单）
- `components/editor/`：SQL 编辑器 tab（已有 `db-code-editor.tsx` / `db-editor-pane.tsx`）
- `components/grid/`：结果网格（已有 `db-result-grid.tsx`，把网格逻辑抽到 `lib/data-grid*.ts`）
- `db-panel.tsx` 只留**布局编排** + 把状态/动作通过 context 传下去。

### 阶段 B：拆 `service.ts`（1577 → 分层）
拆成：
- `lib/db-transport.ts`：WebSocket 生命周期、`executeDbSocketCommand`、pending 请求管理、重连（现 `service.ts:629-761`）。
- `lib/db-api.ts`：**门面**，对 UI 暴露 `connect/disconnect/query/listObjects/loadDetail/cancel`，内部调 transport。对应 dbx 的 `api.ts`。
- `stores/db-connections.ts`：连接 + explorer 树状态 + workspace 持久化（现 normalize/load/save 那一片）。
- `stores/db-query.ts`：tab + 执行状态 + 取消。

### 阶段 C：用"能力清单"收敛 adapter（可选，收益最大但工作量也最大）
两条路线，**二选一**：

**C1（推荐，渐进）**：保留 adapter 接口，但把 16+ 能力位提到 `models.ts` 的一张 `Record<DbConnectionKind, DbCapabilities>` 表里，UI 改成查表 `supportsFeature(kind, cap)`。SQL 生成暂留前端。风险低，立刻消除散落的 `if (kind === ...)`。

**C2（彻底，对齐 dbx）**：把 explorer/count/索引/外键等 SQL 生成**下沉到 Go 后端**（新增 `build_*_sql` 命令），前端 `base-sql.ts` + 各 adapter 的 SQL 拼接逻辑大幅删除，只留标识符引号 + 结果解析。这样新增一个 SQL 库几乎零前端改动。工作量大（要动 Go），但根治"adapter 膨胀"。

> 建议：A、B 先做（纯前端、低风险、立竿见影）；C 评估后单独立项，优先 C1。

---

## 4. 不要做的事
- ❌ 改成 Tauri/Rust（= 重写整个项目，你现在是 Chrome 扩展）。
- ❌ 把驱动换成命令行 CLI。
- ❌ 在前端引入任何 DB 驱动 npm 包。

---

## 5. 建议的执行顺序（若后续动手）
1. **阶段 B 先于 A**：先把 `service.ts` 分出 `db-transport` / `db-api` 门面（不动 UI），建立组件与传输的边界。
2. **阶段 A**：在门面就位后拆 `db-panel.tsx`，每个子组件只依赖 `db-api` + store。
3. **阶段 C1**：能力查表，删散落分支。
4. （可选）**阶段 C2**：SQL 下沉后端。

每一阶段结束跑 `npm run typecheck` + `npm run build`，并手动验证：连接各类型库、跑查询、展开 explorer 树、结果网格分页/取消、Redis/Mongo 特殊路径。

---

## 6. 待你拍板的问题
1. 阶段 C 走 **C1（查表，纯前端）** 还是 **C2（SQL 下沉 Go 后端）**？
2. 是否接受按 dbx 的 feature 分目录重排 `components/`（connections/explorer/editor/grid）？
3. 先从哪个阶段动手？（建议 B → A → C1）
