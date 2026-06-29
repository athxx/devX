package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/apache/rocketmq-client-go/v2/admin"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// RocketMQ is a distributed messaging/streaming platform reached over its
// remoting protocol via the pure-Go github.com/apache/rocketmq-client-go/v2
// admin client (CGO_ENABLED=0 clean — the dead stathat.com/c/consistent
// transitive dep is redirected to its github mirror via a replace directive in
// go.mod). It has no GORM dialector and no SQL surface; the frontend speaks the
// dedicated `rocketmq` wire protocol. Topics flatten into tabular {columns,
// rows} so they render in the normal grid (the `rocketmq` connection kind maps
// to the "sql" result kind in db-transport.ts).
//
// Address is one or more comma-separated nameserver host:port endpoints.
// Username/Password feed RocketMQ ACL credentials (AccessKey/SecretKey) when
// both are set. Listing consumer groups requires a *broker* address (not a
// nameserver), which the admin API doesn't discover on its own — listGroups is
// therefore best-effort and only attempted when the request carries an explicit
// broker address in Query (else it returns an empty set rather than erroring).

const rocketmqGroupTimeout = 5 * time.Second

type rocketmqClient struct {
	admin admin.Admin
}

var (
	rocketmqClientsMu sync.Mutex
	rocketmqClients   = map[string]*rocketmqClient{}
)

// RocketMQQueryRequest is the wire payload for a RocketMQ command. A single
// request type covers every action — the connection is identified by Address (+
// credentials), Action picks the operation.
type RocketMQQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// RocketMQQueryResponse is SQL-shaped {columns, rows} so flattened topics render
// directly in the existing grid (the frontend maps the `rocketmq` kind to
// "sql").
type RocketMQQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunRocketMQQuery(ctx context.Context, request RocketMQQueryRequest, fallbackTimeout time.Duration) (RocketMQQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return RocketMQQueryResponse{}, fmt.Errorf("address is required")
	}

	client, err := getOrCreateRocketMQClient(request)
	if err != nil {
		return RocketMQQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "listTopics"
	}

	switch action {
	case "ping", "info", "listTopics", "query":
		list, err := client.admin.FetchAllTopicList(ctx)
		if err != nil {
			return RocketMQQueryResponse{}, err
		}
		topics := []string(nil)
		if list != nil {
			topics = append(topics, list.TopicList...)
		}
		sort.Strings(topics)
		if action == "ping" || action == "info" {
			return RocketMQQueryResponse{
				Result:     map[string]any{"status": "ok", "topicCount": len(topics)},
				DurationMs: time.Since(start).Milliseconds(),
			}, nil
		}
		rows := make([]map[string]any, 0, len(topics))
		for _, topic := range topics {
			rows = append(rows, map[string]any{"topic": topic})
		}
		return RocketMQQueryResponse{
			Columns:    []string{"topic"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listGroups":
		// Subscription groups live on a broker, not the nameserver. The admin API
		// has no broker discovery, so we only attempt this when the caller passes
		// an explicit broker address in Query; otherwise return an empty set.
		brokerAddr := strings.TrimSpace(request.Query)
		rows := make([]map[string]any, 0)
		if brokerAddr != "" {
			wrapper, err := client.admin.GetAllSubscriptionGroup(ctx, brokerAddr, rocketmqGroupTimeout)
			if err != nil {
				return RocketMQQueryResponse{}, err
			}
			groups := make([]string, 0, len(wrapper.SubscriptionGroupTable))
			for name := range wrapper.SubscriptionGroupTable {
				groups = append(groups, name)
			}
			sort.Strings(groups)
			for _, name := range groups {
				rows = append(rows, map[string]any{"group": name})
			}
		}
		return RocketMQQueryResponse{
			Columns:    []string{"group"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	default:
		return RocketMQQueryResponse{}, fmt.Errorf("unsupported rocketmq action: %s", action)
	}
}

func getOrCreateRocketMQClient(request RocketMQQueryRequest) (*rocketmqClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := rocketmqClientKey(address, username, request.Password)

	rocketmqClientsMu.Lock()
	defer rocketmqClientsMu.Unlock()
	if client, ok := rocketmqClients[key]; ok {
		return client, nil
	}

	nameservers := parseRocketMQNameservers(address)
	if len(nameservers) == 0 {
		return nil, fmt.Errorf("no valid rocketmq nameserver address")
	}

	opts := []admin.AdminOption{
		admin.WithResolver(primitive.NewPassthroughResolver(nameservers)),
	}
	if username != "" || request.Password != "" {
		opts = append(opts, admin.WithCredentials(primitive.Credentials{
			AccessKey: username,
			SecretKey: request.Password,
		}))
	}

	adm, err := admin.NewAdmin(opts...)
	if err != nil {
		return nil, err
	}
	client := &rocketmqClient{admin: adm}
	rocketmqClients[key] = client
	return client, nil
}

// rocketmqClientKey scopes a cached client by address + credentials so distinct
// connections never share a client (and the disconnect prefix match is precise).
func rocketmqClientKey(address, username, password string) string {
	return address + "\x00" + username + "\x00" + password
}

// parseRocketMQNameservers splits a comma-separated address list into endpoints,
// trimming, dropping empties, and sorting for a deterministic order.
func parseRocketMQNameservers(address string) []string {
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

// DisconnectRocketMQClient drops every cached client whose address matches,
// closing the underlying admin client.
func DisconnectRocketMQClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	rocketmqClientsMu.Lock()
	defer rocketmqClientsMu.Unlock()
	for key, client := range rocketmqClients {
		if strings.HasPrefix(key, target+"\x00") {
			if client.admin != nil {
				_ = client.admin.Close()
			}
			delete(rocketmqClients, key)
		}
	}
	return nil
}
