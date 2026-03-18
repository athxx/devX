# DevX Server

`server/` 是 DevX 的中转服务层，给网页端和 Chrome 插件提供三类能力：

- API 代理：转发 HTTP 请求，绕过浏览器端 CORS 限制
- DB 中转：代理 SQL / Redis / MongoDB 访问
- SSH 中转：通过 WebSocket 把浏览器终端桥接到 SSH 会话

## 技术栈

- Go
- Fiber
- GORM
- Redis
- MongoDB Driver
- `golang.org/x/crypto/ssh`

## 目录

```text
server/
  cmd/devox-cli/main.go
  cmd/devox-ui/main.go
  internal/
    app/
    config/
    db/
    http/handlers/
    ssh/
```

## 运行

```bash
cd server
mise exec go@1.26 -- go mod tidy
mise exec go@1.26 -- go run ./cmd/devox-cli
```

默认监听：

```text
127.0.0.1:8787
```

## 环境变量

```bash
DEVX_SERVER_HOST=127.0.0.1
DEVXPORT=8787,8788,8789
DEVX_SERVER_PORT=8787
DEVX_ALLOW_ORIGINS=*
DEVX_REDIS_URL=redis://localhost:6379/0
DEVX_PROXY_TIMEOUT=45s
DEVX_DATABASE_TIMEOUT=30s
DEVX_MONGO_TIMEOUT=30s
DEVX_REDIS_TIMEOUT=10s
DEVX_SSH_TIMEOUT=20s
DEVX_ENABLE_REQUEST_LOG=true
```

端口规则：

- 默认菜单端口：`8787,8788,8789`
- 可通过 `DEVXPORT=8787,8788,8789` 覆盖，最多 3 个，最少 1 个
- 如果设置了 `DEVX_SERVER_PORT`，它的优先级更高，会锁定当前实际监听端口

## Tray UI

```bash
cd server
mise exec go@1.26 -- go run ./cmd/devox-ui
```

功能：

- tray 图标显示 DEVX 状态
- 右键菜单可启动/停止服务
- 可在 `8787 / 8788 / 8789` 或 `DEVXPORT` 提供的端口中切换
- 如果 `DEVX_SERVER_PORT` 已设置，tray 会显示端口被环境变量锁定

Linux 依赖：

```bash
sudo apt install libayatana-appindicator3-dev
```

如果没有这类系统库，`devox-ui` 会在编译 `systray` 时失败，但 `devox-cli` 不受影响。

## 路由

### Health

- `GET /health`

### HTTP Proxy

- `POST /api/proxy/request`

示例：

```json
{
  "method": "POST",
  "url": "https://httpbin.org/post",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"hello\":\"world\"}",
  "followRedirects": true
}
```

### SQL

- `POST /api/db/sql/query`

支持：

- `mysql`
- `postgres`

示例：

```json
{
  "driver": "postgres",
  "dsn": "postgres://user:pass@localhost:5432/app?sslmode=disable",
  "query": "select now() as current_time"
}
```

### Redis

- `POST /api/db/redis/command`

示例：

```json
{
  "url": "redis://localhost:6379/0",
  "command": "GET",
  "arguments": ["my-key"]
}
```

### MongoDB

- `POST /api/db/mongo/query`

支持：

- `findOne`
- `findMany`
- `aggregate`
- `insertOne`
- `insertMany`
- `updateOne`
- `updateMany`
- `deleteOne`
- `deleteMany`

示例：

```json
{
  "uri": "mongodb://localhost:27017",
  "database": "devx",
  "collection": "users",
  "action": "findMany",
  "filter": {
    "active": true
  },
  "limit": 20
}
```

### SSH

- `GET /api/ssh/ws`

WebSocket 第一条消息必须是：

```json
{
  "type": "connect",
  "host": "127.0.0.1",
  "port": 22,
  "username": "root",
  "password": "secret",
  "cols": 120,
  "rows": 32
}
```

后续：

- 文本/二进制消息：直接写入 SSH stdin
- resize：

```json
{
  "type": "resize",
  "cols": 160,
  "rows": 42
}
```

## 当前边界

- 这是基础服务骨架，重点是把三类中转能力落地
- SQL 当前按一条语句执行，没有做事务会话管理
- SSH 当前是一条 WebSocket 对应一个 shell session
- 后续可以继续加：
  - 连接配置持久化
  - 用户鉴权
  - 审计日志
  - 数据源连接池
  - 查询结果分页
