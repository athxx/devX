package handlers

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

type ProxyRequestPayload struct {
	Method          string              `json:"method"`
	URL             string              `json:"url"`
	Headers         map[string]string   `json:"headers"`
	Body            string              `json:"body"`
	BodyBase64      bool                `json:"bodyBase64"`
	TimeoutMs       int                 `json:"timeoutMs"`
	FollowRedirects bool                `json:"followRedirects"`
	Query           map[string][]string `json:"query"`
}

func ProxyRequest(deps Dependencies) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var payload ProxyRequestPayload
		if err := c.BodyParser(&payload); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid proxy payload")
		}

		if payload.URL == "" {
			return fiber.NewError(fiber.StatusBadRequest, "url is required")
		}

		method := strings.ToUpper(strings.TrimSpace(payload.Method))
		if method == "" {
			method = http.MethodGet
		}

		bodyBytes := []byte(payload.Body)
		if payload.BodyBase64 && payload.Body != "" {
			decoded, err := base64.StdEncoding.DecodeString(payload.Body)
			if err != nil {
				return fiber.NewError(fiber.StatusBadRequest, "bodyBase64 must be valid base64")
			}
			bodyBytes = decoded
		}

		timeout := deps.Config.ProxyTimeout
		if payload.TimeoutMs > 0 {
			timeout = time.Duration(payload.TimeoutMs) * time.Millisecond
		}

		client := &http.Client{
			Timeout: timeout,
		}
		if !payload.FollowRedirects {
			client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			}
		}

		req, err := http.NewRequestWithContext(c.UserContext(), method, payload.URL, bytes.NewReader(bodyBytes))
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}

		query := req.URL.Query()
		for key, values := range payload.Query {
			for _, value := range values {
				query.Add(key, value)
			}
		}
		if len(payload.Query) > 0 {
			req.URL.RawQuery = query.Encode()
		}

		for key, value := range payload.Headers {
			req.Header.Set(key, value)
		}

		resp, err := client.Do(req)
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, err.Error())
		}
		defer resp.Body.Close()

		responseBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, err.Error())
		}

		responseHeaders := make(map[string][]string, len(resp.Header))
		for key, values := range resp.Header {
			responseHeaders[key] = values
		}

		return c.JSON(fiber.Map{
			"ok":         true,
			"status":     resp.StatusCode,
			"statusText": resp.Status,
			"headers":    responseHeaders,
			"body":       string(responseBody),
			"bodyBase64": base64.StdEncoding.EncodeToString(responseBody),
			"finalURL":   resp.Request.URL.String(),
		})
	}
}
