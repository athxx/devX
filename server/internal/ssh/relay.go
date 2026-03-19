package sshrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gofiber/contrib/v3/websocket"
	"golang.org/x/crypto/ssh"
)

type ConnectMessage struct {
	Type       string `json:"type"`
	Target     string `json:"target"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

type ResizeMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

type EventMessage struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"`
}

const sshHeartbeatTimeout = 120 * time.Second
const sshPingPeriod = 30 * time.Second

func Handle(conn *websocket.Conn, timeout time.Duration) error {
	_, payload, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	return HandleWithPayload(conn, payload, timeout)
}

func HandleWithPayload(conn *websocket.Conn, payload []byte, timeout time.Duration) error {
	connectMessage, err := parseConnectMessage(payload)
	if err != nil {
		return err
	}

	switch connectMessage.Target {
	case "local":
		return handleLocal(conn, connectMessage)
	default:
		return handleRemote(conn, connectMessage, timeout)
	}
}

func handleLocal(conn *websocket.Conn, message ConnectMessage) error {
	cols, rows := normalizeTerminalSize(message.Cols, message.Rows)
	shell, args := resolveLocalShell()

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, shell, args...)
	cmd.Env = os.Environ()

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
	if err != nil {
		cancel()
		return fmt.Errorf("start local shell: %w", err)
	}

	closeFn := func() error {
		cancel()
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return nil
	}

	waitFn := func() error {
		return cmd.Wait()
	}

	resizeFn := func(rows, cols int) error {
		return pty.Setsize(ptmx, &pty.Winsize{
			Cols: uint16(cols),
			Rows: uint16(rows),
		})
	}

	return runTerminalRelay(conn, ptmx, resizeFn, closeFn, waitFn, ptmx)
}

func handleRemote(conn *websocket.Conn, message ConnectMessage, timeout time.Duration) error {
	clientConfig, err := newClientConfig(message, timeout)
	if err != nil {
		return err
	}

	port := message.Port
	if port == 0 {
		port = 22
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", message.Host, port), clientConfig)
	if err != nil {
		return err
	}

	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return err
	}

	cols, rows := normalizeTerminalSize(message.Cols, message.Rows)
	if err := session.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		_ = session.Close()
		_ = client.Close()
		return err
	}

	if err := session.Shell(); err != nil {
		_ = session.Close()
		_ = client.Close()
		return err
	}

	closeFn := func() error {
		_ = session.Close()
		return client.Close()
	}

	waitFn := func() error {
		return session.Wait()
	}

	resizeFn := func(rows, cols int) error {
		return session.WindowChange(rows, cols)
	}

	return runTerminalRelay(conn, stdin, resizeFn, closeFn, waitFn, stdout, stderr)
}

func runTerminalRelay(
	conn *websocket.Conn,
	stdin io.Writer,
	resizeFn func(rows, cols int) error,
	closeFn func() error,
	waitFn func() error,
	readers ...io.Reader,
) error {
	var writeMu sync.Mutex
	var closeOnce sync.Once
	var eventOnce sync.Once

	writeJSON := func(message EventMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(message)
	}
	writeControl := func(messageType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteControl(messageType, data, time.Now().Add(5*time.Second))
	}
	writeBinary := func(data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.BinaryMessage, data)
	}
	notifyClosed := func(reason string) {
		eventOnce.Do(func() {
			_ = writeJSON(EventMessage{Type: "closed", Data: reason})
		})
	}
	closeSession := func() {
		closeOnce.Do(func() {
			_ = closeFn()
		})
	}

	_ = conn.SetReadDeadline(time.Now().Add(sshHeartbeatTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(sshHeartbeatTimeout))
	})
	conn.SetPingHandler(func(appData string) error {
		if err := conn.SetReadDeadline(time.Now().Add(sshHeartbeatTimeout)); err != nil {
			return err
		}
		return writeControl(websocket.PongMessage, []byte(appData))
	})

	ticker := time.NewTicker(sshPingPeriod)
	defer ticker.Stop()

	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-ticker.C:
				if err := writeControl(websocket.PingMessage, []byte("devx-ssh")); err != nil {
					_ = conn.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()

	streamOutput := func(reader io.Reader) {
		buffer := make([]byte, 4096)
		for {
			count, err := reader.Read(buffer)
			if count > 0 {
				chunk := append([]byte(nil), buffer[:count]...)
				_ = writeBinary(chunk)
			}
			if err != nil {
				if err != io.EOF {
					_ = writeJSON(EventMessage{Type: "error", Data: err.Error()})
				}
				return
			}
		}
	}

	for _, reader := range readers {
		go streamOutput(reader)
	}

	go func() {
		err := waitFn()
		if err != nil && !strings.Contains(err.Error(), "closed") && !strings.Contains(err.Error(), "killed") {
			_ = writeJSON(EventMessage{Type: "error", Data: err.Error()})
		}
		notifyClosed("session ended")
		closeSession()
		_ = conn.Close()
	}()

	_ = writeJSON(EventMessage{Type: "status", Data: "connected"})

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			notifyClosed("client disconnected")
			closeSession()
			return nil
		}

		if err := conn.SetReadDeadline(time.Now().Add(sshHeartbeatTimeout)); err != nil {
			closeSession()
			return err
		}

		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		var resize ResizeMessage
		if json.Unmarshal(payload, &resize) == nil && resize.Type == "resize" {
			if err := resizeFn(resize.Rows, resize.Cols); err != nil {
				_ = writeJSON(EventMessage{Type: "error", Data: err.Error()})
			}
			continue
		}

		if _, err := stdin.Write(payload); err != nil {
			closeSession()
			return err
		}
	}
}

func parseConnectMessage(payload []byte) (ConnectMessage, error) {
	var message ConnectMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return ConnectMessage{}, fmt.Errorf("expected initial json config message")
	}
	if message.Type != "connect" {
		return ConnectMessage{}, fmt.Errorf("first websocket message must be type=connect")
	}
	if message.Target == "" {
		message.Target = "remote"
	}
	if message.Target == "local" {
		return message, nil
	}
	if message.Host == "" || message.Username == "" {
		return ConnectMessage{}, fmt.Errorf("host and username are required")
	}
	return message, nil
}

func newClientConfig(message ConnectMessage, timeout time.Duration) (*ssh.ClientConfig, error) {
	authMethods := make([]ssh.AuthMethod, 0, 2)
	if message.Password != "" {
		authMethods = append(authMethods, ssh.Password(message.Password))
	}
	if message.PrivateKey != "" {
		var signer ssh.Signer
		var err error
		if message.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(message.PrivateKey), []byte(message.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(message.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	if len(authMethods) == 0 {
		return nil, fmt.Errorf("password or private key is required")
	}

	return &ssh.ClientConfig{
		User:            message.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         timeout,
	}, nil
}

func normalizeTerminalSize(cols, rows int) (int, int) {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}
	return cols, rows
}

func resolveLocalShell() (string, []string) {
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" {
		comSpec := strings.TrimSpace(os.Getenv("COMSPEC"))
		if comSpec != "" {
			shell = comSpec
		}
	}
	if shell == "" {
		shell = "/bin/bash"
	}

	name := strings.ToLower(filepath.Base(shell))
	switch {
	case strings.Contains(name, "bash"), strings.Contains(name, "zsh"), strings.Contains(name, "fish"), strings.Contains(name, "sh"):
		return shell, []string{"-l"}
	case strings.Contains(name, "powershell"):
		return shell, []string{"-NoLogo"}
	default:
		return shell, nil
	}
}
