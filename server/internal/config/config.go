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
	RedisURL         string
	AllowOrigins     string
	EnableRequestLog bool
}

func Load() Config {
	portOptions := getEnvPorts("DEVXPORT", []string{"8787", "8788", "8789"})
	port, portLocked := getActivePort(portOptions)

	return Config{
		Host:             getEnv("DEVX_SERVER_HOST", "127.0.0.1"),
		Port:             port,
		PortOptions:      portOptions,
		PortLocked:       portLocked,
		ProxyTimeout:     getEnvDuration("DEVX_PROXY_TIMEOUT", 45*time.Second),
		DatabaseTimeout:  getEnvDuration("DEVX_DATABASE_TIMEOUT", 30*time.Second),
		MongoTimeout:     getEnvDuration("DEVX_MONGO_TIMEOUT", 30*time.Second),
		RedisTimeout:     getEnvDuration("DEVX_REDIS_TIMEOUT", 10*time.Second),
		SSHTimeout:       getEnvDuration("DEVX_SSH_TIMEOUT", 20*time.Second),
		RedisURL:         getEnv("DEVX_REDIS_URL", ""),
		AllowOrigins:     getEnv("DEVX_ALLOW_ORIGINS", "*"),
		EnableRequestLog: getEnvBool("DEVX_ENABLE_REQUEST_LOG", true),
	}
}

func (c Config) Address() string {
	return c.Host + ":" + c.Port
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvPorts(key string, fallback []string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return append([]string(nil), fallback...)
	}

	parts := strings.Split(value, ",")
	ports := make([]string, 0, 3)
	seen := make(map[string]struct{}, 3)

	for _, part := range parts {
		port := strings.TrimSpace(part)
		if !isValidPort(port) {
			continue
		}
		if _, exists := seen[port]; exists {
			continue
		}
		seen[port] = struct{}{}
		ports = append(ports, port)
		if len(ports) == 3 {
			break
		}
	}

	if len(ports) == 0 {
		return append([]string(nil), fallback...)
	}

	return ports
}

func getActivePort(options []string) (string, bool) {
	if value := strings.TrimSpace(os.Getenv("DEVX_SERVER_PORT")); isValidPort(value) {
		if containsPort(options, value) {
			return value, true
		}
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

func containsPort(options []string, value string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}
