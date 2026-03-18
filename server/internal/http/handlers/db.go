package handlers

import (
	"github.com/gofiber/fiber/v2"

	dbrunner "devx/server/internal/db"
)

func SQLQuery(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var payload dbrunner.SQLQueryRequest
		if err := c.BodyParser(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid sql payload")
		}

		result, err := dbrunner.QuerySQL(c.UserContext(), payload, deps.Config.DatabaseTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}

func RedisCommand(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var payload dbrunner.RedisCommandRequest
		if err := c.BodyParser(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid redis payload")
		}

		result, err := dbrunner.RunRedisCommand(c.UserContext(), payload, deps.Config.RedisTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}

func MongoQuery(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var payload dbrunner.MongoQueryRequest
		if err := c.BodyParser(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid mongo payload")
		}

		result, err := dbrunner.RunMongoQuery(c.UserContext(), payload, deps.Config.MongoTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}
