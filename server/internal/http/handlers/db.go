package handlers

import (
	"context"
	"encoding/json"

	ws "github.com/gofiber/contrib/v3/websocket"
	"github.com/gofiber/fiber/v3"

	dbrunner "devx/server/internal/db"
)

func SQLQuery(deps Dependencies) fiber.Handler {
	return func(c fiber.Ctx) error {
		var payload dbrunner.SQLQueryRequest
		if err := c.Bind().Body(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid sql payload")
		}

		result, err := dbrunner.QuerySQL(c.Context(), payload, deps.Config.DatabaseTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}

func RedisCommand(deps Dependencies) fiber.Handler {
	return func(c fiber.Ctx) error {
		var payload dbrunner.RedisCommandRequest
		if err := c.Bind().Body(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid redis payload")
		}

		result, err := dbrunner.RunRedisCommand(c.Context(), payload, deps.Config.RedisTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}

func MongoQuery(deps Dependencies) fiber.Handler {
	return func(c fiber.Ctx) error {
		var payload dbrunner.MongoQueryRequest
		if err := c.Bind().Body(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid mongo payload")
		}

		result, err := dbrunner.RunMongoQuery(c.Context(), payload, deps.Config.MongoTimeout)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		return c.JSON(fiber.Map{"ok": true, "data": result})
	}
}

type DBCommandMessage struct {
	ID      string          `json:"id"`
	Channel string          `json:"channel,omitempty"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func DBRelay(deps Dependencies) func(*ws.Conn) {
	return func(conn *ws.Conn) {
		_ = HandleDBRelay(conn, deps, nil)
	}
}

func HandleDBRelay(conn *ws.Conn, deps Dependencies, firstPayload []byte) error {
	if len(firstPayload) > 0 {
		if err := processDBCommand(conn, deps, firstPayload); err != nil {
			return err
		}
	}

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if err := processDBCommand(conn, deps, payload); err != nil {
			return err
		}
	}
}

func processDBCommand(conn *ws.Conn, deps Dependencies, payload []byte) error {
	var command DBCommandMessage
	if err := json.Unmarshal(payload, &command); err != nil {
		return conn.WriteJSON(fiber.Map{
			"type":  "error",
			"error": "invalid db websocket payload",
		})
	}

	switch command.Type {
	case "sql":
		var request dbrunner.SQLQueryRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid sql payload",
			})
		}
		result, err := dbrunner.QuerySQL(context.Background(), request, deps.Config.DatabaseTimeout)
		if err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		return conn.WriteJSON(fiber.Map{
			"id":   command.ID,
			"type": "sql",
			"data": result,
		})
	case "redis":
		var request dbrunner.RedisCommandRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid redis payload",
			})
		}
		result, err := dbrunner.RunRedisCommand(context.Background(), request, deps.Config.RedisTimeout)
		if err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		return conn.WriteJSON(fiber.Map{
			"id":   command.ID,
			"type": "redis",
			"data": result,
		})
	case "mongo":
		var request dbrunner.MongoQueryRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid mongo payload",
			})
		}
		result, err := dbrunner.RunMongoQuery(context.Background(), request, deps.Config.MongoTimeout)
		if err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		return conn.WriteJSON(fiber.Map{
			"id":   command.ID,
			"type": "mongo",
			"data": result,
		})
	default:
		return conn.WriteJSON(fiber.Map{
			"id":    command.ID,
			"type":  "error",
			"error": "unsupported db command type",
		})
	}
}
