package db

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	elasticsearch "github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"
)

var (
	esClientsMu sync.Mutex
	esClients   = map[string]*elasticsearch.Client{}
)

// ESQueryRequest is the wire payload for an Elasticsearch command. A single
// request type covers every action the frontend "search" adapter issues — the
// connection is identified by Address (+ optional basic auth), and Action picks
// the operation. Index/Body/Method/Path are interpreted per-action.
type ESQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	APIKey    string `json:"apiKey"`
	Action    string `json:"action"`
	Index     string `json:"index"`
	Body      string `json:"body"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Size      int    `json:"size"`
	TimeoutMs int    `json:"timeoutMs"`
}

// ESQueryResponse mirrors MongoQueryResponse: a decoded JSON result plus timing.
type ESQueryResponse struct {
	Result     any   `json:"result"`
	DurationMs int64 `json:"durationMs"`
}

func RunESQuery(ctx context.Context, request ESQueryRequest, fallbackTimeout time.Duration) (ESQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return ESQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateESClient(request)
	if err != nil {
		return ESQueryResponse{}, fmt.Errorf("connect elasticsearch: %w", err)
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "search"
	}

	switch action {
	case "info", "ping":
		res, err := client.Info(client.Info.WithContext(timeoutCtx))
		return decodeESResponse(res, err, start)
	case "listIndices":
		res, err := client.Cat.Indices(
			client.Cat.Indices.WithContext(timeoutCtx),
			client.Cat.Indices.WithFormat("json"),
		)
		return decodeESResponse(res, err, start)
	case "search":
		opts := []func(*esapi.SearchRequest){
			client.Search.WithContext(timeoutCtx),
		}
		if index := strings.TrimSpace(request.Index); index != "" {
			opts = append(opts, client.Search.WithIndex(index))
		}
		if body := strings.TrimSpace(request.Body); body != "" {
			opts = append(opts, client.Search.WithBody(strings.NewReader(body)))
		}
		if request.Size > 0 {
			opts = append(opts, client.Search.WithSize(request.Size))
		}
		res, err := client.Search(opts...)
		return decodeESResponse(res, err, start)
	case "request":
		return runESRawRequest(timeoutCtx, client, request, start)
	default:
		return ESQueryResponse{}, fmt.Errorf("unsupported elasticsearch action: %s", action)
	}
}

// runESRawRequest issues an arbitrary METHOD /path request through the client's
// transport, so the query editor can target any ES endpoint (e.g. GET
// /my-index/_mapping). The body, when present, is sent verbatim as JSON.
func runESRawRequest(ctx context.Context, client *elasticsearch.Client, request ESQueryRequest, start time.Time) (ESQueryResponse, error) {
	method := strings.ToUpper(strings.TrimSpace(request.Method))
	if method == "" {
		method = http.MethodGet
	}
	path := strings.TrimSpace(request.Path)
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	var bodyReader io.Reader
	if body := strings.TrimSpace(request.Body); body != "" {
		bodyReader = strings.NewReader(body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, path, bodyReader)
	if err != nil {
		return ESQueryResponse{}, err
	}
	if bodyReader != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	res, err := client.Perform(httpReq)
	if err != nil {
		return ESQueryResponse{}, err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return ESQueryResponse{}, err
	}
	if res.StatusCode >= http.StatusBadRequest {
		return ESQueryResponse{}, fmt.Errorf("elasticsearch %s %s: %s", method, path, strings.TrimSpace(string(raw)))
	}
	return ESQueryResponse{Result: decodeESBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
}

// decodeESResponse consumes a typed esapi.Response, surfacing API-level errors
// (res.IsError) and decoding the JSON body into a generic value.
func decodeESResponse(res *esapi.Response, err error, start time.Time) (ESQueryResponse, error) {
	if err != nil {
		return ESQueryResponse{}, err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return ESQueryResponse{}, err
	}
	if res.IsError() {
		return ESQueryResponse{}, fmt.Errorf("elasticsearch error: %s", strings.TrimSpace(string(raw)))
	}
	return ESQueryResponse{Result: decodeESBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
}

// decodeESBody parses a JSON body, falling back to the raw string if it is not
// valid JSON (e.g. an empty 200 response).
func decodeESBody(raw []byte) any {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return map[string]any{}
	}
	var decoded any
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return string(trimmed)
	}
	return decoded
}

func getOrCreateESClient(request ESQueryRequest) (*elasticsearch.Client, error) {
	key := esClientKey(request)

	esClientsMu.Lock()
	client, ok := esClients[key]
	esClientsMu.Unlock()
	if ok {
		return client, nil
	}

	cfg := elasticsearch.Config{
		Addresses: splitESAddresses(request.Address),
		Username:  strings.TrimSpace(request.Username),
		Password:  request.Password,
		APIKey:    strings.TrimSpace(request.APIKey),
	}
	client, err := elasticsearch.NewClient(cfg)
	if err != nil {
		return nil, err
	}

	esClientsMu.Lock()
	if existing, exists := esClients[key]; exists {
		esClientsMu.Unlock()
		return existing, nil
	}
	esClients[key] = client
	esClientsMu.Unlock()

	return client, nil
}

// esClientKey scopes the connection cache by address + credentials so that two
// connections to the same cluster with different auth do not collide.
func esClientKey(request ESQueryRequest) string {
	return strings.Join([]string{
		strings.TrimSpace(request.Address),
		strings.TrimSpace(request.Username),
		request.Password,
		strings.TrimSpace(request.APIKey),
	}, "\x00")
}

func splitESAddresses(address string) []string {
	parts := strings.Split(address, ",")
	addrs := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			addrs = append(addrs, trimmed)
		}
	}
	return addrs
}

// DisconnectESClient drops every cached client whose address matches; the ES
// client holds only a transport (no persistent connection to close), so simply
// removing it from the cache is sufficient.
func DisconnectESClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	esClientsMu.Lock()
	defer esClientsMu.Unlock()
	for key := range esClients {
		if strings.HasPrefix(key, target+"\x00") {
			delete(esClients, key)
		}
	}
	return nil
}
