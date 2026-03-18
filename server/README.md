# DevX Server

`server/` 是 DevX 的执行层，网页端和 Chrome 插件把所有数据都传给它，它负责执行和转发：

- API 代理：转发 HTTP 请求，绕过浏览器端 CORS 限制
- 统一 WebSocket 总线：承载普通 WebSocket 代理、DB 执行和 SSH relay

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
go mod tidy
go run ./cmd/devox-cli
```

默认监听：

```text
0.0.0.0:8787
```

## 环境变量

```bash
DEVX_PORT=8787
```

端口规则：

- 默认菜单端口：`8787,8788,8789`
- 如果设置了 `DEVX_PORT`，它会锁定当前实际监听端口
- 未设置时，tray 可在 `8787 / 8788 / 8789` 中切换

默认行为：

- 监听地址固定为 `0.0.0.0`
- HTTP / SQL / Redis / Mongo 默认超时都是 `45s`
- SSH WebSocket 默认超时是 `120s`
- Redis 不读服务端配置，由前端请求体直接传入连接信息

## Tray UI

```bash
cd server
go run ./cmd/devox-ui
```

功能：

- tray 图标显示 DEVX 状态
- 右键菜单可启动/停止服务
- 可在 `8787 / 8788 / 8789` 中切换
- 如果 `DEVX_PORT` 已设置，tray 会显示端口被环境变量锁定

Linux 依赖：

```bash
sudo apt install libayatana-appindicator3-dev
```

如果没有这类系统库，`devox-ui` 会在编译 `systray` 时失败，但 `devox-cli` 不受影响。

## 路由

### HTTP Proxy

- `POST /api`
- `GET /api`
- `PUT /api`
- `PATCH /api`
- `DELETE /api`

必须带：

- `x-ason-proxy: devx`
- `x-ason-url: <真实目标地址>`

服务端行为：

- 不解析请求体
- 不解析业务字段
- 直接使用当前请求的 `method + body + headers` 转发到 `x-ason-url`
- 收到上游响应后，按原始 `status + headers + body` 直接回给前端

示例：

```http
POST /api HTTP/1.1
Host: 127.0.0.1:8787
X-Ason-Proxy: devx
X-Ason-Url: https://httpbin.org/post
Content-Type: application/json

{"hello":"world"}
```

### Unified WebSocket

- `GET /ws`

必须带：

- `x-ason-proxy: devx`

如果同时带：

- `x-ason-url: <真实 websocket 地址>`

那 `/ws` 会直接做纯 WebSocket 透明转发，不读取任何前置命令消息。

#### 普通 WebSocket 代理

握手头示例：

```http
GET /ws HTTP/1.1
Host: 127.0.0.1:8787
Upgrade: websocket
Connection: Upgrade
X-Ason-Proxy: devx
X-Ason-Url: wss://echo.websocket.events
```

后续消息会原样在前端和上游 WebSocket 之间双向转发。

#### 内部命令通道

如果没有 `x-ason-url`，`/ws` 会进入内部命令通道。

连接建立后：

- 服务端每 `30s` 发送一次 ping
- 如果超过 `120s` 没有心跳/消息，会自动断开

前端发送的数据结构：

```json
{
  "redis": [
    {
      "url": "redis://127.0.0.1:6379",
      "id": 0,
      "cmd": "GET my-key"
    }
  ],
  "postgres": [
    {
      "url": "postgresql://postgres:password@localhost:5432/devx",
      "id": 1,
      "cmd": "SELECT * FROM users WHERE id = 1"
    }
  ],
  "mongodb": [
    {
      "url": "mongodb://localhost:27017",
      "id": 2,
      "cmd": "db.users.find({ _id: ObjectId('60c72b2f9b1d4c3d8f0e4b5') })"
    }
  ],
  "mysql": [
    {
      "url": "mysql://root:password@localhost:3306/devx",
      "id": 3,
      "cmd": "SELECT * FROM users WHERE id = 1"
    }
  ],
  "ssh": [
    {
      "url": "ssh://user:password@localhost:22",
      "id": 4,
      "cmd": "ls -la"
    }
  ]
}
```

返回结果会按同样的顶层 key 分组，例如：

```json
{
  "redis": [
    {
      "id": 0,
      "ok": true,
      "data": {
        "result": "value",
        "durationMs": 3
      }
    }
  ]
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
