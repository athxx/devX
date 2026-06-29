package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

// etcd is a distributed key/value store reached over its gRPC API via the
// official pure-Go client (go.etcd.io/etcd/client/v3, no cgo). It has no GORM
// dialector and no SQL surface; the frontend speaks the dedicated `etcd` wire
// protocol (see the handler case in handlers/db.go). Key/value pairs are
// flattened into tabular {columns, rows} so they render in the normal grid (the
// `etcd` connection kind maps to the "sql" result kind in db-transport.ts).
//
// Auth: Address is one or more comma-separated host[:port] endpoints; Username/
// Password feed etcd's RBAC auth (omitted when both empty). A query is treated as
// a key prefix to range over (empty prefix = whole keyspace).

type etcdClient struct {
	cli *clientv3.Client
}

var (
	etcdClientsMu sync.Mutex
	etcdClients   = map[string]*etcdClient{}
)

// EtcdQueryRequest is the wire payload for an etcd command. A single request type
// covers every action the frontend issues — the connection is identified by
// Address (+ credentials), Action picks the operation.
type EtcdQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Key       string `json:"key"`
	Prefix    string `json:"prefix"`
	Query     string `json:"query"`
	Limit     int64  `json:"limit"`
	TimeoutMs int    `json:"timeoutMs"`
}

// EtcdQueryResponse is SQL-shaped {columns, rows} so flattened pairs render
// directly in the existing grid (the frontend maps the `etcd` kind to "sql").
type EtcdQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunEtcdQuery(ctx context.Context, request EtcdQueryRequest, fallbackTimeout time.Duration) (EtcdQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return EtcdQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateEtcdClient(request, timeout)
	if err != nil {
		return EtcdQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "query"
	}

	switch action {
	case "ping", "info":
		// Status against the first endpoint is a cheap connectivity probe.
		endpoints := client.cli.Endpoints()
		if len(endpoints) == 0 {
			return EtcdQueryResponse{}, fmt.Errorf("no endpoints configured")
		}
		status, err := client.cli.Status(timeoutCtx, endpoints[0])
		if err != nil {
			return EtcdQueryResponse{}, err
		}
		return EtcdQueryResponse{
			Result: map[string]any{
				"version": status.Version,
				"dbSize":  status.DbSize,
				"leader":  status.Leader,
			},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listKeys", "query":
		// Range over a prefix (empty = whole keyspace) and flatten to rows.
		prefix := strings.TrimSpace(request.Prefix)
		if prefix == "" {
			prefix = strings.TrimSpace(request.Query)
		}
		opts := []clientv3.OpOption{clientv3.WithPrefix(), clientv3.WithSort(clientv3.SortByKey, clientv3.SortAscend)}
		if request.Limit > 0 {
			opts = append(opts, clientv3.WithLimit(request.Limit))
		}
		resp, err := client.cli.Get(timeoutCtx, prefix, opts...)
		if err != nil {
			return EtcdQueryResponse{}, err
		}
		return etcdKvResponse(resp, start), nil
	case "get":
		key := strings.TrimSpace(request.Key)
		if key == "" {
			return EtcdQueryResponse{}, fmt.Errorf("key is required")
		}
		resp, err := client.cli.Get(timeoutCtx, key)
		if err != nil {
			return EtcdQueryResponse{}, err
		}
		return etcdKvResponse(resp, start), nil
	default:
		return EtcdQueryResponse{}, fmt.Errorf("unsupported etcd action: %s", action)
	}
}

// etcdKvResponse flattens a Get response into {key, value, version} rows with a
// stable column order.
func etcdKvResponse(resp *clientv3.GetResponse, start time.Time) EtcdQueryResponse {
	rows := make([]map[string]any, 0, len(resp.Kvs))
	for _, kv := range resp.Kvs {
		rows = append(rows, map[string]any{
			"key":     string(kv.Key),
			"value":   string(kv.Value),
			"version": kv.Version,
		})
	}
	return EtcdQueryResponse{
		Columns:    []string{"key", "value", "version"},
		Rows:       rows,
		DurationMs: time.Since(start).Milliseconds(),
	}
}

func getOrCreateEtcdClient(request EtcdQueryRequest, timeout time.Duration) (*etcdClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := etcdClientKey(address, username, request.Password)

	etcdClientsMu.Lock()
	defer etcdClientsMu.Unlock()
	if client, ok := etcdClients[key]; ok {
		return client, nil
	}

	cfg := clientv3.Config{
		Endpoints:   parseEtcdEndpoints(address),
		DialTimeout: timeout,
	}
	if username != "" || request.Password != "" {
		cfg.Username = username
		cfg.Password = request.Password
	}

	cli, err := clientv3.New(cfg)
	if err != nil {
		return nil, err
	}
	client := &etcdClient{cli: cli}
	etcdClients[key] = client
	return client, nil
}

// etcdClientKey scopes a cached client by address + credentials so distinct
// connections never share a client (and the disconnect prefix match is precise).
func etcdClientKey(address, username, password string) string {
	return address + "\x00" + username + "\x00" + password
}

// parseEtcdEndpoints splits a comma-separated address list into trimmed
// endpoints, dropping empties.
func parseEtcdEndpoints(address string) []string {
	parts := strings.Split(address, ",")
	endpoints := make([]string, 0, len(parts))
	for _, part := range parts {
		entry := strings.TrimSpace(part)
		if entry != "" {
			endpoints = append(endpoints, entry)
		}
	}
	sort.Strings(endpoints)
	return endpoints
}

// DisconnectEtcdClient closes and drops every cached client whose address
// matches, releasing the gRPC connection.
func DisconnectEtcdClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	etcdClientsMu.Lock()
	defer etcdClientsMu.Unlock()
	for key, client := range etcdClients {
		if strings.HasPrefix(key, target+"\x00") {
			_ = client.cli.Close()
			delete(etcdClients, key)
		}
	}
	return nil
}
