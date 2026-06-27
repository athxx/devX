package db

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"cloud.google.com/go/bigtable"
	"google.golang.org/api/option"
)

// Bigtable is a wide-column (NoSQL) store reached over gRPC via the official
// cloud.google.com/go/bigtable SDK — the first "wideColumn" data-model kind.
// It has no SQL surface and no GORM dialector; it speaks the dedicated
// `bigtable` wire protocol (see the handler case in handlers/db.go). The
// frontend's BigtableAdapter drives it off `isWideColumn()`, mirroring how
// Mongo/Redis/Elasticsearch are handled. Auth differs from every other kind:
// instead of host/port/user/pass it takes a GCP project + instance plus either
// a service-account JSON key or Application Default Credentials (ADC).

// btClientSet bundles the data client (row reads) and admin client (table /
// column-family metadata) for one project+instance, so a single cache entry
// serves both the explorer and query paths.
type btClientSet struct {
	data  *bigtable.Client
	admin *bigtable.AdminClient
}

var (
	btClientsMu sync.Mutex
	btClients   = map[string]*btClientSet{}
)

// BigtableQueryRequest is the wire payload for a Bigtable command. A single
// request type covers every action the frontend "wideColumn" adapter issues —
// the connection is identified by Project+Instance (+ optional endpoint and
// credentials), and Action picks the operation.
type BigtableQueryRequest struct {
	Project     string `json:"project"`
	Instance    string `json:"instance"`
	Endpoint    string `json:"endpoint"`    // optional override (e.g. emulator host)
	Credentials string `json:"credentials"` // optional service-account JSON; empty = ADC
	Action      string `json:"action"`
	Table       string `json:"table"`
	Prefix      string `json:"prefix"`
	RowKey      string `json:"rowKey"`
	Limit       int    `json:"limit"`
	TimeoutMs   int    `json:"timeoutMs"`
}

// BigtableQueryResponse mirrors the other non-SQL runners: a decoded result
// plus timing, so the frontend's wideColumn result variant can render it.
type BigtableQueryResponse struct {
	Result     any   `json:"result"`
	DurationMs int64 `json:"durationMs"`
}

