package db

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// InfluxDB (v2/v3 OSS + Cloud) is reached over its HTTP query API using only
// net/http — no driver dependency. It speaks the dedicated `influx` wire
// protocol (see the handler case in handlers/db.go). The query language is Flux;
// the API returns annotated CSV, which we flatten into tabular {columns, rows}
// so it renders in the normal grid (the frontend maps `influx` → "sql").
//
// Auth/config: address is the HTTP base URL (config.host[:port]); org is the
// organization (config.username); token is the API token (config.password, sent
// as the `Authorization: Token …` header); bucket (config.database) seeds the
// default Flux query.

type influxClient struct {
	base  string
	org   string
	token string
	http  *http.Client
}

var (
	influxClientsMu sync.Mutex
	influxClients   = map[string]*influxClient{}
)

// InfluxQueryRequest is the wire payload for an InfluxDB command. Action picks
// the operation; a single request type covers everything the frontend adapter
// issues. Query carries a Flux script for the `query` action.
type InfluxQueryRequest struct {
	Address   string `json:"address"`
	Org       string `json:"org"`
	Token     string `json:"token"`
	Action    string `json:"action"`
	Bucket    string `json:"bucket"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// InfluxQueryResponse is SQL-shaped {columns, rows} so the flattened CSV renders
// directly in the existing grid. Result holds raw JSON for non-tabular actions
// (health/listBuckets).
type InfluxQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunInfluxQuery(ctx context.Context, request InfluxQueryRequest, fallbackTimeout time.Duration) (InfluxQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return InfluxQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client := getOrCreateInfluxClient(request, timeout)

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "health":
		raw, err := client.do(timeoutCtx, http.MethodGet, "/health", "", nil)
		if err != nil {
			return InfluxQueryResponse{}, err
		}
		return InfluxQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "listBuckets":
		// /api/v2/buckets returns JSON; surface it raw for the explorer to parse.
		raw, err := client.do(timeoutCtx, http.MethodGet, "/api/v2/buckets", "", nil)
		if err != nil {
			return InfluxQueryResponse{}, err
		}
		return InfluxQueryResponse{Result: decodeJSONBody(raw), DurationMs: time.Since(start).Milliseconds()}, nil
	case "query":
		return runInfluxFluxQuery(timeoutCtx, client, request, start)
	default:
		return InfluxQueryResponse{}, fmt.Errorf("unsupported influx action: %s", action)
	}
}

// runInfluxFluxQuery posts a Flux script to /api/v2/query and flattens the
// annotated-CSV response into tabular rows.
func runInfluxFluxQuery(ctx context.Context, client *influxClient, request InfluxQueryRequest, start time.Time) (InfluxQueryResponse, error) {
	flux := strings.TrimSpace(request.Query)
	if flux == "" {
		bucket := strings.TrimSpace(request.Bucket)
		if bucket == "" {
			return InfluxQueryResponse{}, fmt.Errorf("a Flux query or bucket is required")
		}
		flux = fmt.Sprintf("from(bucket: %q)\n  |> range(start: -1h)\n  |> limit(n: 100)", bucket)
	}

	path := "/api/v2/query"
	if org := strings.TrimSpace(client.org); org != "" {
		path += "?org=" + url.QueryEscape(org)
	}

	raw, err := client.do(ctx, http.MethodPost, path, "application/vnd.flux", []byte(flux))
	if err != nil {
		return InfluxQueryResponse{}, err
	}

	columns, rows := flattenInfluxCSV(raw)
	return InfluxQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// flattenInfluxCSV parses InfluxDB's annotated CSV into a single grid. The
// format emits one or more "tables", each a block of annotation lines (starting
// with '#'), a header row, then data rows, separated by blank lines. We skip
// annotation lines and the leading empty/bookkeeping columns, taking the union
// of header columns (in first-seen order) across all blocks for stable output.
func flattenInfluxCSV(raw []byte) ([]string, []map[string]any) {
	reader := csv.NewReader(bytes.NewReader(raw))
	reader.FieldsPerRecord = -1 // blocks have differing column counts

	var (
		columns []string
		colSeen = map[string]struct{}{}
		header  []string
		rows    = make([]map[string]any, 0, 64)
	)

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			// Blank line — terminate the current block; the next header re-arms.
			header = nil
			continue
		}
		first := strings.TrimSpace(record[0])
		if strings.HasPrefix(first, "#") {
			// Annotation line (#datatype / #group / #default) — ignored.
			continue
		}
		if header == nil {
			// First non-annotation row of a block is its header.
			header = record
			for _, name := range header {
				name = strings.TrimSpace(name)
				if name == "" || name == "result" || name == "table" {
					// Drop the leading empty index column + Influx bookkeeping.
					continue
				}
				if _, ok := colSeen[name]; !ok {
					colSeen[name] = struct{}{}
					columns = append(columns, name)
				}
			}
			continue
		}
		// Data row — map values by the current block's header.
		row := map[string]any{}
		for i, name := range header {
			name = strings.TrimSpace(name)
			if name == "" || name == "result" || name == "table" {
				continue
			}
			if i < len(record) {
				row[name] = record[i]
			}
		}
		rows = append(rows, row)
	}

	if columns == nil {
		columns = []string{}
	}
	return columns, rows
}

// do performs an HTTP request against the InfluxDB base URL, attaching the
// Authorization token, and returns the raw body. Non-2xx responses surface the
// body text as an error.
func (c *influxClient) do(ctx context.Context, method, path, contentType string, body []byte) ([]byte, error) {
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
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	// Influx requires the response in CSV; ask for it explicitly.
	req.Header.Set("Accept", "application/csv")
	if c.token != "" {
		req.Header.Set("Authorization", "Token "+c.token)
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
		return nil, fmt.Errorf("influx %s %s: %s", method, path, strings.TrimSpace(string(raw)))
	}
	return raw, nil
}

func getOrCreateInfluxClient(request InfluxQueryRequest, timeout time.Duration) *influxClient {
	base := normalizeHTTPBase(request.Address)
	org := strings.TrimSpace(request.Org)
	token := strings.TrimSpace(request.Token)
	key := base + "\x00" + org + "\x00" + token

	influxClientsMu.Lock()
	defer influxClientsMu.Unlock()
	if client, ok := influxClients[key]; ok {
		return client
	}
	client := &influxClient{
		base:  base,
		org:   org,
		token: token,
		http:  &http.Client{Timeout: timeout},
	}
	influxClients[key] = client
	return client
}

// DisconnectInfluxClient drops every cached client whose base address matches.
// InfluxDB holds no persistent connection, so removing the cache entry suffices.
func DisconnectInfluxClient(address string) error {
	target := normalizeHTTPBase(address)
	if target == "" {
		return nil
	}
	influxClientsMu.Lock()
	defer influxClientsMu.Unlock()
	for key := range influxClients {
		if strings.HasPrefix(key, target+"\x00") {
			delete(influxClients, key)
		}
	}
	return nil
}
