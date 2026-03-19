package app

import (
	"errors"
	"strings"
	"time"

	ws "github.com/gofiber/contrib/v3/websocket"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"

	"devx/server/internal/config"
	"devx/server/internal/http/handlers"
)

func New(cfg config.Config) (*fiber.App, error) {
	app := fiber.New(fiber.Config{
		AppName:      "DevX Server",
		ServerHeader: "DevX",
		ReadTimeout:  45 * time.Second,
		WriteTimeout: 45 * time.Second,
		ErrorHandler: func(c fiber.Ctx, err error) error {
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
		AllowOrigins: strings.Split(cfg.AllowOrigins, ","),
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With", "X-Ason-Proxy", "X-Ason-Url"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
	}))
	if cfg.EnableRequestLog {
		app.Use(logger.New())
	}

	deps := handlers.Dependencies{
		Config: cfg,
	}

	app.All("/api", handlers.ProxyRequest(deps))

	requireProxyWebSocket := func(c fiber.Ctx) error {
		proxyMarker := strings.TrimSpace(c.Get("x-ason-proxy"))
		if proxyMarker == "" {
			proxyMarker = strings.TrimSpace(c.Query("x-ason-proxy"))
		}
		if proxyMarker != "devx" {
			return fiber.NewError(fiber.StatusForbidden, "missing x-ason-proxy=devx")
		}
		if ws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	}

	app.Use("/db", requireProxyWebSocket)
	app.Get("/db", ws.New(handlers.DBRelay(deps)))

	app.Use("/ssh", requireProxyWebSocket)
	app.Get("/ssh", handlers.SSHRelay(deps))

	app.Get("/", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"service": "DevX Server",
			"version": 1,
			"routes": []string{
				"/api",
				"/db",
				"/ssh",
			},
			"server_time": time.Now().Format(time.RFC3339),
		})
	})

	return app, nil
}
