package handlers

import (
	ws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"

	sshrelay "devx/server/internal/ssh"
)

func SSHRelay(deps Dependencies) fiber.Handler {
	return ws.New(func(conn *ws.Conn) {
		if err := sshrelay.Handle(conn, deps.Config.SSHTimeout); err != nil {
			_ = conn.WriteJSON(fiber.Map{
				"type":  "error",
				"error": err.Error(),
			})
		}
	})
}
