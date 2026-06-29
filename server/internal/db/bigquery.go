package db

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// BigQuery runs GoogleSQL (Standard SQL) — so it is a relational store from the
// frontend's point of view (BigQueryAdapter reports the "sql" data-model). But
// unlike every host/port/DSN SQL kind it cannot ride the database/sql + GORM
// dialector path: its transport is REST+gRPC and its auth is a GCP project plus
// either a service-account JSON key or Application Default Credentials (ADC),
// not user/pass. It therefore speaks the dedicated `bigquery` wire protocol (see
// the handler case in handlers/db.go), reusing Bigtable's GCP auth plumbing
// (option.WithCredentialsJSON / WithEndpoint, \x00-keyed double-checked-locking
// client cache, prefix-match disconnect) while returning Milvus-style SQL-shaped
// {columns, rows} so query results render in the normal grid.
//
// Auth slots (relabelled config fields, same convention as Bigtable):
//   Project     <- config.host        (GCP project id)
//   Dataset     <- config.database    (default dataset, optional)
//   Credentials <- config.serviceName (service-account JSON; empty = ADC)
//   Location    <- config.options     (processing location / custom endpoint)

var (
	bqClientsMu sync.Mutex
	bqClients   = map[string]*bigquery.Client{}
)

// BigQueryQueryRequest is the wire payload for a BigQuery command. A single
// request type covers every action the frontend adapter issues — the connection
// is identified by Project (+ optional credentials/location), Action picks the
// operation. Dataset scopes table listing and (optionally) the query default.
type BigQueryQueryRequest struct {
	Project     string `json:"project"`
	Dataset     string `json:"dataset"`
	Credentials string `json:"credentials"` // optional service-account JSON; empty = ADC
	Location    string `json:"location"`    // optional processing location (e.g. US / EU) or endpoint
	Action      string `json:"action"`
	Query       string `json:"query"`
	Limit       int    `json:"limit"`
	TimeoutMs   int    `json:"timeoutMs"`
}

