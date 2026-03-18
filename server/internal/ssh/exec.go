package sshrelay

import (
	"bytes"
	"fmt"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type ExecResult struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr,omitempty"`
}

func ExecURLCommand(rawURL string, command string, timeout time.Duration) (ExecResult, error) {
	if strings.TrimSpace(rawURL) == "" {
		return ExecResult{}, fmt.Errorf("url is required")
	}
	if strings.TrimSpace(command) == "" {
		return ExecResult{}, fmt.Errorf("cmd is required")
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ExecResult{}, fmt.Errorf("parse ssh url: %w", err)
	}
	if parsed.Scheme != "" && parsed.Scheme != "ssh" {
		return ExecResult{}, fmt.Errorf("unsupported ssh scheme: %s", parsed.Scheme)
	}
	if parsed.User == nil || parsed.User.Username() == "" {
		return ExecResult{}, fmt.Errorf("ssh username is required")
	}

	host := parsed.Hostname()
	if host == "" {
		return ExecResult{}, fmt.Errorf("ssh host is required")
	}

	port := parsed.Port()
	if port == "" {
		port = "22"
	}

	password, _ := parsed.User.Password()
	if password == "" {
		return ExecResult{}, fmt.Errorf("ssh password is required in url")
	}

	clientConfig := &ssh.ClientConfig{
		User:            parsed.User.Username(),
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         timeout,
	}

	client, err := ssh.Dial("tcp", host+":"+port, clientConfig)
	if err != nil {
		return ExecResult{}, err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return ExecResult{}, err
	}
	defer session.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(command); err != nil {
		if stderr.Len() > 0 {
			return ExecResult{}, fmt.Errorf("%s", strings.TrimSpace(stderr.String()))
		}
		return ExecResult{}, err
	}

	return ExecResult{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}, nil
}
