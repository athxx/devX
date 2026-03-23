package handlers

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	ws "github.com/gofiber/contrib/v3/websocket"
	"github.com/gofiber/fiber/v3"

	dbrunner "devx/server/internal/db"
)

var (
	runningDBRequestsMu sync.Mutex
	runningDBRequests   = map[string]context.CancelFunc{}
)

func registerDBRequest(id string, cancel context.CancelFunc) {
	runningDBRequestsMu.Lock()
	runningDBRequests[id] = cancel
	runningDBRequestsMu.Unlock()
}

func finishDBRequest(id string) {
	runningDBRequestsMu.Lock()
	delete(runningDBRequests, id)
	runningDBRequestsMu.Unlock()
}

func cancelDBRequest(id string) bool {
	runningDBRequestsMu.Lock()
	cancel, ok := runningDBRequests[id]
	if ok {
		delete(runningDBRequests, id)
	}
	runningDBRequestsMu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

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
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.QuerySQL(ctx, request, deps.Config.DatabaseTimeout)
		cancel()
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
			log.Printf("[db-relay] invalid redis payload id=%s: %v", command.ID, err)
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid redis payload",
			})
		}
		log.Printf(
			"[db-relay] redis id=%s command=%s args=%v url=%s",
			command.ID,
			request.Command,
			request.Arguments,
			request.URL,
		)
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.RunRedisCommand(ctx, request, deps.Config.RedisTimeout)
		cancel()
		if err != nil {
			log.Printf("[db-relay] redis failed id=%s: %v", command.ID, err)
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		log.Printf("[db-relay] redis ok id=%s durationMs=%d", command.ID, result.DurationMs)
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
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.RunMongoQuery(ctx, request, deps.Config.MongoTimeout)
		cancel()
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
	case "mongoPing":
		var request dbrunner.MongoPingRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid mongo ping payload",
			})
		}
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.PingMongo(ctx, request, deps.Config.MongoTimeout)
		cancel()
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
	case "mongoListCollections":
		var request dbrunner.MongoListCollectionsRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid mongo list collections payload",
			})
		}
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.ListMongoCollections(ctx, request, deps.Config.MongoTimeout)
		cancel()
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
	case "mongoListDatabases":
		var request dbrunner.MongoListDatabasesRequest
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid mongo list databases payload",
			})
		}
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.ListMongoDatabases(ctx, request, deps.Config.MongoTimeout)
		cancel()
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
	case "mongoShell":
		var request struct {
			URL     string `json:"url"`
			Command string `json:"command"`
		}
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid mongo shell payload",
			})
		}
		parsed, err := parseMongoShellCommand(request.URL, request.Command)
		if err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		ctx, cancel := context.WithCancel(context.Background())
		registerDBRequest(command.ID, cancel)
		defer finishDBRequest(command.ID)
		result, err := dbrunner.RunMongoQuery(ctx, parsed, deps.Config.MongoTimeout)
		cancel()
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
	case "dbCancel":
		var request struct {
			RequestID string `json:"requestId"`
		}
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid cancel payload",
			})
		}
		cancelled := cancelDBRequest(request.RequestID)
		return conn.WriteJSON(fiber.Map{
			"id":   command.ID,
			"type": "sql",
			"data": fiber.Map{"ok": cancelled},
		})
	case "dbTransaction":
		var request struct {
			Action    string `json:"action"`
			SessionID string `json:"sessionId"`
			Driver    string `json:"driver"`
			DSN       string `json:"dsn"`
		}
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid transaction payload",
			})
		}

		var err error
		switch request.Action {
		case "begin":
			err = dbrunner.BeginSQLSession(context.Background(), request.SessionID, request.Driver, request.DSN)
		case "commit":
			err = dbrunner.FinishSQLSession(request.SessionID, true)
		case "rollback":
			err = dbrunner.FinishSQLSession(request.SessionID, false)
		default:
			err = fiber.NewError(fiber.StatusBadRequest, "unsupported transaction action")
		}
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
			"data": fiber.Map{"ok": true, "sessionId": request.SessionID, "action": request.Action},
		})
	case "dbDisconnect":
		var request struct {
			Kind   string `json:"kind"`
			Driver string `json:"driver"`
			DSN    string `json:"dsn"`
			URL    string `json:"url"`
			URI    string `json:"uri"`
		}
		if err := json.Unmarshal(command.Payload, &request); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": "invalid disconnect payload",
			})
		}
		if err := dbrunner.DisconnectConnection(
			request.Kind,
			request.Driver,
			request.DSN,
			request.URL,
			request.URI,
		); err != nil {
			return conn.WriteJSON(fiber.Map{
				"id":    command.ID,
				"type":  "error",
				"error": err.Error(),
			})
		}
		return conn.WriteJSON(fiber.Map{
			"id":   command.ID,
			"type": "sql",
			"data": fiber.Map{"ok": true},
		})
	default:
		return conn.WriteJSON(fiber.Map{
			"id":    command.ID,
			"type":  "error",
			"error": "unsupported db command type",
		})
	}
}
