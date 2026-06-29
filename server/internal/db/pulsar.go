package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/apache/pulsar-client-go/pulsaradmin"
	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/admin/config"
)

// Pulsar is a distributed messaging/streaming platform administered over its
// HTTP admin REST API via the pure-Go github.com/apache/pulsar-client-go
// pulsaradmin client (CGO_ENABLED=0 clean). It has no GORM dialector and no SQL
// surface; the frontend speaks the dedicated `pulsar` wire protocol. Tenants,
// namespaces, and topics flatten into tabular {columns, rows} so they render in
// the normal grid (the `pulsar` connection kind maps to the "sql" result kind in
// db-transport.ts).
//
// Address is the admin HTTP service (default port 8080, NOT the 6650 binary
// protocol port). The runner composes a WebServiceURL of the form
// http://host:port. Token (carried in Password) feeds bearer auth when set.
// Actions:
//   - ping / listTenants: Tenants().ListWithContext
//   - listNamespaces:    Namespaces().GetNamespacesWithContext(tenant) — tenant
//     in Query; empty Query enumerates namespaces across all tenants
//   - listTopics:        Namespaces().GetTopicsWithContext(namespace) — the
//     fully-qualified "tenant/namespace" in Query

type pulsarClient struct {
	admin pulsaradmin.Client
}

var (
	pulsarClientsMu sync.Mutex
	pulsarClients   = map[string]*pulsarClient{}
)

// PulsarQueryRequest is the wire payload for a Pulsar command. A single request
// type covers every action — the connection is identified by Address (+ token),
// Action picks the operation, Query carries the tenant/namespace scope.
type PulsarQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// PulsarQueryResponse is SQL-shaped {columns, rows} so flattened tenants/
// namespaces/topics render directly in the existing grid (the frontend maps the
// `pulsar` kind to "sql").
type PulsarQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunPulsarQuery(ctx context.Context, request PulsarQueryRequest, _ time.Duration) (PulsarQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return PulsarQueryResponse{}, fmt.Errorf("address is required")
	}

	client, err := getOrCreatePulsarClient(request)
	if err != nil {
		return PulsarQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "listTenants"
	}
	scope := strings.TrimSpace(request.Query)

	switch action {
	case "ping", "info", "listTenants", "query":
		tenants, err := client.admin.Tenants().ListWithContext(ctx)
		if err != nil {
			return PulsarQueryResponse{}, err
		}
		sort.Strings(tenants)
		if action == "ping" || action == "info" {
			return PulsarQueryResponse{
				Result:     map[string]any{"status": "ok", "tenantCount": len(tenants)},
				DurationMs: time.Since(start).Milliseconds(),
			}, nil
		}
		rows := make([]map[string]any, 0, len(tenants))
		for _, tenant := range tenants {
			rows = append(rows, map[string]any{"tenant": tenant})
		}
		return PulsarQueryResponse{
			Columns:    []string{"tenant"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listNamespaces":
		namespaces, err := pulsarNamespaces(ctx, client, scope)
		if err != nil {
			return PulsarQueryResponse{}, err
		}
		sort.Strings(namespaces)
		rows := make([]map[string]any, 0, len(namespaces))
		for _, ns := range namespaces {
			rows = append(rows, map[string]any{"namespace": ns})
		}
		return PulsarQueryResponse{
			Columns:    []string{"namespace"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listTopics":
		if scope == "" {
			return PulsarQueryResponse{}, fmt.Errorf("listTopics requires a tenant/namespace")
		}
		topics, err := client.admin.Namespaces().GetTopicsWithContext(ctx, scope)
		if err != nil {
			return PulsarQueryResponse{}, err
		}
		sort.Strings(topics)
		rows := make([]map[string]any, 0, len(topics))
		for _, topic := range topics {
			rows = append(rows, map[string]any{"topic": topic})
		}
		return PulsarQueryResponse{
			Columns:    []string{"topic"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	default:
		return PulsarQueryResponse{}, fmt.Errorf("unsupported pulsar action: %s", action)
	}
}

// pulsarNamespaces returns namespaces for a single tenant when scope names one,
// otherwise enumerates namespaces across every tenant (each fully-qualified
// "tenant/namespace"). A per-tenant error is skipped so one inaccessible tenant
// doesn't fail the whole listing.
func pulsarNamespaces(ctx context.Context, client *pulsarClient, scope string) ([]string, error) {
	if scope != "" {
		return client.admin.Namespaces().GetNamespacesWithContext(ctx, scope)
	}
	tenants, err := client.admin.Tenants().ListWithContext(ctx)
	if err != nil {
		return nil, err
	}
	var all []string
	for _, tenant := range tenants {
		namespaces, err := client.admin.Namespaces().GetNamespacesWithContext(ctx, tenant)
		if err != nil {
			continue
		}
		all = append(all, namespaces...)
	}
	return all, nil
}

func getOrCreatePulsarClient(request PulsarQueryRequest) (*pulsarClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := pulsarClientKey(address, username, request.Password)

	pulsarClientsMu.Lock()
	defer pulsarClientsMu.Unlock()
	if client, ok := pulsarClients[key]; ok {
		return client, nil
	}

	cfg := &config.Config{
		WebServiceURL: normalizePulsarWebURL(address),
	}
	// A token (carried in Password) feeds bearer auth; left blank for an
	// unauthenticated cluster.
	if token := strings.TrimSpace(request.Password); token != "" {
		cfg.Token = token
	}

	adm, err := pulsaradmin.NewClient(cfg)
	if err != nil {
		return nil, err
	}
	client := &pulsarClient{admin: adm}
	pulsarClients[key] = client
	return client, nil
}

// pulsarClientKey scopes a cached client by address + credentials so distinct
// connections never share a client (and the disconnect prefix match is precise).
func pulsarClientKey(address, username, password string) string {
	return address + "\x00" + username + "\x00" + password
}

// normalizePulsarWebURL turns a bare host:port (or host) into an http:// admin
// service URL, defaulting the port to 8080. An address that already carries a
// scheme is passed through verbatim.
func normalizePulsarWebURL(address string) string {
	addr := strings.TrimSpace(address)
	if addr == "" {
		return addr
	}
	if strings.Contains(addr, "://") {
		return addr
	}
	if !strings.Contains(addr, ":") {
		addr += ":8080"
	}
	return "http://" + addr
}

// DisconnectPulsarClient drops every cached client whose address matches. The
// pulsaradmin client holds no persistent connection, so dropping the cache entry
// is sufficient.
func DisconnectPulsarClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	pulsarClientsMu.Lock()
	defer pulsarClientsMu.Unlock()
	for key := range pulsarClients {
		if strings.HasPrefix(key, target+"\x00") {
			delete(pulsarClients, key)
		}
	}
	return nil
}
