package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	fws "github.com/fasthttp/websocket"
	ws "github.com/gofiber/contrib/v3/websocket"
	"go.mongodb.org/mongo-driver/bson"

	dbrunner "devx/server/internal/db"
	sshrelay "devx/server/internal/ssh"
)

const wsHeartbeatTimeout = 120 * time.Second
const wsPingPeriod = 30 * time.Second

type WSEventMessage struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"`
}

type InternalBatchMessage struct {
	Redis    []InternalCommand `json:"redis"`
	Postgres []InternalCommand `json:"postgres"`
	MongoDB  []InternalCommand `json:"mongodb"`
	MySQL    []InternalCommand `json:"mysql"`
	SSH      []InternalCommand `json:"ssh"`
}

type InternalCommand struct {
	URL string `json:"url"`
	ID  any    `json:"id"`
	Cmd string `json:"cmd"`
}

type InternalCommandResult struct {
	ID    any    `json:"id"`
	OK    bool   `json:"ok"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

type InternalBatchResult struct {
	Redis    []InternalCommandResult `json:"redis,omitempty"`
	Postgres []InternalCommandResult `json:"postgres,omitempty"`
	MongoDB  []InternalCommandResult `json:"mongodb,omitempty"`
	MySQL    []InternalCommandResult `json:"mysql,omitempty"`
	SSH      []InternalCommandResult `json:"ssh,omitempty"`
}

type WSConnectMessage struct {
	Type         string            `json:"type"`
	URL          string            `json:"url"`
	Headers      map[string]string `json:"headers"`
	Subprotocols []string          `json:"subprotocols"`
	TimeoutMs    int               `json:"timeoutMs"`
}

func UnifiedWebSocket(deps Dependencies) func(*ws.Conn) {
	return func(conn *ws.Conn) {
		if err := routeUnifiedWebSocket(conn, deps); err != nil {
			_ = conn.WriteJSON(WSEventMessage{
				Type: "error",
				Data: err.Error(),
			})
		}
	}
}

func routeUnifiedWebSocket(conn *ws.Conn, deps Dependencies) error {
	if targetURL := conn.Headers("x-ason-url"); targetURL != "" {
		return handleWebSocketProxyWithHeaders(conn, targetURL, deps.Config.ProxyTimeout)
	}
	return handleInternalSocket(conn, deps)
}

func handleInternalSocket(conn *ws.Conn, deps Dependencies) error {
	var writeMu sync.Mutex
	writeJSON := func(value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(value)
	}
	writeControl := func(messageType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteControl(messageType, data, time.Now().Add(5*time.Second))
	}

	_ = conn.SetReadDeadline(time.Now().Add(wsHeartbeatTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsHeartbeatTimeout))
	})
	conn.SetPingHandler(func(appData string) error {
		if err := conn.SetReadDeadline(time.Now().Add(wsHeartbeatTimeout)); err != nil {
			return err
		}
		return writeControl(ws.PongMessage, []byte(appData))
	})

	ticker := time.NewTicker(wsPingPeriod)
	defer ticker.Stop()

	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-ticker.C:
				if err := writeControl(ws.PingMessage, []byte("devx")); err != nil {
					_ = conn.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()

	_ = writeJSON(WSEventMessage{
		Type: "status",
		Data: "connected",
	})

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		if err := conn.SetReadDeadline(time.Now().Add(wsHeartbeatTimeout)); err != nil {
			return err
		}

		if messageType != ws.TextMessage && messageType != ws.BinaryMessage {
			continue
		}

		result, err := executeInternalBatch(payload, deps)
		if err != nil {
			if writeErr := writeJSON(WSEventMessage{Type: "error", Data: err.Error()}); writeErr != nil {
				return writeErr
			}
			continue
		}

		if writeErr := writeJSON(result); writeErr != nil {
			return writeErr
		}
	}
}

func executeInternalBatch(payload []byte, deps Dependencies) (InternalBatchResult, error) {
	var batch InternalBatchMessage
	if err := json.Unmarshal(payload, &batch); err != nil {
		return InternalBatchResult{}, fmt.Errorf("invalid ws payload")
	}

	result := InternalBatchResult{}

	for _, item := range batch.Redis {
		result.Redis = append(result.Redis, runRedisItem(item, deps))
	}
	for _, item := range batch.Postgres {
		result.Postgres = append(result.Postgres, runSQLItem("postgres", item, deps))
	}
	for _, item := range batch.MySQL {
		result.MySQL = append(result.MySQL, runSQLItem("mysql", item, deps))
	}
	for _, item := range batch.MongoDB {
		result.MongoDB = append(result.MongoDB, runMongoItem(item, deps))
	}
	for _, item := range batch.SSH {
		result.SSH = append(result.SSH, runSSHItem(item, deps))
	}

	return result, nil
}

func runRedisItem(item InternalCommand, deps Dependencies) InternalCommandResult {
	parts := splitCommandWords(item.Cmd)
	if len(parts) == 0 {
		return InternalCommandResult{ID: item.ID, Error: "redis cmd is required"}
	}

	args := make([]any, 0, max(0, len(parts)-1))
	for _, value := range parts[1:] {
		args = append(args, value)
	}

	result, err := dbrunner.RunRedisCommand(context.Background(), dbrunner.RedisCommandRequest{
		URL:       item.URL,
		Command:   parts[0],
		Arguments: args,
	}, deps.Config.RedisTimeout)
	if err != nil {
		return InternalCommandResult{ID: item.ID, Error: err.Error()}
	}

	return InternalCommandResult{ID: item.ID, OK: true, Data: result}
}

func runSQLItem(driver string, item InternalCommand, deps Dependencies) InternalCommandResult {
	result, err := dbrunner.QuerySQL(context.Background(), dbrunner.SQLQueryRequest{
		Driver: driver,
		DSN:    item.URL,
		Query:  item.Cmd,
	}, deps.Config.DatabaseTimeout)
	if err != nil {
		return InternalCommandResult{ID: item.ID, Error: err.Error()}
	}

	return InternalCommandResult{ID: item.ID, OK: true, Data: result}
}

func runMongoItem(item InternalCommand, deps Dependencies) InternalCommandResult {
	request, err := parseMongoShellCommand(item.URL, item.Cmd)
	if err != nil {
		return InternalCommandResult{ID: item.ID, Error: err.Error()}
	}

	result, err := dbrunner.RunMongoQuery(context.Background(), request, deps.Config.MongoTimeout)
	if err != nil {
		return InternalCommandResult{ID: item.ID, Error: err.Error()}
	}

	return InternalCommandResult{ID: item.ID, OK: true, Data: result}
}

func runSSHItem(item InternalCommand, deps Dependencies) InternalCommandResult {
	result, err := sshrelay.ExecURLCommand(item.URL, item.Cmd, deps.Config.SSHTimeout)
	if err != nil {
		return InternalCommandResult{ID: item.ID, Error: err.Error()}
	}

	return InternalCommandResult{ID: item.ID, OK: true, Data: result}
}

func handleWebSocketProxyWithHeaders(conn *ws.Conn, targetURL string, fallbackTimeout time.Duration) error {
	headers := make(http.Header)
	for key, value := range collectForwardHeaders(conn) {
		headers.Set(key, value)
	}

	connectPayload, err := json.Marshal(WSConnectMessage{
		Type:    "connect",
		URL:     targetURL,
		Headers: headerMapToStringMap(headers),
	})
	if err != nil {
		return err
	}

	return handleWebSocketProxyWithPayload(conn, connectPayload, fallbackTimeout)
}

func handleWebSocketProxyWithPayload(conn *ws.Conn, payload []byte, fallbackTimeout time.Duration) error {
	connectMessage, err := parseWSConnectMessage(payload)
	if err != nil {
		return err
	}

	timeout := fallbackTimeout
	if connectMessage.TimeoutMs > 0 {
		timeout = time.Duration(connectMessage.TimeoutMs) * time.Millisecond
	}

	headers := make(http.Header, len(connectMessage.Headers))
	for key, value := range connectMessage.Headers {
		headers.Set(key, value)
	}

	dialer := &fws.Dialer{
		HandshakeTimeout: timeout,
		Subprotocols:     connectMessage.Subprotocols,
	}

	upstream, response, err := dialer.Dial(connectMessage.URL, headers)
	if response != nil {
		defer response.Body.Close()
	}
	if err != nil {
		return fmt.Errorf("connect upstream websocket: %w", err)
	}
	defer upstream.Close()

	var writeMu sync.Mutex
	writeJSON := func(message WSEventMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(message)
	}

	_ = writeJSON(WSEventMessage{
		Type: "status",
		Data: "connected",
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		defer cancel()
		for {
			messageType, payload, readErr := upstream.ReadMessage()
			if readErr != nil {
				_ = writeJSON(WSEventMessage{Type: "closed", Data: readErr.Error()})
				return
			}
			writeMu.Lock()
			writeErr := conn.WriteMessage(messageType, payload)
			writeMu.Unlock()
			if writeErr != nil {
				return
			}
		}
	}()

	go func() {
		<-ctx.Done()
		_ = upstream.Close()
	}()

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		if messageType == ws.CloseMessage {
			return nil
		}

		if err := upstream.WriteMessage(messageType, payload); err != nil {
			return err
		}
	}
}

func parseWSConnectMessage(payload []byte) (WSConnectMessage, error) {
	var message WSConnectMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return WSConnectMessage{}, fmt.Errorf("expected initial websocket config message")
	}
	if message.Type != "connect" {
		return WSConnectMessage{}, fmt.Errorf("first websocket message must be type=connect")
	}
	if message.URL == "" {
		return WSConnectMessage{}, fmt.Errorf("url is required")
	}
	return message, nil
}

func collectForwardHeaders(conn *ws.Conn) map[string]string {
	headers := make(map[string]string)
	candidates := []string{
		"authorization",
		"cookie",
		"origin",
		"user-agent",
		"x-requested-with",
	}

	for _, key := range candidates {
		if value := conn.Headers(key); value != "" {
			headers[http.CanonicalHeaderKey(key)] = value
		}
	}

	return headers
}

func headerMapToStringMap(headers http.Header) map[string]string {
	result := make(map[string]string, len(headers))
	for key, values := range headers {
		if len(values) == 0 {
			continue
		}
		result[key] = values[0]
	}
	return result
}

func splitCommandWords(input string) []string {
	var (
		parts   []string
		current strings.Builder
		quote   rune
		escape  bool
	)

	flush := func() {
		if current.Len() == 0 {
			return
		}
		parts = append(parts, current.String())
		current.Reset()
	}

	for _, r := range input {
		switch {
		case escape:
			current.WriteRune(r)
			escape = false
		case r == '\\':
			escape = true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
		case r == ' ' || r == '\t' || r == '\n':
			flush()
		default:
			current.WriteRune(r)
		}
	}

	flush()
	return parts
}

var mongoCommandPattern = regexp.MustCompile(`^db\.([A-Za-z0-9_-]+)\.(findOne|find|aggregate|deleteOne|deleteMany)\((.*)\)\s*$`)
var mongoObjectIDPattern = regexp.MustCompile(`ObjectId\(['"]([0-9a-fA-F]{24})['"]\)`)
var mongoKeyPattern = regexp.MustCompile(`([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)`)

func parseMongoShellCommand(rawURL string, command string) (dbrunner.MongoQueryRequest, error) {
	matches := mongoCommandPattern.FindStringSubmatch(strings.TrimSpace(command))
	if len(matches) != 4 {
		return dbrunner.MongoQueryRequest{}, fmt.Errorf("unsupported mongodb cmd")
	}

	collection := matches[1]
	action := matches[2]
	expression := strings.TrimSpace(matches[3])

	database, err := mongoDatabaseName(rawURL)
	if err != nil {
		return dbrunner.MongoQueryRequest{}, err
	}

	request := dbrunner.MongoQueryRequest{
		URI:        rawURL,
		Database:   database,
		Collection: collection,
	}

	switch action {
	case "find":
		filter, err := parseMongoObject(expression)
		if err != nil {
			return dbrunner.MongoQueryRequest{}, err
		}
		request.Action = "findMany"
		request.Filter = filter
	case "findOne":
		filter, err := parseMongoObject(expression)
		if err != nil {
			return dbrunner.MongoQueryRequest{}, err
		}
		request.Action = "findOne"
		request.Filter = filter
	case "deleteOne":
		filter, err := parseMongoObject(expression)
		if err != nil {
			return dbrunner.MongoQueryRequest{}, err
		}
		request.Action = "deleteOne"
		request.Filter = filter
	case "deleteMany":
		filter, err := parseMongoObject(expression)
		if err != nil {
			return dbrunner.MongoQueryRequest{}, err
		}
		request.Action = "deleteMany"
		request.Filter = filter
	case "aggregate":
		pipeline, err := parseMongoPipeline(expression)
		if err != nil {
			return dbrunner.MongoQueryRequest{}, err
		}
		request.Action = "aggregate"
		request.Pipeline = pipeline
	default:
		return dbrunner.MongoQueryRequest{}, fmt.Errorf("unsupported mongodb action")
	}

	return request, nil
}

func mongoDatabaseName(rawURL string) (string, error) {
	parsed, err := neturl.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse mongodb url: %w", err)
	}
	name := strings.Trim(parsed.Path, "/")
	if name == "" {
		name = "test"
	}
	return name, nil
}

func parseMongoObject(expression string) (map[string]any, error) {
	normalized := normalizeMongoJSON(expression)
	var result map[string]any
	if err := bson.UnmarshalExtJSON([]byte(normalized), true, &result); err != nil {
		return nil, fmt.Errorf("parse mongodb filter: %w", err)
	}
	return result, nil
}

func parseMongoPipeline(expression string) ([]map[string]any, error) {
	normalized := normalizeMongoJSON(expression)
	var result []map[string]any
	if err := bson.UnmarshalExtJSON([]byte(normalized), true, &result); err != nil {
		return nil, fmt.Errorf("parse mongodb pipeline: %w", err)
	}
	return result, nil
}

func normalizeMongoJSON(input string) string {
	normalized := strings.TrimSpace(input)
	normalized = mongoObjectIDPattern.ReplaceAllString(normalized, `{"$oid":"$1"}`)
	normalized = strings.ReplaceAll(normalized, `'`, `"`)
	for {
		updated := mongoKeyPattern.ReplaceAllString(normalized, `$1"$2"$3`)
		if updated == normalized {
			break
		}
		normalized = updated
	}
	return normalized
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
