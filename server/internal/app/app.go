package app

import (
	"errors"
	"fmt"
	"time"

	ws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/redis/go-redis/v9"

	"devx/server/internal/config"
	"devx/server/internal/http/handlers"
)

func New(cfg config.Config) (*fiber.App, error) {
	app := fiber.New(fiber.Config{
		AppName:      "DevX Server",
		ServerHeader: "DevX",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
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
		AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Requested-With",
		AllowMethods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	}))
	if cfg.EnableRequestLog {
		app.Use(logger.New())
	}

	var redisClient *redis.Client
	if cfg.RedisURL != "" {
		options, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("parse redis url: %w", err)
		}
		redisClient = redis.NewClient(options)
	}

	deps := handlers.Dependencies{
		Config:      cfg,
		RedisClient: redisClient,
	}

	app.Get("/health", handlers.Health(deps))

	api := app.Group("/api")
	api.Post("/proxy/request", handlers.ProxyRequest(deps))

	db := api.Group("/db")
	db.Post("/sql/query", handlers.SQLQuery(deps))
	db.Post("/redis/command", handlers.RedisCommand(deps))
	db.Post("/mongo/query", handlers.MongoQuery(deps))

	ssh := api.Group("/ssh")
	ssh.Use("/ws", func(c *fiber.Ctx) error {
		if ws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	ssh.Get("/ws", handlers.SSHRelay(deps))

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"service": "DevX Server",
			"version": 1,
		})
	})

	return app, nil
}
