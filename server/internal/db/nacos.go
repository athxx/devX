package db

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nacos-group/nacos-sdk-go/v2/clients"
	"github.com/nacos-group/nacos-sdk-go/v2/clients/config_client"
	"github.com/nacos-group/nacos-sdk-go/v2/clients/naming_client"
	"github.com/nacos-group/nacos-sdk-go/v2/common/constant"
	"github.com/nacos-group/nacos-sdk-go/v2/vo"
)

// Nacos is a dynamic config + service-discovery registry reached over its HTTP/
// gRPC API via the pure-Go github.com/nacos-group/nacos-sdk-go/v2 client (no
// cgo). It has no GORM dialector and no SQL surface; the frontend speaks the
// dedicated `nacos` wire protocol (see the handler case in handlers/db.go).
// Configs and services are flattened into tabular {columns, rows} so they render
// in the normal grid (the `nacos` connection kind maps to the "sql" result kind
// in db-transport.ts).
//
// Auth: Address is one or more comma-separated host[:port] servers; Username/
// Password feed Nacos auth (omitted when both empty); Namespace selects the
// tenant (empty = the "public" namespace). Both a config client and a naming
// client are created lazily and cached together.

const (
	nacosDefaultPort = 8848
	nacosPageSize    = 100
)

type nacosClient struct {
	config config_client.IConfigClient
	naming naming_client.INamingClient
}

var (
	nacosClientsMu sync.Mutex
	nacosClients   = map[string]*nacosClient{}
)

// NacosQueryRequest is the wire payload for a Nacos command. A single request
// type covers every action — the connection is identified by Address (+
// credentials + namespace), Action picks the operation.
type NacosQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Namespace string `json:"namespace"`
	Action    string `json:"action"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// NacosQueryResponse is SQL-shaped {columns, rows} so flattened configs/services
// render directly in the existing grid (the frontend maps the `nacos` kind to
// "sql").
type NacosQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunNacosQuery(_ context.Context, request NacosQueryRequest, fallbackTimeout time.Duration) (NacosQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return NacosQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}

	client, err := getOrCreateNacosClient(request, timeout)
	if err != nil {
		return NacosQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "listConfigs"
	}

	switch action {
	case "ping", "info", "listServices":
		// Listing services doubles as a connectivity probe (cheap, paged).
		services, err := client.naming.GetAllServicesInfo(vo.GetAllServiceInfoParam{
			NameSpace: strings.TrimSpace(request.Namespace),
			PageNo:    1,
			PageSize:  nacosPageSize,
		})
		if err != nil {
			return NacosQueryResponse{}, err
		}
		if action == "ping" || action == "info" {
			return NacosQueryResponse{
				Result:     map[string]any{"status": "ok", "serviceCount": services.Count},
				DurationMs: time.Since(start).Milliseconds(),
			}, nil
		}
		doms := append([]string(nil), services.Doms...)
		sort.Strings(doms)
		rows := make([]map[string]any, 0, len(doms))
		for _, dom := range doms {
			rows = append(rows, map[string]any{"service": dom})
		}
		return NacosQueryResponse{
			Columns:    []string{"service"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listConfigs", "query":
		page, err := client.config.SearchConfig(vo.SearchConfigParam{
			Search:   "blur",
			DataId:   "",
			Group:    "",
			PageNo:   1,
			PageSize: nacosPageSize,
		})
		if err != nil {
			return NacosQueryResponse{}, err
		}
		rows := make([]map[string]any, 0)
		if page != nil {
			rows = make([]map[string]any, 0, len(page.PageItems))
			for _, item := range page.PageItems {
				rows = append(rows, map[string]any{
					"dataId": item.DataId,
					"group":  item.Group,
					"appName": item.Appname,
				})
			}
		}
		return NacosQueryResponse{
			Columns:    []string{"dataId", "group", "appName"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	default:
		return NacosQueryResponse{}, fmt.Errorf("unsupported nacos action: %s", action)
	}
}

func getOrCreateNacosClient(request NacosQueryRequest, timeout time.Duration) (*nacosClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	namespace := strings.TrimSpace(request.Namespace)
	key := nacosClientKey(address, username, request.Password, namespace)

	nacosClientsMu.Lock()
	defer nacosClientsMu.Unlock()
	if client, ok := nacosClients[key]; ok {
		return client, nil
	}

	serverConfigs := parseNacosServers(address)
	if len(serverConfigs) == 0 {
		return nil, fmt.Errorf("no valid nacos server address")
	}

	clientConfig := *constant.NewClientConfig(
		constant.WithNamespaceId(namespace),
		constant.WithTimeoutMs(uint64(timeout.Milliseconds())),
		constant.WithNotLoadCacheAtStart(true),
		constant.WithLogLevel("error"),
		constant.WithUsername(username),
		constant.WithPassword(request.Password),
	)

	param := vo.NacosClientParam{
		ClientConfig:  &clientConfig,
		ServerConfigs: serverConfigs,
	}

	configClient, err := clients.NewConfigClient(param)
	if err != nil {
		return nil, err
	}
	namingClient, err := clients.NewNamingClient(param)
	if err != nil {
		return nil, err
	}
	client := &nacosClient{config: configClient, naming: namingClient}
	nacosClients[key] = client
	return client, nil
}

// nacosClientKey scopes a cached client by address + credentials + namespace so
// distinct connections never share a client (and the disconnect prefix match is
// precise).
func nacosClientKey(address, username, password, namespace string) string {
	return address + "\x00" + username + "\x00" + password + "\x00" + namespace
}

// parseNacosServers splits a comma-separated address list into ServerConfigs,
// defaulting the port and dropping empties; sorted for a deterministic order.
func parseNacosServers(address string) []constant.ServerConfig {
	parts := strings.Split(address, ",")
	entries := make([]string, 0, len(parts))
	for _, part := range parts {
		entry := strings.TrimSpace(part)
		if entry != "" {
			entries = append(entries, entry)
		}
	}
	sort.Strings(entries)
	servers := make([]constant.ServerConfig, 0, len(entries))
	for _, entry := range entries {
		host, port := splitNacosHostPort(entry)
		if host == "" {
			continue
		}
		servers = append(servers, *constant.NewServerConfig(host, port))
	}
	return servers
}

// splitNacosHostPort splits "host:port" into its parts, defaulting the port to
// the Nacos default when absent or unparseable.
func splitNacosHostPort(entry string) (string, uint64) {
	idx := strings.LastIndex(entry, ":")
	if idx < 0 {
		return entry, nacosDefaultPort
	}
	host := strings.TrimSpace(entry[:idx])
	portStr := strings.TrimSpace(entry[idx+1:])
	port, err := strconv.ParseUint(portStr, 10, 64)
	if err != nil || port == 0 {
		return host, nacosDefaultPort
	}
	return host, port
}

// DisconnectNacosClient drops every cached client whose address matches,
// releasing the underlying SDK clients.
func DisconnectNacosClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	nacosClientsMu.Lock()
	defer nacosClientsMu.Unlock()
	for key, client := range nacosClients {
		if strings.HasPrefix(key, target+"\x00") {
			if client.config != nil {
				client.config.CloseClient()
			}
			if client.naming != nil {
				client.naming.CloseClient()
			}
			delete(nacosClients, key)
		}
	}
	return nil
}
