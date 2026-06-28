package db

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// Neo4j is a graph database reached over the Bolt protocol via the official
// pure-Go driver (no cgo). It has no SQL surface and no GORM dialector; it speaks
// the dedicated `neo4j` wire protocol (see the handler case in handlers/db.go).
// Cypher queries return records that are flattened into tabular {columns, rows}
// so they render in the normal grid (the `neo4j` connection kind maps to the
// "sql" result kind in db-transport.ts). Node/Relationship/Path values are
// JSON-encoded into their cell.
//
// Auth: the address is a Bolt URI (bolt://host:port); username/password feed
// BasicAuth. The database name selects the target DB (Neo4j 4+ multi-db).

type neo4jClient struct {
	driver neo4j.DriverWithContext
}

var (
	neo4jClientsMu sync.Mutex
	neo4jClients   = map[string]*neo4jClient{}
)

// Neo4jQueryRequest is the wire payload for a Neo4j command. A single request
// type covers every action the frontend adapter issues — the connection is
// identified by Address (+ credentials), and Action picks the operation.
type Neo4jQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Database  string `json:"database"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// Neo4jQueryResponse is SQL-shaped {columns, rows} so flattened records render
// directly in the existing grid (the frontend maps the `neo4j` kind to "sql").
type Neo4jQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunNeo4jQuery(ctx context.Context, request Neo4jQueryRequest, fallbackTimeout time.Duration) (Neo4jQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return Neo4jQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateNeo4jClient(request)
	if err != nil {
		return Neo4jQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "info":
		if err := client.driver.VerifyConnectivity(timeoutCtx); err != nil {
			return Neo4jQueryResponse{}, err
		}
		return Neo4jQueryResponse{Result: map[string]any{"ok": true}, DurationMs: time.Since(start).Milliseconds()}, nil
	case "listLabels":
		return runNeo4jCypher(timeoutCtx, client, request, "CALL db.labels() YIELD label RETURN label ORDER BY label", start)
	case "listRelationshipTypes":
		return runNeo4jCypher(timeoutCtx, client, request, "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType", start)
	case "listDatabases":
		// SHOW DATABASES runs against the system database regardless of selection.
		return runNeo4jCypherOn(timeoutCtx, client, "system", "SHOW DATABASES YIELD name RETURN name ORDER BY name", start)
	case "query":
		cypher := strings.TrimSpace(request.Query)
		if cypher == "" {
			return Neo4jQueryResponse{}, fmt.Errorf("query is required")
		}
		return runNeo4jCypher(timeoutCtx, client, request, cypher, start)
	default:
		return Neo4jQueryResponse{}, fmt.Errorf("unsupported neo4j action: %s", action)
	}
}

// runNeo4jCypher runs a Cypher statement against the request's selected database.
func runNeo4jCypher(ctx context.Context, client *neo4jClient, request Neo4jQueryRequest, cypher string, start time.Time) (Neo4jQueryResponse, error) {
	return runNeo4jCypherOn(ctx, client, strings.TrimSpace(request.Database), cypher, start)
}

// runNeo4jCypherOn opens a session on the given database (empty → default) and
// runs the statement, flattening the record stream into tabular rows.
func runNeo4jCypherOn(ctx context.Context, client *neo4jClient, database, cypher string, start time.Time) (Neo4jQueryResponse, error) {
	sessionConfig := neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead}
	if database != "" {
		sessionConfig.DatabaseName = database
	}
	session := client.driver.NewSession(ctx, sessionConfig)
	defer session.Close(ctx)

	result, err := session.Run(ctx, cypher, nil)
	if err != nil {
		return Neo4jQueryResponse{}, err
	}

	records, err := result.Collect(ctx)
	if err != nil {
		return Neo4jQueryResponse{}, err
	}

	columns, rows := flattenNeo4jRecords(records)
	return Neo4jQueryResponse{
		Columns:    columns,
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// flattenNeo4jRecords turns Cypher records into tabular rows. Column order
// follows the first record's keys, then any extra keys (union) appended sorted.
// Node/Relationship/Path and other composite values are JSON-encoded per cell.
func flattenNeo4jRecords(records []*neo4j.Record) ([]string, []map[string]any) {
	var columns []string
	seen := map[string]struct{}{}
	extra := map[string]struct{}{}

	rows := make([]map[string]any, 0, len(records))
	for i, record := range records {
		if i == 0 {
			columns = append(columns, record.Keys...)
			for _, key := range record.Keys {
				seen[key] = struct{}{}
			}
		}
		row := map[string]any{}
		for idx, key := range record.Keys {
			if _, ok := seen[key]; !ok {
				extra[key] = struct{}{}
			}
			if idx < len(record.Values) {
				row[key] = neo4jScalar(record.Values[idx])
			}
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

// neo4jScalar keeps driver scalar values as-is and JSON-encodes graph entities
// (Node, Relationship, Path) and collections so they fit a single grid cell.
func neo4jScalar(value any) any {
	switch v := value.(type) {
	case nil, bool, int64, float64, string:
		return v
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(encoded)
	}
}

func getOrCreateNeo4jClient(request Neo4jQueryRequest) (*neo4jClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := address + "\x00" + username + "\x00" + request.Password

	neo4jClientsMu.Lock()
	defer neo4jClientsMu.Unlock()
	if client, ok := neo4jClients[key]; ok {
		return client, nil
	}

	var auth neo4j.AuthToken
	if username == "" && request.Password == "" {
		auth = neo4j.NoAuth()
	} else {
		auth = neo4j.BasicAuth(username, request.Password, "")
	}

	driver, err := neo4j.NewDriverWithContext(address, auth)
	if err != nil {
		return nil, err
	}
	client := &neo4jClient{driver: driver}
	neo4jClients[key] = client
	return client, nil
}

// DisconnectNeo4jClient closes and drops every cached driver whose Bolt address
// matches, releasing the connection pool.
func DisconnectNeo4jClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	neo4jClientsMu.Lock()
	defer neo4jClientsMu.Unlock()
	for key, client := range neo4jClients {
		if strings.HasPrefix(key, target+"\x00") {
			_ = client.driver.Close(context.Background())
			delete(neo4jClients, key)
		}
	}
	return nil
}
