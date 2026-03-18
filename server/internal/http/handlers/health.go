package handlers

import (
	"context"

	"github.com/gofiber/fiber/v2"
)

func Health(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		redisStatus := "disabled"
		if deps.RedisClient != nil {
			redisStatus = "ok"
			if err := deps.RedisClient.Ping(context.Background()).Err(); err != nil {
				redisStatus = err.Error()
			}
		}

		return c.JSON(fiber.Map{
			"ok": true,
			"service": fiber.Map{
				"name": "DevX Server",
			},
			"features": []string{
				"http-proxy",
				"db-proxy",
				"ssh-relay",
			},
			"redis": redisStatus,
		})
	}
}
