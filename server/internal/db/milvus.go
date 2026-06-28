package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	milvus "github.com/milvus-io/milvus-sdk-go/v2/client"
)

// Milvus is a vector database reached over its native gRPC protocol via the
// official pure-Go SDK (milvus-sdk-go/v2 — gRPC, no cgo). It has no SQL surface
// and no GORM dialector; it speaks the dedicated `milvus` wire protocol (see the
// handler case in handlers/db.go). Collections play the role of tables; a Query's
// ResultSet (a set of typed columns) is transposed into tabular {columns, rows}
// so it renders in the normal grid (the `milvus` connection kind maps to the
// "sql" result kind in db-transport.ts). Vector cells are JSON-encoded.
//
// Auth: Address is host:port (config.host[:port], no scheme — gRPC, not HTTP);
// Username/Password feed Config auth, APIKey (config.options) covers Zilliz Cloud.
// Keyspace/Database selects the active DB.

type milvusClient struct {
	client milvus.Client
}

var (
	milvusClientsMu sync.Mutex
	milvusClients   = map[string]*milvusClient{}
)

// MilvusQueryRequest is the wire payload for a Milvus command. A single request
// type covers every action the frontend adapter issues — the connection is
// identified by Address (+ credentials + database), Action picks the operation.
type MilvusQueryRequest struct {
	Address    string `json:"address"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	APIKey     string `json:"apiKey"`
	Database   string `json:"database"`
	Action     string `json:"action"`
	Collection string `json:"collection"`
	// Expr is an optional boolean filter expression; empty means "all rows".
	Expr string `json:"expr"`
	// OutputFields restricts the returned columns; empty means all fields ("*").
	OutputFields []string `json:"outputFields"`
	Limit        int64    `json:"limit"`
	TimeoutMs    int      `json:"timeoutMs"`
}

// MilvusQueryResponse is SQL-shaped {columns, rows} so a transposed ResultSet
// renders directly in the existing grid (the frontend maps `milvus` to "sql").
type MilvusQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunMilvusQuery(ctx context.Context, request MilvusQueryRequest, fallbackTimeout time.Duration) (MilvusQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return MilvusQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateMilvusClient(timeoutCtx, request, timeout)
	if err != nil {
		return MilvusQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "info":
		// Listing collections is a cheap authenticated round-trip.
		if _, err := client.client.ListCollections(timeoutCtx); err != nil {
			return MilvusQueryResponse{}, err
		}
		return MilvusQueryResponse{
			Result:     map[string]any{"ok": true},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listCollections":
		collections, err := client.client.ListCollections(timeoutCtx)
		if err != nil {
			return MilvusQueryResponse{}, err
		}
		rows := make([]map[string]any, 0, len(collections))
		for _, coll := range collections {
			if coll == nil {
				continue
			}
			rows = append(rows, map[string]any{
				"collection_name": coll.Name,
				"loaded":          coll.Loaded,
			})
		}
		return MilvusQueryResponse{
			Columns:    []string{"collection_name", "loaded"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "query":
		collection := strings.TrimSpace(request.Collection)
		if collection == "" {
			return MilvusQueryResponse{}, fmt.Errorf("collection is required")
		}
		return runMilvusQuery(timeoutCtx, client, request, collection, start)
	default:
		return MilvusQueryResponse{}, fmt.Errorf("unsupported milvus action: %s", action)
	}
}

// runMilvusQuery loads the collection (Query requires the data in memory), runs
// the filter expression and transposes the resulting columns into rows.
func runMilvusQuery(ctx context.Context, client *milvusClient, request MilvusQueryRequest, collection string, start time.Time) (MilvusQueryResponse, error) {
	// Query reads from in-memory segments; ensure the collection is loaded. Load
	// is idempotent and returns immediately when already resident.
	if err := client.client.LoadCollection(ctx, collection, false); err != nil {
		return MilvusQueryResponse{}, err
	}

	outputFields := request.OutputFields
	if len(outputFields) == 0 {
		outputFields = []string{"*"}
	}

	opts := []milvus.SearchQueryOptionFunc{}
	limit := request.Limit
	if limit <= 0 {
		limit = 100
	}
	opts = append(opts, milvus.WithLimit(limit))

	resultSet, err := client.client.Query(
		ctx,
		collection,
		nil, // all partitions
		strings.TrimSpace(request.Expr),
		outputFields,
		opts...,
	)
	if err != nil {
		return MilvusQueryResponse{}, err
	}

	columns, rows := transposeMilvusResultSet(resultSet)
	return MilvusQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// transposeMilvusResultSet turns Milvus's column-major ResultSet ([]entity.Column)
// into row-major {columns, rows}. The row count is the max column length; missing
// cells stay nil. Each value is reduced to a grid-friendly scalar.
func transposeMilvusResultSet(resultSet milvus.ResultSet) ([]string, []map[string]any) {
	columns := make([]string, 0, len(resultSet))
	rowCount := 0
	for _, col := range resultSet {
		if col == nil {
			continue
		}
		columns = append(columns, col.Name())
		if n := col.Len(); n > rowCount {
			rowCount = n
		}
	}

	rows := make([]map[string]any, 0, rowCount)
	for i := 0; i < rowCount; i++ {
		row := map[string]any{}
		for _, col := range resultSet {
			if col == nil {
				continue
			}
			if i >= col.Len() {
				row[col.Name()] = nil
				continue
			}
			value, err := col.Get(i)
			if err != nil {
				row[col.Name()] = nil
				continue
			}
			row[col.Name()] = milvusScalar(value)
		}
		rows = append(rows, row)
	}

	return columns, rows
}

// milvusScalar keeps simple scalar values as-is and JSON-encodes composite values
// (vectors, arrays, JSON fields) so they fit a single grid cell.
func milvusScalar(value any) any {
	switch v := value.(type) {
	case nil, bool, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64, string:
		return v
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(encoded)
	}
}

func getOrCreateMilvusClient(ctx context.Context, request MilvusQueryRequest, _ time.Duration) (*milvusClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	database := strings.TrimSpace(request.Database)
	key := address + "\x00" + database + "\x00" + username + "\x00" + request.Password + "\x00" + request.APIKey

	milvusClientsMu.Lock()
	defer milvusClientsMu.Unlock()
	if client, ok := milvusClients[key]; ok {
		return client, nil
	}

	cfg := milvus.Config{
		Address:  address,
		Username: username,
		Password: request.Password,
		DBName:   database,
		APIKey:   strings.TrimSpace(request.APIKey),
	}
	c, err := milvus.NewClient(ctx, cfg)
	if err != nil {
		return nil, err
	}
	client := &milvusClient{client: c}
	milvusClients[key] = client
	return client, nil
}

// DisconnectMilvusClient closes and drops every cached client whose address
// matches, releasing the gRPC connection.
func DisconnectMilvusClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	milvusClientsMu.Lock()
	defer milvusClientsMu.Unlock()
	for key, client := range milvusClients {
		if strings.HasPrefix(key, target+"\x00") {
			_ = client.client.Close()
			delete(milvusClients, key)
		}
	}
	return nil
}
