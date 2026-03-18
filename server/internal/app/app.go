package app

import (
	"errors"
	"time"

	ws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"devx/server/internal/config"
	"devx/server/internal/http/handlers"
)

func New(cfg config.Config) (*fiber.App, error) {
	app := fiber.New(fiber.Config{
		AppName:      "DevX Server",
		ServerHeader: "DevX",
		ReadTimeout:  45 * time.Second,
		WriteTimeout: 45 * time.Second,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			var fiberErr *fiber.Error
			if errors.As(err, &fiberErr) {
				return c.Status(fiberErr.Code).JSON(fiber.Map{
					"ok":    false,
					"error": fiberErr.Message,
				})
			}

			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"ok":    false,
				"error": err.Error(),
			})
		},
	})

	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: cfg.AllowOrigins,
		AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Requested-With, X-Ason-Proxy, X-Ason-Url",
		AllowMethods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	}))
	if cfg.EnableRequestLog {
		app.Use(logger.New())
	}

	deps := handlers.Dependencies{
		Config: cfg,
	}

	app.All("/api", handlers.ProxyRequest(deps))

	app.Use("/ws", func(c *fiber.Ctx) error {
		if c.Get("x-ason-proxy") != "devx" {
			return fiber.NewError(fiber.StatusForbidden, "missing x-ason-proxy=devx")
		}
		if ws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws", ws.New(handlers.UnifiedWebSocket(deps)))

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"service": "DevX Server",
			"version": 1,
			"routes": []string{
				"/api",
				"/ws",
			},
			"server_time": time.Now().Format(time.RFC3339),
		})
	})

	return app, nil
}
