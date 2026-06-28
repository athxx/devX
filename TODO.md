- [ ] 背景颜色可上传或者使用url, 默认为none
- [ ] API中转配置, 另外写一个golang的中转协议
- [ ] DB中转配置, 另外写一个中转协议
- [ ] SSH中转配置

# 服务器作用

- DB 中转
- SSH 中转
- API中转
- 图片处理 压缩, resize 格式转换
- JSON 格式化
- ASON 格式化
- Base64 转换
- 二维码encode/decode
- compare对比
- 密码记住 lastpass, bitwarden等, totp 验证

# DB 模块对齐 DBX（Go-native 方案 · 剩余工作）

参考完整路线图：`~/.claude/plans/foamy-twirling-brooks.md`
进度：18 → 27 种数据库已完成（Phase 0/1 已落地并通过 go build / go test / tsc / vite build 验证）。

每新增一种数据库的改动点（已验证的竖切）：
1. `src/features/db/models.ts` — 给 `DbConnectionKind` 联合类型加字面量
2. `src/features/db/adapters/<kind>.ts` — 新适配器（Tier A 为 ~15 行子类）
3. `src/features/db/adapters/registry.ts` — 注册到 `ADAPTERS`（漏注册会编译报错）
4. `src/features/db/components/db-panel-context.tsx` — 加入 `databaseKinds` 数组
5. Go：`server/internal/db/sqlrunner.go` 的 `buildDialector`（SQL 类）或
   `server/internal/http/handlers/db.go` 的 `processDBCommand`（非 SQL 类）+ 新 runner
6. `server/go.mod` — 新增驱动依赖（Tier A 无需新依赖）

## Phase 2 — AI SQL 助手（已完成）
- [x] NL→SQL 自然语言生成 SQL
- [x] SQL 解释 / 优化 / 修复（explain / optimize / fix）
- [x] 运行前安全检查（destructive 语句确认；无 WHERE 的 DELETE/UPDATE 重点提示）
- [x] 默认模型 Claude Opus 4.8（`claude-opus-4-8`），并支持 OpenAI 兼容 endpoint
- [x] 新增前端面板组件（编辑器右侧抽屉 `components/ai/db-ai-sidebar.tsx`）
- [x] 复用现有 `/api` 中转转发到模型 API（无需新增服务端路由）
- 实现：`features/db/ai/{ai-settings,ai-service,ai-operations}.ts`；设置持久化在 `['db','aiSettings']`；
  Key 前端本地存储、按请求转发；编辑器头部新增 AI 切换按钮。

## Phase 3 — Tier B 驱动（新的纯 Go / cgo-gated 驱动）✅
- [x] 引入 cgo 构建标签脚手架 `//go:build cgo_drivers`（默认二进制保持纯 Go） — `rawsql_cgo.go`
- [x] 引入 `DbDriverBackend` seam：让 `database/sql` 类驱动与 GORM 类共用 `scanSQLRows` — `rawsql.go`（`lookupRawSQLBackend`/`querySQLRaw`，在 `sqlrunner.go` 的 `QuerySQL`/`DisconnectSQLConnection` 中分发）
- [x] Snowflake — `github.com/snowflakedb/gosnowflake`（纯 Go，database/sql） — 适配器 `snowflake.ts`，注册于 `rawsql_drivers.go`
- [x] Trino — `github.com/trinodb/trino-go-client`（纯 Go，database/sql） — 适配器 `trino.ts`
- [x] Databend — `github.com/datafuselabs/databend-go`（纯 Go，database/sql） — 适配器 `databend.ts`
- [x] DuckDB — `github.com/marcboeker/go-duckdb`（cgo，置于 `cgo_drivers` 标签后） — 适配器 `duckdb.ts`，注册于 `rawsql_cgo.go`
- [x] TDengine 原生连接 — `github.com/taosdata/driver-go`（cgo，置于标签后） — 适配器 `tdengine.ts`，注册于 `rawsql_cgo.go`
  - 注：`-tags cgo_drivers` 构建要求本机已安装 TDengine 原生 C SDK（`taos.h`）；默认纯 Go 二进制不受影响。

## Phase 4 — Schema 可视化 / 对比 ✅
- [x] ER 图：基于适配器已有的 FK/列/主键查询，可视化外键关系 — 纯前端零依赖 SVG
  - 服务层 `service.ts`：`loadErModel(connection, tables)`（并发 6 拉列/PK/FK，建表盒+边）
  - 组件 `components/er/db-er-view.tsx`：最长路径分层布局、表盒（PK🔑/FK↗ 徽标）、
    正交折线边、拖拽平移 / 滚轮缩放 / Fit；面板态 `erModelByTabId` + `loadErModelForTab`
  - 入口：数据库分组右键菜单「ER Diagram」（`Network` 图标，`showExtended` 门控）
