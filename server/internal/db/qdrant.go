package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// Qdrant is a vector store reached over its REST API using only net/http — no
// new dependency. It has no SQL surface and no GORM dialector; it speaks the
// dedicated `qdrant` wire protocol (see the handler case in handlers/db.go).
// The frontend's QdrantAdapter drives it off isSearchStore(), mirroring how
// Elasticsearch is handled. Collections play the role of "indices"; points are
// flattened into tabular {columns, rows} so they render in the normal grid.
//
// Auth: the address is the HTTP base URL (config.host[:port]); an optional API
// key is sent as the `api-key` header (Qdrant Cloud).

// qdrantClient is a thin cached holder for one base address + api key. Qdrant is
// stateless HTTP, so we cache only the resolved base URL and a shared client.
type qdrantClient struct {
	base   string
	apiKey string
	http   *http.Client
}

var (
	qdrantClientsMu sync.Mutex
	qdrantClients   = map[string]*qdrantClient{}
)

// QdrantQueryRequest is the wire payload for a Qdrant command. A single request
// type covers every action the frontend "search" adapter issues — the
// connection is identified by Address (+ optional APIKey), and Action picks the
// operation. Collection/Body/Limit are interpreted per-action.
type QdrantQueryRequest struct {
	Address    string `json:"address"`
	APIKey     string `json:"apiKey"`
	Action     string `json:"action"`
	Collection string `json:"collection"`
	Body       string `json:"body"`
	Limit      int    `json:"limit"`
	TimeoutMs  int    `json:"timeoutMs"`
}

// QdrantQueryResponse is SQL-shaped {columns, rows} so flattened points render
// directly in the existing grid (the frontend maps the `qdrant` kind to "sql").
type QdrantQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunQdrantQuery(ctx context.Context, request QdrantQueryRequest, fallbackTimeout time.Duration) (QdrantQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return QdrantQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client := getOrCreateQdrantClient(request, timeout)

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "scroll"
	}

	switch action {
	case "info", "ping":
		raw, err := client.do(timeoutCtx, http.MethodGet, "/", nil)
		if err != nil {
			return QdrantQueryResponse{}, err
		}
		return QdrantQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "listCollections":
		raw, err := client.do(timeoutCtx, http.MethodGet, "/collections", nil)
		if err != nil {
			return QdrantQueryResponse{}, err
		}
		return QdrantQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "collectionInfo":
		collection := strings.TrimSpace(request.Collection)
		if collection == "" {
			return QdrantQueryResponse{}, fmt.Errorf("collection is required")
		}
		raw, err := client.do(timeoutCtx, http.MethodGet, "/collections/"+collection, nil)
		if err != nil {
			return QdrantQueryResponse{}, err
		}
		return QdrantQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "scroll":
		return scrollQdrantPoints(timeoutCtx, client, request, start)
	case "request":
		return runQdrantRawRequest(timeoutCtx, client, request, start)
	default:
		return QdrantQueryResponse{}, fmt.Errorf("unsupported qdrant action: %s", action)
	}
}