// BigQueryQueryResponse is SQL-shaped {columns, rows} so results render directly
// in the existing grid (the frontend maps `bigquery` to the "sql" result kind).
type BigQueryQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunBigQueryQuery(ctx context.Context, request BigQueryQueryRequest, fallbackTimeout time.Duration) (BigQueryQueryResponse, error) {
	if strings.TrimSpace(request.Project) == "" {
		return BigQueryQueryResponse{}, fmt.Errorf("project is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateBigQueryClient(timeoutCtx, request)
	if err != nil {
		return BigQueryQueryResponse{}, fmt.Errorf("connect bigquery: %w", err)
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "info":
		// A cheap auth round-trip: list datasets but discard them.
		if _, err := listBigQueryDatasets(timeoutCtx, client); err != nil {
			return BigQueryQueryResponse{}, err
		}
		return BigQueryQueryResponse{
			Result:     map[string]any{"ok": true},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listDatasets":
		datasets, err := listBigQueryDatasets(timeoutCtx, client)
		if err != nil {
			return BigQueryQueryResponse{}, err
		}
		rows := make([]map[string]any, 0, len(datasets))
		for _, id := range datasets {
			rows = append(rows, map[string]any{"dataset": id})
		}
		return BigQueryQueryResponse{
			Columns:    []string{"dataset"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listTables":
		dataset := strings.TrimSpace(request.Dataset)
		if dataset == "" {
			return BigQueryQueryResponse{}, fmt.Errorf("dataset is required")
		}
		tables, err := listBigQueryTables(timeoutCtx, client, dataset)
		if err != nil {
			return BigQueryQueryResponse{}, err
		}
		rows := make([]map[string]any, 0, len(tables))
		for _, id := range tables {
			rows = append(rows, map[string]any{"table": id})
		}
		return BigQueryQueryResponse{
			Columns:    []string{"table"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "query":
		return runBigQuerySQL(timeoutCtx, client, request, start)
	default:
		return BigQueryQueryResponse{}, fmt.Errorf("unsupported bigquery action: %s", action)
	}
}

// runBigQuerySQL executes a GoogleSQL statement and transposes the row iterator
// into column-ordered {columns, rows}. Column order is taken from the result
// schema (map iteration is unordered, so we cannot rely on the row map alone).
func runBigQuerySQL(ctx context.Context, client *bigquery.Client, request BigQueryQueryRequest, start time.Time) (BigQueryQueryResponse, error) {
	sql := strings.TrimSpace(request.Query)
	if sql == "" {
		return BigQueryQueryResponse{}, fmt.Errorf("query is required")
	}

	query := client.Query(sql)
	if location := strings.TrimSpace(request.Location); location != "" {
		query.Location = location
	}
	if dataset := strings.TrimSpace(request.Dataset); dataset != "" {
		// Resolve unqualified identifiers against the configured default dataset.
		query.DefaultProjectID = strings.TrimSpace(request.Project)
		query.DefaultDatasetID = dataset
	}

	it, err := query.Read(ctx)
	if err != nil {
		return BigQueryQueryResponse{}, err
	}

	limit := request.Limit
	if limit <= 0 {
		limit = 1000
	}

	rows := []map[string]any{}
	var columns []string
	for len(rows) < limit {
		var row map[string]bigquery.Value
		err := it.Next(&row)
		if err == iterator.Done {
			break
		}
		if err != nil {
			return BigQueryQueryResponse{}, err
		}
		// Schema is populated after the first Next; capture column order once.
		if columns == nil {
			columns = bigQueryColumns(it.Schema, row)
		}
		encoded := make(map[string]any, len(row))
		for key, value := range row {
			encoded[key] = encodeBigQueryValue(value)
		}
		rows = append(rows, encoded)
	}

	// DDL/DML or empty SELECTs may yield no rows and no schema; fall back to
	// reporting success with an empty grid.
	if columns == nil {
		columns = bigQueryColumns(it.Schema, nil)
	}

	return BigQueryQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// bigQueryColumns derives ordered column names from the result schema, falling
// back to the row map's keys (sorted, for determinism) when no schema is present.
func bigQueryColumns(schema bigquery.Schema, row map[string]bigquery.Value) []string {
	if len(schema) > 0 {
		columns := make([]string, len(schema))
		for i, field := range schema {
			columns[i] = field.Name
		}
		return columns
	}
	columns := make([]string, 0, len(row))
	for key := range row {
		columns = append(columns, key)
	}
	sort.Strings(columns)
	return columns
}

// encodeBigQueryValue maps a bigquery.Value into a JSON-friendly shape. Most
// scalars (string/int64/float64/bool) marshal directly; time.Time is rendered as
// RFC3339, []byte as a string, and nested STRUCT/ARRAY values recurse.
func encodeBigQueryValue(value bigquery.Value) any {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		return v.Format(time.RFC3339Nano)
	case []byte:
		return string(v)
	case []bigquery.Value:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = encodeBigQueryValue(item)
		}
		return out
	case map[string]bigquery.Value:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[key] = encodeBigQueryValue(item)
		}
		return out
	default:
		return v
	}
}

// listBigQueryDatasets enumerates dataset IDs in the client's project.
func listBigQueryDatasets(ctx context.Context, client *bigquery.Client) ([]string, error) {
	it := client.Datasets(ctx)
	datasets := []string{}
	for {
		dataset, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		datasets = append(datasets, dataset.DatasetID)
	}
	return datasets, nil
}

// listBigQueryTables enumerates table IDs in the given dataset.
func listBigQueryTables(ctx context.Context, client *bigquery.Client, dataset string) ([]string, error) {
	it := client.Dataset(dataset).Tables(ctx)
	tables := []string{}
	for {
		table, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		tables = append(tables, table.TableID)
	}
	return tables, nil
}

func getOrCreateBigQueryClient(ctx context.Context, request BigQueryQueryRequest) (*bigquery.Client, error) {
	key := bigQueryClientKey(request)

	bqClientsMu.Lock()
	client, ok := bqClients[key]
	bqClientsMu.Unlock()
	if ok {
		return client, nil
	}

	opts := []option.ClientOption{}
	if endpoint := strings.TrimSpace(request.Location); endpoint != "" && strings.Contains(endpoint, "://") {
		// A scheme-bearing Location is treated as a custom endpoint (e.g. an
		// emulator); a bare token (US / EU) is a processing location applied per
		// query in runBigQuerySQL instead.
		opts = append(opts, option.WithEndpoint(endpoint))
	}
	if creds := strings.TrimSpace(request.Credentials); creds != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(creds)))
	}

	project := strings.TrimSpace(request.Project)
	created, err := bigquery.NewClient(ctx, project, opts...)
	if err != nil {
		return nil, err
	}

	bqClientsMu.Lock()
	if existing, exists := bqClients[key]; exists {
		bqClientsMu.Unlock()
		_ = created.Close()
		return existing, nil
	}
	bqClients[key] = created
	bqClientsMu.Unlock()

	return created, nil
}

// bigQueryClientKey scopes the connection cache by project + a hash of the
// credentials, so two connections to the same project with different auth do not
// collide. Dataset/location are query-time parameters, not client-construction
// inputs, so they are not part of the key (except a custom endpoint, folded into
// the cred hash domain via the project being the stable identity).
func bigQueryClientKey(request BigQueryQueryRequest) string {
	credHash := ""
	if creds := strings.TrimSpace(request.Credentials); creds != "" {
		sum := sha256.Sum256([]byte(creds))
		credHash = hex.EncodeToString(sum[:8])
	}
	endpoint := ""
	if loc := strings.TrimSpace(request.Location); strings.Contains(loc, "://") {
		endpoint = loc
	}
	return strings.Join([]string{
		strings.TrimSpace(request.Project),
		endpoint,
		credHash,
	}, "\x00")
}

// DisconnectBigQueryClient closes and drops every cached client whose project
// matches the given identity. The frontend disconnect message carries
// "project\x00dataset" in the `url` arg; we match on the project prefix so all
// dataset/auth variants are dropped.
func DisconnectBigQueryClient(identity string) error {
	target := strings.TrimSpace(identity)
	if target == "" {
		return nil
	}
	// The url arg is "project\x00dataset"; the cache key is
	// "project\x00endpoint\x00credHash". Match on the project segment.
	project := target
	if idx := strings.IndexByte(target, '\x00'); idx >= 0 {
		project = target[:idx]
	}
	if project == "" {
		return nil
	}

	bqClientsMu.Lock()
	defer bqClientsMu.Unlock()
	for key, client := range bqClients {
		keyProject := key
		if idx := strings.IndexByte(key, '\x00'); idx >= 0 {
			keyProject = key[:idx]
		}
		if keyProject == project {
			if client != nil {
				_ = client.Close()
			}
			delete(bqClients, key)
		}
	}
	return nil
}
