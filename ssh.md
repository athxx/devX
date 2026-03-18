## 架构设计

```
浏览器 xterm.js
    ↕ WebSocket
Go 中转服务
    ├── 连本机  → os/exec + pty
    └── 连远程  → golang.org/x/crypto/ssh (SSH 协议)
```

关键点：Go 中转层做协议转换——对浏览器侧是 WebSocket，对目标机器侧是 PTY 或 SSH，中间做数据透传。

核心代码
依赖：

```
github.com/gofiber/contrib/v3/websocket
# github.com/lxzan/gws   # WebSocket
github.com/creack/pty          # 本机 PTY
golang.org/x/crypto/ssh        # 远程 SSH
```

连本机（PTY）：

```go
func handleLocal(ws *websocket.Conn) {
    cmd := exec.Command("/bin/bash") // 这里如果用macOS可能还能选择是否用zsh
    ptmx, _ := pty.Start(cmd)
    defer ptmx.Close()

    // PTY → WebSocket
    go func() {
        buf := make([]byte, 1024)
        for {
            n, err := ptmx.Read(buf)
            if err != nil { return }
            ws.WriteMessage(websocket.BinaryMessage, buf[:n])
        }
    }()

    // WebSocket → PTY
    for {
        _, msg, err := ws.ReadMessage()
        if err != nil { return }
        ptmx.Write(msg)
    }
}
```

## 连远程（SSH）：

```go
func handleRemote(ws *websocket.Conn, host, user, password string) {
    cfg := &ssh.ClientConfig{
        User: user,
        Auth: []ssh.AuthMethod{ssh.Password(password)},
        HostKeyCallback: ssh.InsecureIgnoreHostKey(), // 生产环境要验证
    }
    client, _ := ssh.Dial("tcp", host+":22", cfg)
    defer client.Close()

    session, _ := client.NewSession()
    defer session.Close()

    // 申请伪终端
    modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400}
    session.RequestPty("xterm-256color", 24, 80, modes)

    // 接管 stdin/stdout
    stdin, _  := session.StdinPipe()
    stdout, _ := session.StdoutPipe()
    session.Shell()

    // stdout → WebSocket
    go func() {
        buf := make([]byte, 1024)
        for {
            n, err := stdout.Read(buf)
            if err != nil { return }
            ws.WriteMessage(websocket.BinaryMessage, buf[:n])
        }
    }()

    // WebSocket → stdin
    for {
        _, msg, err := ws.ReadMessage()
        if err != nil { return }
        stdin.Write(msg)
    }
}
```

路由区分本机/远程：

```go
http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
    ws, _ := upgrader.Upgrade(w, r, nil)
    target := r.URL.Query().Get("target") // ?target=local 或 ?target=192.168.1.100

    if target == "local" || target == "" {
        handleLocal(ws)
    } else {
        user := r.URL.Query().Get("user")
        pass := r.URL.Query().Get("pass") // 实际应从 session/token 里取
        handleRemote(ws, target, user, pass)
    }
})
```

需要处理的细节
终端 resize： xterm.js 窗口大小变化时要同步给后端，一般用 JSON 控制帧：需要处理的细节

```go
// 前端发: {"type":"resize","cols":120,"rows":30}
// 后端收到后:
ptmx.Setsize(cols, rows)           // 本机
session.WindowChange(rows, cols)   // SSH
```

所以 WebSocket 消息要区分两种：纯二进制是终端数据，JSON 是控制消息。
认证： SSH 密码不要放 URL 参数，应该：

前端登录后拿到 token
Go 服务验证 token，从服务端配置/数据库取 SSH 凭据
支持密钥认证比密码更安全：ssh.PublicKeys(signer)
