package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

// Kafka is a distributed event-streaming platform reached over its own binary
// protocol via the pure-Go github.com/twmb/franz-go client (kgo + the kadm admin
// helper, no cgo). It has no GORM dialector and no SQL surface; the frontend
// speaks the dedicated `kafka` wire protocol (see the handler case in
// handlers/db.go). Topics and consumer groups are flattened into tabular
// {columns, rows} so they render in the normal grid (the `kafka` connection kind
// maps to the "sql" result kind in db-transport.ts).
//
// Auth: Address is one or more comma-separated host[:port] seed brokers. This
// default path talks PLAINTEXT (no SASL/TLS); Username/Password are accepted on
// the wire for forward-compatibility but unused here.

type kafkaClient struct {
	kgo *kgo.Client
	adm *kadm.Client
}

var (
	kafkaClientsMu sync.Mutex
	kafkaClients   = map[string]*kafkaClient{}
)

// KafkaQueryRequest is the wire payload for a Kafka command. A single request
// type covers every action — the connection is identified by Address (+
// credentials), Action picks the operation.
type KafkaQueryRequest struct {
	Address   string `json:"address"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Action    string `json:"action"`
	Query     string `json:"query"`
	TimeoutMs int    `json:"timeoutMs"`
}

// KafkaQueryResponse is SQL-shaped {columns, rows} so flattened topics/groups
// render directly in the existing grid (the frontend maps the `kafka` kind to
// "sql").
type KafkaQueryResponse struct {
	Columns    []string         `json:"columns,omitempty"`
	Rows       []map[string]any `json:"rows,omitempty"`
	Result     any              `json:"result,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

func RunKafkaQuery(ctx context.Context, request KafkaQueryRequest, fallbackTimeout time.Duration) (KafkaQueryResponse, error) {
	if strings.TrimSpace(request.Address) == "" {
		return KafkaQueryResponse{}, fmt.Errorf("address is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := getOrCreateKafkaClient(request, timeout)
	if err != nil {
		return KafkaQueryResponse{}, err
	}

	start := time.Now()
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "listTopics"
	}

	switch action {
	case "ping", "info":
		if err := client.kgo.Ping(timeoutCtx); err != nil {
			return KafkaQueryResponse{}, err
		}
		return KafkaQueryResponse{
			Result:     map[string]any{"status": "ok"},
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listTopics", "query":
		details, err := client.adm.ListTopics(timeoutCtx)
		if err != nil {
			return KafkaQueryResponse{}, err
		}
		rows := make([]map[string]any, 0, len(details))
		for _, d := range details.Sorted() {
			rows = append(rows, map[string]any{
				"topic":      d.Topic,
				"partitions": len(d.Partitions),
				"internal":   d.IsInternal,
			})
		}
		return KafkaQueryResponse{
			Columns:    []string{"topic", "partitions", "internal"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	case "listGroups":
		groups, err := client.adm.ListGroups(timeoutCtx)
		if err != nil {
			return KafkaQueryResponse{}, err
		}
		rows := make([]map[string]any, 0, len(groups))
		for _, g := range groups.Sorted() {
			rows = append(rows, map[string]any{
				"group":        g.Group,
				"state":        g.State,
				"protocolType": g.ProtocolType,
			})
		}
		return KafkaQueryResponse{
			Columns:    []string{"group", "state", "protocolType"},
			Rows:       rows,
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	default:
		return KafkaQueryResponse{}, fmt.Errorf("unsupported kafka action: %s", action)
	}
}

func getOrCreateKafkaClient(request KafkaQueryRequest, timeout time.Duration) (*kafkaClient, error) {
	address := strings.TrimSpace(request.Address)
	username := strings.TrimSpace(request.Username)
	key := kafkaClientKey(address, username, request.Password)

	kafkaClientsMu.Lock()
	defer kafkaClientsMu.Unlock()
	if client, ok := kafkaClients[key]; ok {
		return client, nil
	}

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(parseKafkaBrokers(address)...),
		kgo.DialTimeout(timeout),
	)
	if err != nil {
		return nil, err
	}
	client := &kafkaClient{kgo: cl, adm: kadm.NewClient(cl)}
	kafkaClients[key] = client
	return client, nil
}

// kafkaClientKey scopes a cached client by address + credentials so distinct
// connections never share a client (and the disconnect prefix match is precise).
func kafkaClientKey(address, username, password string) string {
	return address + "\x00" + username + "\x00" + password
}

// parseKafkaBrokers splits a comma-separated address list into trimmed seed
// brokers, dropping empties.
func parseKafkaBrokers(address string) []string {
	parts := strings.Split(address, ",")
	brokers := make([]string, 0, len(parts))
	for _, part := range parts {
		entry := strings.TrimSpace(part)
		if entry != "" {
			brokers = append(brokers, entry)
		}
	}
	sort.Strings(brokers)
	return brokers
}

// DisconnectKafkaClient closes and drops every cached client whose address
// matches, releasing the broker connections.
func DisconnectKafkaClient(address string) error {
	target := strings.TrimSpace(address)
	if target == "" {
		return nil
	}
	kafkaClientsMu.Lock()
	defer kafkaClientsMu.Unlock()
	for key, client := range kafkaClients {
		if strings.HasPrefix(key, target+"\x00") {
			client.kgo.Close()
			delete(kafkaClients, key)
		}
	}
	return nil
}
