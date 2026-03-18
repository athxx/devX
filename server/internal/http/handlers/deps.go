package handlers

import (
	"devx/server/internal/config"

	"github.com/redis/go-redis/v9"
)

type Dependencies struct {
	Config      config.Config
	RedisClient *redis.Client
}
