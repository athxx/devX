package runtime

import (
	"fmt"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"

	"devx/server/internal/app"
	"devx/server/internal/config"
)

type ServerManager struct {
	baseConfig config.Config

	mu        sync.RWMutex
	server    *fiber.App
	running   bool
	port      string
	lastError string
}

func NewServerManager(cfg config.Config) *ServerManager {
	return &ServerManager{
		baseConfig: cfg,
		port:       cfg.Port,
	}
}

func (m *ServerManager) Start(port string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if port == "" {
		port = m.baseConfig.Port
	}

	if m.running && m.port == port {
		return nil
	}

	if m.server != nil {
		if err := m.server.Shutdown(); err != nil {
			return err
		}
		m.server = nil
		m.running = false
	}

	cfg := m.baseConfig
	cfg.Port = port

	server, err := app.New(cfg)
	if err != nil {
		return err
	}

	m.server = server
	m.port = port
	m.running = true
	m.lastError = ""

	go m.listen(server, cfg.Address(), port)
	return nil
}

func (m *ServerManager) listen(server *fiber.App, address string, port string) {
	err := server.Listen(address)

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.server == server {
		m.server = nil
		m.running = false
	}

	if err != nil && !isExpectedShutdownError(err) {
		m.lastError = err.Error()
	}

	if port != "" {
		m.port = port
	}
}

func (m *ServerManager) Stop() error {
	m.mu.Lock()
	server := m.server
	m.server = nil
	m.running = false
	m.mu.Unlock()

	if server == nil {
		return nil
	}

	if err := server.Shutdown(); err != nil && !isExpectedShutdownError(err) {
		return err
	}
	return nil
}

func (m *ServerManager) SelectPort(port string) error {
	m.mu.Lock()
	m.port = port
	running := m.running
	m.mu.Unlock()

	if running {
		return m.Start(port)
	}
	return nil
}

func (m *ServerManager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return Status{
		Running:   m.running,
		Port:      m.port,
		LastError: m.lastError,
	}
}

type Status struct {
	Running   bool
	Port      string
	LastError string
}

func isExpectedShutdownError(err error) bool {
	if err == nil {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "server closed") || strings.Contains(message, "closed network connection")
}

func (m *ServerManager) LockedPortLabel() string {
	if !m.baseConfig.PortLocked {
		return ""
	}
	return fmt.Sprintf("Locked by DEVX_SERVER_PORT=%s", m.baseConfig.Port)
}
