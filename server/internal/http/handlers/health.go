package handlers

import "github.com/gofiber/fiber/v2"

func Health(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
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
		})
	}
}
