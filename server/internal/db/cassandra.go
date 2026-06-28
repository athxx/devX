package db

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocql/gocql"
)

// Cassandra is a wide-column store reached over the native CQL binary protocol
// via gocql (pure-Go, no cgo). It has no GORM dialector; it speaks the dedicated
// `cassandra` wire protocol (see the handler case in handlers/db.go). CQL queries
// return rows that are flattened into tabular {columns, rows} so they render in
// the normal grid (the `cassandra` connection kind maps to the "sql" result kind
// in db-transport.ts). Composite/collection values are JSON-encoded per cell.
//
// Auth: Address is one or more comma-separated host[:port] entries; Username/
// Password feed PasswordAuthenticator (omitted when both empty). Keyspace selects
// the active keyspace (analogous to a database).

type cassandraClient struct {
	session *gocql.Session
}

var (
	cassandraClientsMu sync.Mutex
	cassandraClients   = map[string]*cassandraClient{}
)

// CassandraQueryRequest is the wire payload for a Cassandra command. A single
// request type covers every action the frontend adapter issues — the connection
// is identified by Address (+ credentials + keyspace), Action picks the operation.
type CassandraQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Keyspace  string `json:"keyspace"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// CassandraQueryResponse is SQL-shaped {columns, rows} so flattened rows render
// directly in the existing grid (the frontend maps the `cassandra` kind to "sql").
type CassandraQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunCassandraQuery(ctx context.Context, request CassandraQueryRequest, fallbackTimeout time.Duration) (CassandraQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return CassandraQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateCassandraClient(request, timeout)
	if err != nil {
		return CassandraQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "info":
		// A trivial CQL round-trip confirms connectivity.
		return runCassandraCQL(timeoutCtx, client, "SELECT release_version FROM system.local", start)
	case "listKeyspaces":
		return runCassandraCQL(timeoutCtx, client, "SELECT keyspace_name FROM system_schema.keyspaces", start)
	case "listTables":
		keyspace := strings.TrimSpace(request.Keyspace)
		if keyspace == "" {
			return CassandraQueryResponse{}, fmt.Errorf("keyspace is required to list tables")
		}
		cql := fmt.Sprintf(
			"SELECT table_name FROM system_schema.tables WHERE keyspace_name = '%s'",
			escapeCassandraLiteral(keyspace),
		)
		return runCassandraCQL(timeoutCtx, client, cql, start)
	case "query":
		cql := strings.TrimSpace(request.Query)
		if cql == "" {
			return CassandraQueryResponse{}, fmt.Errorf("query is required")
		}
		return runCassandraCQL(timeoutCtx, client, cql, start)
	default:
		return CassandraQueryResponse{}, fmt.Errorf("unsupported cassandra action: %s", action)
	}
}

// runCassandraCQL executes a single statement and flattens the row stream into
// tabular rows. SELECTs yield columns+rows; non-SELECTs yield an {ok:true} result.
func runCassandraCQL(ctx context.Context, client *cassandraClient, cql string, start time.Time) (CassandraQueryResponse, error) {
	iter := client.session.Query(cql).WithContext(ctx).Iter()

	infos := iter.Columns()
	if len(infos) == 0 {
		// Non-row-returning statement (INSERT/UPDATE/DDL).
		if err := iter.Close(); err != nil {
			return CassandraQueryResponse{}, err
		}
		return CassandraQueryResponse{
			Result:     map[string]any{"ok": true},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	}

	columns := make([]string, 0, len(infos))
	for _, info := range infos {
		columns = append(columns, info.Name)
	}

	maps, err := iter.SliceMap()
	if err != nil {
		_ = iter.Close()
		return CassandraQueryResponse{}, err
	}
	if err := iter.Close(); err != nil {
		return CassandraQueryResponse{}, err
	}

	columns, rows := flattenCassandraRows(columns, maps)
	return CassandraQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// flattenCassandraRows normalizes gocql's []map[string]any rows: the column order
// follows the query's declared columns, with any extra keys appended sorted, and
// each value is reduced to a grid-friendly scalar.
func flattenCassandraRows(columns []string, maps []map[string]any) ([]string, []map[string]any) {
	seen := map[string]struct{}{}
	for _, name := range columns {
		seen[name] = struct{}{}
	}
	extra := map[string]struct{}{}

	rows := make([]map[string]any, 0, len(maps))
	for _, raw := range maps {
		row := map[string]any{}
		for key, value := range raw {
			if _, ok := seen[key]; !ok {
				extra[key] = struct{}{}
			}
			row[key] = cassandraScalar(value)
		}
		rows = append(rows, row)
	}

	if len(extra) > 0 {
		extraKeys := make([]string, 0, len(extra))
		for key := range extra {
			extraKeys = append(extraKeys, key)
		}
		sort.Strings(extraKeys)
		columns = append(columns, extraKeys...)
	}

	return columns, rows
}

// cassandraScalar keeps simple scalar values as-is and JSON-encodes composite
// values (lists, sets, maps, UDTs, tuples, blobs) so they fit a single grid cell.
func cassandraScalar(value any) any {
	switch v := value.(type) {
	case nil, bool, int, int8, int16, int32, int64,
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

// escapeCassandraLiteral doubles single quotes for safe embedding in a CQL string
// literal (keyspace names are simple identifiers, but stay defensive).
func escapeCassandraLiteral(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func getOrCreateCassandraClient(request CassandraQueryRequest, timeout time.Duration) (*cassandraClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	keyspace := strings.TrimSpace(request.Keyspace)
	key := address + "\x00" + keyspace + "\x00" + username + "\x00" + request.Password

	cassandraClientsMu.Lock()
	defer cassandraClientsMu.Unlock()
	if client, ok := cassandraClients[key]; ok {
		return client, nil
	}

	hosts, port := parseCassandraHosts(address)
	cluster := gocql.NewCluster(hosts...)
	if port > 0 {
		cluster.Port = port
	}
	if keyspace != "" {
		cluster.Keyspace = keyspace
	}
	if username != "" || request.Password != "" {
		cluster.Authenticator = gocql.PasswordAuthenticator{
			Username: username,
			Password: request.Password,
		}
	}
	if timeout > 0 {
		cluster.Timeout = timeout
		cluster.ConnectTimeout = timeout
	}

	session, err := cluster.CreateSession()
	if err != nil {
		return nil, err
	}
	client := &cassandraClient{session: session}
	cassandraClients[key] = client
	return client, nil
}

// parseCassandraHosts splits a comma-separated address list into bare hosts plus
// a single shared port (taken from the first host:port seen). gocql wants hosts
// without ports and one cluster-wide Port.
func parseCassandraHosts(address string) ([]string, int) {
	parts := strings.Split(address, ",")
	hosts := make([]string, 0, len(parts))
	port := 0
	for _, part := range parts {
		entry := strings.TrimSpace(part)
		if entry == "" {
			continue
		}
		if host, rawPort, ok := splitHostPort(entry); ok {
			hosts = append(hosts, host)
			if port == 0 {
				if parsed, err := strconv.Atoi(rawPort); err == nil {
					port = parsed
				}
			}
		} else {
			hosts = append(hosts, entry)
		}
	}
	return hosts, port
}

// splitHostPort splits "host:port" without pulling in net.SplitHostPort's strict
// error semantics; returns ok=false when there is no ':' separator.
func splitHostPort(entry string) (host, port string, ok bool) {
	idx := strings.LastIndex(entry, ":")
	if idx < 0 {
		return entry, "", false
	}
	return entry[:idx], entry[idx+1:], true
}

// DisconnectCassandraClient closes and drops every cached session whose address
// matches, releasing the connection pool.
func DisconnectCassandraClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	cassandraClientsMu.Lock()
	defer cassandraClientsMu.Unlock()
	for key, client := range cassandraClients {
		if strings.HasPrefix(key, target+"\x00") {
			client.session.Close()
			delete(cassandraClients, key)
		}
	}
	return nil
}