- [x] Schema diff：整库表结构对比（两个同类连接）
  - 纯逻辑 `lib/schema-diff.ts`：`diffSchemas(a,b)` → 增/删/改 表·列·索引·外键（无 I/O）
  - 服务层 `service.ts`：`loadSchemaSnapshot(connection, tables)`（复用 `loadDbObjectDetail`）
  - 组件 `components/diff/db-schema-diff-view.tsx`：双连接选择（同 kind 过滤）+ Compare，
    分组渲染 added/removed/changed；面板态 `schemaDiffByTabId` + `runSchemaDiffForTab`
  - 入口：连接右键菜单「Schema Diff」（`ArrowRightLeft` 图标，`isRelational()` 门控）
  - 派发：`db-editor-pane-view.tsx` 新增 `er` / `schema-diff` 两个 tab.type 分支
  - 注：仓库无前端测试 runner（无 vitest/jest），按既有惯例以 `tsc -b` 类型系统兜底

## Phase 5 — Tier C 向量/搜索 + 图/时序数据库
- [x] Qdrant — REST API（`/collections`、`/points/scroll`），纯 net/http
      runner: `server/internal/db/qdrant.go` + `httpstore.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/qdrant.ts`、registry、`databaseKinds`、`service.ts:loadQdrantExplorer`（points 展平为表格网格）
- [x] Weaviate — REST API（`/v1/schema`、`/v1/objects`、`/v1/graphql`），纯 net/http
      runner: `server/internal/db/weaviate.go` + `httpstore.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/weaviate.ts`、registry、`databaseKinds`、`service.ts:loadWeaviateExplorer`（objects→表格网格）
- [x] Milvus — `github.com/milvus-io/milvus-sdk-go/v2`（原生 gRPC，纯 Go，无 cgo），Query ResultSet 列转行展平为表格网格，type `milvus`
      runner: `server/internal/db/milvus.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/milvus.ts`、registry、`databaseKinds`、`service.ts:loadMilvusExplorer`（collections→空 expr 采样→表格网格）
- [x] Cassandra — `github.com/gocql/gocql`（native CQL 二进制协议，纯 Go，无 cgo），CQL 行展平为表格网格，type `cassandra`
      runner: `server/internal/db/cassandra.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/cassandra.ts`、registry、`databaseKinds`、`service.ts:loadCassandraExplorer`（keyspace→tables→CQL 采样→表格网格）
- [x] Neo4j — `github.com/neo4j/neo4j-go-driver/v5`（Bolt，纯 Go，无 cgo），Cypher 记录展平为表格网格，type `neo4j`
      runner: `server/internal/db/neo4j.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/neo4j.ts`、registry、`databaseKinds`、`service.ts:loadNeo4jExplorer`（node labels→Cypher 采样→表格网格）
- [x] InfluxDB — HTTP v2 Flux（`/api/v2/query`，注解 CSV 展平为表格网格），纯 net/http，type `influx`
      runner: `server/internal/db/influx.go` + `httpstore.go`；handler/disconnect: `handlers/db.go`/`disconnect.go`
      前端: `adapters/influxdb.ts`、registry、`databaseKinds`、`service.ts:loadInfluxExplorer`（buckets→表格网格）
- [ ] 各非 SQL 类新增 runner + 非 SQL 适配器（参照 elasticsearch.ts / bigtable.ts）

## Phase 6 — 剩余功能补齐（DBX 功能差距）
- [x] 数据库整库导出 / dump
      之前 `downloadDatabaseExport` 仅输出「导出计划」占位文本；本切片改为真实整库导出：
      `service.ts`:`exportDatabaseDump(connection, databaseName, tables, options)` —
      逐表 `SELECT * FROM <qualified>` 拉全部行（避开各方言 LIMIT/OFFSET 差异），
      SQL 格式输出 DROP（可选）+ 适配器真实 CREATE DDL（`buildDdlQuery`，可选）+ INSERT（可选批量）；
      CSV / JSON 按表序列化；值转义 `sqlLiteral`（单引号翻倍 / NULL / 数字 / 布尔 / Buffer→X'..' / 对象→JSON）。
      「Zip output」选项由零依赖 STORE-only ZIP 写入器实现：`src/lib/zip.ts`:`createZip`（含 CRC-32）。
      `db-ui-store.ts`:`databaseExporting` / `databaseExportError` 信号（导出中禁用按钮 + 错误提示）；
      `db-panel-context.tsx`:`downloadDatabaseExport` 改为 async（`collectTableLeaves` 枚举表 → 调用服务 → 下载）。