// scrollQdrantPoints pages through a collection's points and flattens each into
// a row (id + payload fields), so the result renders in the grid. The optional
// Body is forwarded verbatim as the scroll filter/spec; otherwise a bounded
// "with_payload" scroll is issued.
func scrollQdrantPoints(ctx context.Context, client *qdrantClient, request QdrantQueryRequest, start time.Time) (QdrantQueryResponse, error) {
	collection := strings.TrimSpace(request.Collection)
	if collection == "" {
		return QdrantQueryResponse{}, fmt.Errorf("collection is required")
	}
	limit := request.Limit
	if limit <= 0 {
		limit = 100
	}

	var body []byte
	if spec := strings.TrimSpace(request.Body); spec != "" {
		body = []byte(spec)
	} else {
		body, _ = json.Marshal(map[string]any{
			"limit":        limit,
			"with_payload": true,
			"with_vector":  false,
		})
	}

	raw, err := client.do(ctx, http.MethodPost, "/collections/"+collection+"/points/scroll", body)
	if err != nil {
		return QdrantQueryResponse{}, err
	}

	var decoded struct {
		Result struct {
			Points []map[string]any `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		// Not the expected shape — surface the raw body so the user can inspect.
		return QdrantQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	}

	columns, rows := flattenQdrantPoints(decoded.Result.Points)
	return QdrantQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// flattenQdrantPoints turns scroll points into tabular rows: a leading "id"
// column plus one column per payload key (union across all points, sorted for
// stable column order). Nested payload values are JSON-encoded for the cell.
func flattenQdrantPoints(points []map[string]any) ([]string, []map[string]any) {
	keySet := map[string]struct{}{}
	rows := make([]map[string]any, 0, len(points))
	for _, point := range points {
		row := map[string]any{}
		if id, ok := point["id"]; ok {
			row["id"] = id
		}
		if payload, ok := point["payload"].(map[string]any); ok {
			for key, value := range payload {
				keySet[key] = struct{}{}
				row[key] = jsonScalar(value)
			}
		}
		rows = append(rows, row)
	}

	payloadKeys := make([]string, 0, len(keySet))
	for key := range keySet {
		payloadKeys = append(payloadKeys, key)
	}
	sort.Strings(payloadKeys)

	columns := append([]string{"id"}, payloadKeys...)
	return columns, rows
}

// runQdrantRawRequest issues an arbitrary METHOD /path request so the editor can
// target any Qdrant endpoint. The body, when present, is sent verbatim.
func runQdrantRawRequest(ctx context.Context, client *qdrantClient, request QdrantQueryRequest, start time.Time) (QdrantQueryResponse, error) {
	// `request` here reuses Collection as the path and Body as the JSON body to
	// keep the wire payload small; method defaults to POST when a body is given.
	path := strings.TrimSpace(request.Collection)
	if path == "" {
		path = "/"
	}
	httpMethod := http.MethodGet
	var reqBody []byte
	if spec := strings.TrimSpace(request.Body); spec != "" {
		reqBody = []byte(spec)
		httpMethod = http.MethodPost
	}
	raw, err := client.do(ctx, httpMethod, path, reqBody)
	if err != nil {
		return QdrantQueryResponse{}, err
	}
	return QdrantQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
}

// do performs an HTTP request against the Qdrant base URL, attaching the api-key
// header when configured, and returns the raw body. Non-2xx responses surface
// the body text as an error.
func (c *qdrantClient) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		req.Header.Set("api-key", c.apiKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("qdrant %s %s: %s", method, path, strings.TrimSpace(string(raw)))
	}
	return raw, nil
}

func getOrCreateQdrantClient(request QdrantQueryRequest, timeout time.Duration) *qdrantClient {
	base := normalizeHTTPBase(request.Address)
	apiKey := strings.TrimSpace(request.APIKey)
	key := base + "\x00" + apiKey

	qdrantClientsMu.Lock()
	defer qdrantClientsMu.Unlock()
	if client, ok := qdrantClients[key]; ok {
		return client
	}
	client := &qdrantClient{
		base:   base,
		apiKey: apiKey,
		http:   &http.Client{Timeout: timeout},
	}
	qdrantClients[key] = client
	return client
}

// DisconnectQdrantClient drops every cached client whose base address matches.
// Qdrant holds no persistent connection, so removing the cache entry suffices.
func DisconnectQdrantClient(address string) error {
	target := normalizeHTTPBase(address)
	if target == "" {
		return nil
	}
	qdrantClientsMu.Lock()
	defer qdrantClientsMu.Unlock()
	for key := range qdrantClients {
		if strings.HasPrefix(key, target+"\x00") {
			delete(qdrantClients, key)
		}
	}
	return nil
}
