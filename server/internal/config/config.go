package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Host             string
	Port             string
	PortOptions      []string
	PortLocked       bool
	ProxyTimeout     time.Duration
	DatabaseTimeout  time.Duration
	MongoTimeout     time.Duration
	RedisTimeout     time.Duration
	SSHTimeout       time.Duration
	AllowOrigins     string
	EnableRequestLog bool
}

func Load() Config {
	portOptions := []string{"8787", "8788", "8789"}
	port, portLocked := getActivePort(portOptions)

	return Config{
		Host:             "0.0.0.0",
		Port:             port,
		PortOptions:      portOptions,
		PortLocked:       portLocked,
		ProxyTimeout:     45 * time.Second,
		DatabaseTimeout:  45 * time.Second,
		MongoTimeout:     45 * time.Second,
		RedisTimeout:     45 * time.Second,
		SSHTimeout:       120 * time.Second,
		AllowOrigins:     "*",
		EnableRequestLog: true,
	}
}

func (c Config) Address() string {
	return c.Host + ":" + c.Port
}

func getActivePort(options []string) (string, bool) {
	if value := strings.TrimSpace(os.Getenv("DEVX_PORT")); isValidPort(value) {
		return value, true
	}

	if len(options) == 0 {
		return "8787", false
	}

	return options[0], false
}

func isValidPort(value string) bool {
	if value == "" {
		return false
	}
	port, err := strconv.Atoi(value)
	return err == nil && port >= 1 && port <= 65535
}
