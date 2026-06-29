package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-zookeeper/zk"
)

// ZooKeeper is a hierarchical key/value (znode) store reached over its own TCP
// protocol via the pure-Go github.com/go-zookeeper/zk client (no cgo). It has no
// GORM dialector and no SQL surface; the frontend speaks the dedicated
// `zookeeper` wire protocol (see the handler case in handlers/db.go). Znodes are
// flattened into tabular {columns, rows} so they render in the normal grid (the
// `zookeeper` connection kind maps to the "sql" result kind in db-transport.ts).
//
// Auth: Address is one or more comma-separated host[:port] endpoints; Username/
// Password feed ZooKeeper's digest ACL auth (`AddAuth("digest", user:password)`),
// omitted when both empty. A query is treated as the parent znode path to list
// children of (empty = root "/").

type zookeeperClient struct {
	conn *zk.Conn
}

var (
	zookeeperClientsMu sync.Mutex
	zookeeperClients   = map[string]*zookeeperClient{}
)

// ZookeeperQueryRequest is the wire payload for a ZooKeeper command. A single
// request type covers every action — the connection is identified by Address (+
// credentials), Action picks the operation.
type ZookeeperQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Path      string `json:"path"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// ZookeeperQueryResponse is SQL-shaped {columns, rows} so flattened znodes render
// directly in the existing grid (the frontend maps the `zookeeper` kind to "sql").
type ZookeeperQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunZookeeperQuery(ctx context.Context, request ZookeeperQueryRequest, fallbackTimeout time.Duration) (ZookeeperQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return ZookeeperQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}

	client, err := getOrCreateZookeeperClient(request, timeout)
	if err != nil {
		return ZookeeperQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "listChildren"
	}

	switch action {
	case "ping", "info":
		// Reading the root's children is a cheap connectivity probe.
		_, stat, err := client.conn.Children("/")
		if err != nil {
			return ZookeeperQueryResponse{}, err
		}
		return ZookeeperQueryResponse{
			Result: map[string]any{
				"server":         client.conn.Server(),
				"state":          client.conn.State().String(),
				"rootNumChildren": stat.NumChildren,
			},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listChildren", "query":
		// List the children of a parent znode (empty = root) and flatten to rows.
		path := normalizeZookeeperPath(firstNonEmpty(request.Path, request.Query))
		children, _, err := client.conn.Children(path)
		if err != nil {
			return ZookeeperQueryResponse{}, err
		}
		sort.Strings(children)
		rows := make([]map[string]any, 0, len(children))
		for _, child := range children {
			full := joinZookeeperPath(path, child)
			_, stat, err := client.conn.Exists(full)
			numChildren := int32(0)
			dataLen := int32(0)
			version := int32(0)
			if err == nil && stat != nil {
				numChildren = stat.NumChildren
				dataLen = stat.DataLength
				version = stat.Version
			}
			rows = append(rows, map[string]any{
				"path":        full,
				"name":        child,
				"numChildren": numChildren,
				"dataLength":  dataLen,
				"version":     version,
			})
		}
		return ZookeeperQueryResponse{
			Columns:    []string{"path", "name", "numChildren", "dataLength", "version"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "get":
		path := normalizeZookeeperPath(firstNonEmpty(request.Path, request.Query))
		data, stat, err := client.conn.Get(path)
		if err != nil {
			return ZookeeperQueryResponse{}, err
		}
		version := int32(0)
		if stat != nil {
			version = stat.Version
		}
		return ZookeeperQueryResponse{
			Columns: []string{"path", "data", "version"},
			Rows: []map[string]any{{
				"path":    path,
				"data":    string(data),
				"version": version,
			}},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	default:
		return ZookeeperQueryResponse{}, fmt.Errorf("unsupported zookeeper action: %s", action)
	}
}

func getOrCreateZookeeperClient(request ZookeeperQueryRequest, timeout time.Duration) (*zookeeperClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := zookeeperClientKey(address, username, request.Password)

	zookeeperClientsMu.Lock()
	defer zookeeperClientsMu.Unlock()
	if client, ok := zookeeperClients[key]; ok {
		return client, nil
	}

	conn, _, err := zk.Connect(parseZookeeperServers(address), timeout)
	if err != nil {
		return nil, err
	}
	if username != "" || request.Password != "" {
		if err := conn.AddAuth("digest", []byte(username+":"+request.Password)); err != nil {
			conn.Close()
			return nil, err
		}
	}
	client := &zookeeperClient{conn: conn}
	zookeeperClients[key] = client
	return client, nil
}

// zookeeperClientKey scopes a cached client by address + credentials so distinct
// connections never share a client (and the disconnect prefix match is precise).
func zookeeperClientKey(address, username, password string) string {
	return address + "\x00" + username + "\x00" + password
}

// parseZookeeperServers splits a comma-separated address list into trimmed
// host[:port] servers, dropping empties.
func parseZookeeperServers(address string) []string {
	parts := strings.Split(address, ",")
	servers := make([]string, 0, len(parts))
	for _, part := range parts {
		entry := strings.TrimSpace(part)
		if entry != "" {
			servers = append(servers, entry)
		}
	}
	sort.Strings(servers)
	return servers
}

// normalizeZookeeperPath defaults to the root and guarantees a leading slash.
func normalizeZookeeperPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		return "/" + path
	}
	return path
}

// joinZookeeperPath appends a child name to a parent path, collapsing the
// root's trailing slash so "/" + "a" yields "/a" rather than "//a".
func joinZookeeperPath(parent, child string) string {
	if parent == "/" {
		return "/" + child
	}
	return parent + "/" + child
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// DisconnectZookeeperClient closes and drops every cached client whose address
// matches, releasing the TCP connection.
func DisconnectZookeeperClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	zookeeperClientsMu.Lock()
	defer zookeeperClientsMu.Unlock()
	for key, client := range zookeeperClients {
		if strings.HasPrefix(key, target+"\x00") {
			client.conn.Close()
			delete(zookeeperClients, key)
		}
	}
	return nil
}
