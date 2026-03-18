package sshrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"golang.org/x/crypto/ssh"
)

type ConnectMessage struct {
	Type       string `json:"type"`
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

	clientConfig, err := newClientConfig(connectMessage)
	if err != nil {
		return err
	}

	port := connectMessage.Port
	if port == 0 {
		port = 22
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	dialer := &ssh.ClientConfig{
		User:            clientConfig.User,
		Auth:            clientConfig.Auth,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         timeout,
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", connectMessage.Host, port), dialer)
	if err != nil {
		return err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return err
	}

	cols := connectMessage.Cols
	rows := connectMessage.Rows
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}

	if err := session.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		return err
	}

	if err := session.Shell(); err != nil {
		return err
	}

	var writeMu sync.Mutex
	writeJSON := func(message EventMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(message)
	}

	_ = writeJSON(EventMessage{Type: "status", Data: "connected"})

	streamOutput := func(kind string, reader io.Reader) {
		buffer := make([]byte, 4096)
		for {
			count, err := reader.Read(buffer)
			if count > 0 {
				_ = writeJSON(EventMessage{Type: kind, Data: string(buffer[:count])})
			}
			if err != nil {
				if err != io.EOF {
					_ = writeJSON(EventMessage{Type: "error", Data: err.Error()})
				}
				return
			}
		}
	}

	go streamOutput("stdout", stdout)
	go streamOutput("stderr", stderr)

	go func() {
		<-ctx.Done()
		_ = session.Close()
	}()

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		var resize ResizeMessage
		if json.Unmarshal(payload, &resize) == nil && resize.Type == "resize" {
			_ = session.WindowChange(resize.Rows, resize.Cols)
			continue
		}

		if _, err := stdin.Write(payload); err != nil {
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
	if message.Host == "" || message.Username == "" {
		return ConnectMessage{}, fmt.Errorf("host and username are required")
	}
	return message, nil
}

func newClientConfig(message ConnectMessage) (*ssh.ClientConfig, error) {
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
		Timeout:         20 * time.Second,
	}, nil
}
