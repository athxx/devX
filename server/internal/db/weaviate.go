package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Weaviate is a vector store reached over its REST API using only net/http — no
// new dependency. It has no SQL surface and no GORM dialector; it speaks the
// dedicated `weaviate` wire protocol (see the handler case in handlers/db.go).
// The frontend's WeaviateAdapter drives it off isSearchStore(), mirroring how
// Elasticsearch and Qdrant are handled. Classes play the role of "indices";
// objects are flattened into tabular {columns, rows} so they render in the
// normal grid.
//
// Auth: the address is the HTTP base URL (config.host[:port]); an optional API
// key is sent as a Bearer token (Weaviate Cloud / API-key auth).

// weaviateClient is a thin cached holder for one base address + api key.
// Weaviate is stateless HTTP, so we cache only the resolved base URL and a
// shared client.
type weaviateClient struct {
	base   string
	apiKey string
	http   *http.Client
}

var (
	weaviateClientsMu sync.Mutex
	weaviateClients   = map[string]*weaviateClient{}
)

// WeaviateQueryRequest is the wire payload for a Weaviate command. A single
// request type covers every action the frontend "search" adapter issues — the
// connection is identified by Address (+ optional APIKey), and Action picks the
// operation. Class/Body/Limit are interpreted per-action.
type WeaviateQueryRequest struct {
	Address   string `json:"address"`
	APIKey    string `json:"apiKey"`
	Action    string `json:"action"`
	Class     string `json:"class"`
	Body      string `json:"body"`
	Limit     int    `json:"limit"`
	TimeoutMs int    `json:"timeoutMs"`
}

// WeaviateQueryResponse is SQL-shaped {columns, rows} so flattened objects
// render directly in the existing grid (the frontend maps the `weaviate` kind
// to "sql").
type WeaviateQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunWeaviateQuery(ctx context.Context, request WeaviateQueryRequest, fallbackTimeout time.Duration) (WeaviateQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return WeaviateQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client := getOrCreateWeaviateClient(request, timeout)

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "objects"
	}

	switch action {
	case "info", "ping", "meta":
		raw, err := client.do(timeoutCtx, http.MethodGet, "/v1/meta", nil)
		if err != nil {
			return WeaviateQueryResponse{}, err
		}
		return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "listClasses", "schema":
		raw, err := client.do(timeoutCtx, http.MethodGet, "/v1/schema", nil)
		if err != nil {
			return WeaviateQueryResponse{}, err
		}
		return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "classInfo":
		class := strings.TrimSpace(request.Class)
		if class == "" {
			return WeaviateQueryResponse{}, fmt.Errorf("class is required")
		}
		raw, err := client.do(timeoutCtx, http.MethodGet, "/v1/schema/"+url.PathEscape(class), nil)
		if err != nil {
			return WeaviateQueryResponse{}, err
		}
		return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "objects":
		return listWeaviateObjects(timeoutCtx, client, request, start)
	case "request":
		return runWeaviateRawRequest(timeoutCtx, client, request, start)
	default:
		return WeaviateQueryResponse{}, fmt.Errorf("unsupported weaviate action: %s", action)
	}
}

