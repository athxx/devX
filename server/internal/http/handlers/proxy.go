package handlers

import (
	"bytes"
	"io"
	"net/http"

	"github.com/gofiber/fiber/v2"
)

func ProxyRequest(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Method() == fiber.MethodOptions {
			return c.SendStatus(fiber.StatusNoContent)
		}

		if c.Get("x-ason-proxy") != "devx" {
			return fiber.NewError(fiber.StatusForbidden, "missing x-ason-proxy=devx")
		}

		targetURL := c.Get("x-ason-url")
		if targetURL == "" {
			return fiber.NewError(fiber.StatusBadRequest, "missing x-ason-url header")
		}

		client := &http.Client{
			Timeout: deps.Config.ProxyTimeout,
		}

		req, err := http.NewRequestWithContext(c.UserContext(), c.Method(), targetURL, bytes.NewReader(c.BodyRaw()))
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		copyForwardHeaders(c, req)

		resp, err := client.Do(req)
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, err.Error())
		}
		defer resp.Body.Close()

		responseBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, err.Error())
		}

		for key, values := range resp.Header {
			for _, value := range values {
				c.Append(key, value)
			}
		}

		return c.Status(resp.StatusCode).Send(responseBody)
	}
}

func copyForwardHeaders(c *fiber.Ctx, req *http.Request) {
	c.Request().Header.VisitAll(func(key, value []byte) {
		headerKey := string(key)
		switch http.CanonicalHeaderKey(headerKey) {
		case "Host", "Content-Length", "Connection", "Upgrade", "X-Ason-Proxy", "X-Ason-Url":
			return
		default:
			req.Header.Add(headerKey, string(value))
		}
	})
}