func RunBigtableQuery(ctx context.Context, request BigtableQueryRequest, fallbackTimeout time.Duration) (BigtableQueryResponse, error) {
	if strings.TrimSpace(request.Project) == "" {
		return BigtableQueryResponse{}, fmt.Errorf("project is required")
	}
	if strings.TrimSpace(request.Instance) == "" {
		return BigtableQueryResponse{}, fmt.Errorf("instance is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	clients, err := getOrCreateBigtableClient(timeoutCtx, request)
	if err != nil {
		return BigtableQueryResponse{}, fmt.Errorf("connect bigtable: %w", err)
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "readRows"
	}

	switch action {
	case "info", "ping", "listTables":
		tables, err := clients.admin.Tables(timeoutCtx)
		if err != nil {
			return BigtableQueryResponse{}, err
		}
		return BigtableQueryResponse{
			Result:     map[string]any{"tables": tables},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "tableInfo":
		table := strings.TrimSpace(request.Table)
		if table == "" {
			return BigtableQueryResponse{}, fmt.Errorf("table is required")
		}
		info, err := clients.admin.TableInfo(timeoutCtx, table)
		if err != nil {
			return BigtableQueryResponse{}, err
		}
		families := make([]string, 0, len(info.FamilyInfos))
		for _, fam := range info.FamilyInfos {
			families = append(families, fam.Name)
		}
		return BigtableQueryResponse{
			Result: map[string]any{
				"table":    table,
				"families": families,
			},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "readRow":
		return readBigtableRow(timeoutCtx, clients.data, request, start)
	case "readRows":
		return readBigtableRows(timeoutCtx, clients.data, request, start)
	default:
		return BigtableQueryResponse{}, fmt.Errorf("unsupported bigtable action: %s", action)
	}
}

// readBigtableRow fetches a single row by exact key.
func readBigtableRow(ctx context.Context, client *bigtable.Client, request BigtableQueryRequest, start time.Time) (BigtableQueryResponse, error) {
	table := strings.TrimSpace(request.Table)
	if table == "" {
		return BigtableQueryResponse{}, fmt.Errorf("table is required")
	}
	rowKey := strings.TrimSpace(request.RowKey)
	if rowKey == "" {
		return BigtableQueryResponse{}, fmt.Errorf("rowKey is required")
	}
	tbl := client.Open(table)
	row, err := tbl.ReadRow(ctx, rowKey)
	if err != nil {
		return BigtableQueryResponse{}, err
	}
	rows := []map[string]any{}
	if len(row) > 0 {
		rows = append(rows, encodeBigtableRow(row))
	}
	return BigtableQueryResponse{
		Result:     map[string]any{"rows": rows},
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// readBigtableRows scans a contiguous range. An empty prefix scans from the
// start of the table; Limit (default 100) bounds the result set.
func readBigtableRows(ctx context.Context, client *bigtable.Client, request BigtableQueryRequest, start time.Time) (BigtableQueryResponse, error) {
	table := strings.TrimSpace(request.Table)
	if table == "" {
		return BigtableQueryResponse{}, fmt.Errorf("table is required")
	}

	limit := request.Limit
	if limit <= 0 {
		limit = 100
	}

	var rowRange bigtable.RowRange
	if prefix := strings.TrimSpace(request.Prefix); prefix != "" {
		rowRange = bigtable.PrefixRange(prefix)
	} else {
		rowRange = bigtable.InfiniteRange("")
	}

	tbl := client.Open(table)
	rows := []map[string]any{}
	err := tbl.ReadRows(ctx, rowRange, func(row bigtable.Row) bool {
		rows = append(rows, encodeBigtableRow(row))
		return true
	}, bigtable.LimitRows(int64(limit)))
	if err != nil {
		return BigtableQueryResponse{}, err
	}

	return BigtableQueryResponse{
		Result:     map[string]any{"rows": rows},
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// encodeBigtableRow flattens a Bigtable row into a JSON-friendly shape: the row
// key plus a list of cells (family / column / timestamp / value). Cell values
// are raw bytes, so we surface them as UTF-8 when valid and base64 otherwise.
func encodeBigtableRow(row bigtable.Row) map[string]any {
	cells := []map[string]any{}
	key := row.Key()
	for family, items := range row {
		for _, item := range items {
			cells = append(cells, map[string]any{
				"family":    family,
				"column":    item.Column,
				"timestamp": item.Timestamp.Time().UnixMilli(),
				"value":     encodeBigtableValue(item.Value),
			})
		}
	}
	return map[string]any{
		"rowKey": key,
		"cells":  cells,
	}
}

// encodeBigtableValue returns the cell value as a string when it is valid UTF-8,
// otherwise as a base64-encoded string prefixed so the UI can tell them apart.
func encodeBigtableValue(value []byte) string {
	if isPrintableUTF8(value) {
		return string(value)
	}
	return "base64:" + base64.StdEncoding.EncodeToString(value)
}

// isPrintableUTF8 reports whether value is valid UTF-8 with no non-text control
// bytes — i.e. safe to surface as a plain string rather than base64.
func isPrintableUTF8(value []byte) bool {
	if !utf8.Valid(value) {
		return false
	}
	for _, b := range value {
		if b < 0x09 || (b > 0x0d && b < 0x20) {
			return false
		}
	}
	return true
}

func getOrCreateBigtableClient(ctx context.Context, request BigtableQueryRequest) (*btClientSet, error) {
	key := bigtableClientKey(request)

	btClientsMu.Lock()
	clients, ok := btClients[key]
	btClientsMu.Unlock()
	if ok {
		return clients, nil
	}

	opts := []option.ClientOption{}
	if endpoint := strings.TrimSpace(request.Endpoint); endpoint != "" {
		opts = append(opts, option.WithEndpoint(endpoint))
	}
	if creds := strings.TrimSpace(request.Credentials); creds != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(creds)))
	}

	project := strings.TrimSpace(request.Project)
	instance := strings.TrimSpace(request.Instance)

	dataClient, err := bigtable.NewClient(ctx, project, instance, opts...)
	if err != nil {
		return nil, err
	}
	adminClient, err := bigtable.NewAdminClient(ctx, project, instance, opts...)
	if err != nil {
		_ = dataClient.Close()
		return nil, err
	}
	clients = &btClientSet{data: dataClient, admin: adminClient}

	btClientsMu.Lock()
	if existing, exists := btClients[key]; exists {
		btClientsMu.Unlock()
		_ = dataClient.Close()
		_ = adminClient.Close()
		return existing, nil
	}
	btClients[key] = clients
	btClientsMu.Unlock()

	return clients, nil
}

// bigtableClientKey scopes the connection cache by project + instance +
// endpoint + a hash of the credentials, so two connections to the same instance
// with different auth or endpoint do not collide.
func bigtableClientKey(request BigtableQueryRequest) string {
	credHash := ""
	if creds := strings.TrimSpace(request.Credentials); creds != "" {
		sum := sha256.Sum256([]byte(creds))
		credHash = hex.EncodeToString(sum[:8])
	}
	return strings.Join([]string{
		strings.TrimSpace(request.Project),
		strings.TrimSpace(request.Instance),
		strings.TrimSpace(request.Endpoint),
		credHash,
	}, "\x00")
}

// DisconnectBigtableClient closes and drops every cached client set whose
// project+instance matches the given identity. The frontend disconnect message
// carries "project\x00instance" in the `url` arg (see the adapter).
func DisconnectBigtableClient(identity string) error {
	target := strings.TrimSpace(identity)
	if target == "" {
		return nil
	}
	btClientsMu.Lock()
	defer btClientsMu.Unlock()
	for key, clients := range btClients {
		// key is project\x00instance\x00endpoint\x00credHash; match on the
		// project\x00instance prefix so all auth/endpoint variants are dropped.
		if key == target || strings.HasPrefix(key, target+"\x00") {
			if clients.data != nil {
				_ = clients.data.Close()
			}
			if clients.admin != nil {
				_ = clients.admin.Close()
			}
			delete(btClients, key)
		}
	}
	return nil
}