- [x] 表导入（CSV / Excel）— 先落地 CSV：纯前端解析 + 生成 INSERT 供用户审阅后运行
      零依赖解析器 `src/lib/csv.ts`:`parseCsv`（RFC 4180：引号 / 转义引号 / 内嵌逗号换行 / CRLF）；
      `service.ts`:`buildInsertStatementsFromCsv(connection, headers, rows, options)` —
      复用 `escapeIdentifier` / `buildQualifiedName`，`csvCellLiteral` 做轻量类型推断
      （整数/小数原样、true/false→布尔、空→NULL（可选）、null→NULL、其余引号转义字符串），
      支持批量 VALUES；表名默认取文件名（去扩展名）。
      `db-panel-context.tsx`:`pickFile`（隐藏 file input + focus 兜底取消）+ `importCsvFile`
      （选文件→读文本→parseCsv→生成 SQL→`openConnectionActionQuery` 打开新标签，raw 视图）。
      入口：数据库分组右键「Import」子菜单新增「From CSV file…」（`FileSpreadsheet` 图标，
      原 SQL/JSON/CSV 占位模板降级为「… template」项）；新图标注册于 `db-icons.tsx`。
      注：Excel（xlsx）为二进制格式，需引入解析器，留待后续；当前覆盖 CSV 实路径。
- [ ] 数据对比（compare）+ 同步输出
- [ ] 数据迁移 / 传输（连接间复制行）
- [ ] 字段/列级血缘分析（lineage）
- [ ] 文件预览：拖拽 Parquet/CSV/JSON（依赖 Phase 3 的 DuckDB）
- [ ] 连接导入：从 DBeaver / Navicat 配置导入
- [x] 保存的 SQL 片段（snippets）
      模型/持久化已存在（`DbFavoriteQuery` + `createDbFavorite` + `['db'].favorites`），本切片补 UI：
      编辑器工具条新增「Snippets」按钮 → `db-panel.tsx` 片段弹窗（保存当前查询、列表、点击插入、删除）；
      `db-ui-store.ts`:`favoritesModalOpen`；`db-panel-context.tsx`:`getCurrentConnectionFavorites` /
      `saveCurrentQueryAsFavorite` / `deleteFavorite` / `applyFavoriteToCurrentTab`（镜像 History 模式）
- [x] 编辑器主题对齐 DBX（命名主题 + 选择器，持久化于 `['temp','dbUi'].editorThemeId`）
      `db-code-editor.tsx`：从「light/dark 二态」改为命名主题注册表 `EDITOR_THEMES`
      （Auto/Light/Atom One Dark/GitHub Dark/Dracula/Solarized Dark，各带 EditorView.theme + HighlightStyle）；
      `themeId` prop（"auto" 跟随 App 明暗）；工具条新增主题下拉选择器；
      `db-ui-store.ts`:`editorThemeId` 信号；`db-panel-context.tsx` 加载/保存（镜像 editorPaneSplit）

## 明确不做（JDBC/JVM-only，无可用 Go 驱动；已在计划中记录）
DB2、Informix、SAP HANA、Teradata、Vertica、Firebird、Exasol、Access、IRIS、
Kylin、SunDB、XuguDB、Gbase 8a/8s、YashanDB、H2、Hive、BigQuery、Databricks、
Kafka/Pulsar/RocketMQ MQ-admin、etcd/ZooKeeper/Nacos。
（MariaDB 按要求去掉；Bigtable / Oracle / Dameng 已保留并实现。）

## 每个驱动的端到端验证清单
- [ ] Docker 起目标库（可行时）→ 建连接 → 连接/测试通过
- [ ] 浏览器树列出库/表 → 打开表 → 网格有数据
- [ ] 跑查询出结果 → 结构页加载 → explain（SQL 类）
- [ ] 无本地镜像的（Snowflake/Redshift/BigQuery）：适配器单测（URL/DSN/查询串）+ mock 传输
- [ ] `tsc -b` + `vite build` 通过；`cd server && go build ./... && go test ./internal/db/...` 通过
- [ ] 回归：已有 27 种仍能连接（尤其复用 mysql/postgres 别名的）