// listWeaviateObjects pages through a class's objects via REST and flattens each
// into a row (id + property fields), so the result renders in the grid. A raw
// GraphQL Body, when present, is POSTed to /v1/graphql verbatim instead.
func listWeaviateObjects(ctx context.Context, client *weaviateClient, request WeaviateQueryRequest, start time.Time) (WeaviateQueryResponse, error) {
	// A non-empty Body is treated as a raw GraphQL query so the editor can run
	// arbitrary near-vector / where searches that REST cannot express.
	if spec := strings.TrimSpace(request.Body); spec != "" {
		body, _ := json.Marshal(map[string]any{"query": spec})
		raw, err := client.do(ctx, http.MethodPost, "/v1/graphql", body)
		if err != nil {
			return WeaviateQueryResponse{}, err
		}
		columns, rows, ok := flattenWeaviateGraphQL(raw, request.Class)
		if !ok {
			return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
		}
		return WeaviateQueryResponse{Columns: columns, Rows: rows, DurationMs: time.Since(start).Milliseconds()}, nil
	}

	class := strings.TrimSpace(request.Class)
	if class == "" {
		return WeaviateQueryResponse{}, fmt.Errorf("class is required")
	}
	limit := request.Limit
	if limit <= 0 {
		limit = 100
	}

	path := "/v1/objects?class=" + url.QueryEscape(class) + "&limit=" + strconv.Itoa(limit)
	raw, err := client.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return WeaviateQueryResponse{}, err
	}

	var decoded struct {
		Objects []map[string]any `json:"objects"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	}

	columns, rows := flattenWeaviateObjects(decoded.Objects)
	return WeaviateQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// flattenWeaviateObjects turns REST objects into tabular rows: a leading "id"
// column plus one column per property key (union across all objects, sorted for
// stable column order). Nested property values are JSON-encoded for the cell.
func flattenWeaviateObjects(objects []map[string]any) ([]string, []map[string]any) {
	keySet := map[string]struct{}{}
	rows := make([]map[string]any, 0, len(objects))
	for _, object := range objects {
		row := map[string]any{}
		if id, ok := object["id"]; ok {
			row["id"] = id
		}
		if props, ok := object["properties"].(map[string]any); ok {
			for key, value := range props {
				keySet[key] = struct{}{}
				row[key] = jsonScalar(value)
			}
		}
		rows = append(rows, row)
	}

	propKeys := make([]string, 0, len(keySet))
	for key := range keySet {
		propKeys = append(propKeys, key)
	}
	sort.Strings(propKeys)

	columns := append([]string{"id"}, propKeys...)
	return columns, rows
}

// flattenWeaviateGraphQL pulls the Get.<Class> list out of a GraphQL response
// (data.Get.<Class> = [ {field: value, ...}, ... ]) and flattens it into rows.
// Returns ok=false when the shape does not match so the caller can fall back to
// the raw body.
func flattenWeaviateGraphQL(raw []byte, class string) ([]string, []map[string]any, bool) {
	var decoded struct {
		Data struct {
			Get map[string]json.RawMessage `json:"Get"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil || len(decoded.Data.Get) == 0 {
		return nil, nil, false
	}

	// Prefer the requested class; otherwise take the only/first key present.
	var listRaw json.RawMessage
	if class != "" {
		listRaw = decoded.Data.Get[class]
	}
	if listRaw == nil {
		for _, v := range decoded.Data.Get {
			listRaw = v
			break
		}
	}
	if listRaw == nil {
		return nil, nil, false
	}

	var items []map[string]any
	if err := json.Unmarshal(listRaw, &items); err != nil {
		return nil, nil, false
	}

	keySet := map[string]struct{}{}
	rows := make([]map[string]any, 0, len(items))
	for _, item := range items {
		row := map[string]any{}
		for key, value := range item {
			keySet[key] = struct{}{}
			row[key] = jsonScalar(value)
		}
		rows = append(rows, row)
	}

	keys := make([]string, 0, len(keySet))
	for key := range keySet {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys, rows, true
}

// runWeaviateRawRequest issues an arbitrary METHOD /path request so the editor
// can target any Weaviate endpoint. The body, when present, is sent verbatim
// and the method defaults to POST.
func runWeaviateRawRequest(ctx context.Context, client *weaviateClient, request WeaviateQueryRequest, start time.Time) (WeaviateQueryResponse, error) {
	// Class carries the path and Body the JSON body to keep the wire small.
	path := strings.TrimSpace(request.Class)
	if path == "" {
		path = "/v1/meta"
	}
	httpMethod := http.MethodGet
	var reqBody []byte
	if spec := strings.TrimSpace(request.Body); spec != "" {
		reqBody = []byte(spec)
		httpMethod = http.MethodPost
	}
	raw, err := client.do(ctx, httpMethod, path, reqBody)
	if err != nil {
		return WeaviateQueryResponse{}, err
	}
	return WeaviateQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
}

// do performs an HTTP request against the Weaviate base URL, attaching the
// Bearer token when configured, and returns the raw body. Non-2xx responses
// surface the body text as an error.
func (c *weaviateClient) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
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
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
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
		return nil, fmt.Errorf("weaviate %s %s: %s", method, path, strings.TrimSpace(string(raw)))
	}
	return raw, nil
}

func getOrCreateWeaviateClient(request WeaviateQueryRequest, timeout time.Duration) *weaviateClient {
	base := normalizeHTTPBase(request.Address)
	apiKey := strings.TrimSpace(request.APIKey)
	key := base + "\x00" + apiKey

	weaviateClientsMu.Lock()
	defer weaviateClientsMu.Unlock()
	if client, ok := weaviateClients[key]; ok {
		return client
	}
	client := &weaviateClient{
		base:   base,
		apiKey: apiKey,
		http:   &http.Client{Timeout: timeout},
	}
	weaviateClients[key] = client
	return client
}

// DisconnectWeaviateClient drops every cached client whose base address matches.
// Weaviate holds no persistent connection, so removing the cache entry suffices.
func DisconnectWeaviateClient(address string) error {
	target := normalizeHTTPBase(address)
	if target == "" {
		return nil
	}
	weaviateClientsMu.Lock()
	defer weaviateClientsMu.Unlock()
	for key := range weaviateClients {
		if strings.HasPrefix(key, target+"\x00") {
			delete(weaviateClients, key)
		}
	}
	return nil
}
