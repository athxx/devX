package db

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	redisClientsMu sync.Mutex
	redisClients   = map[string]*redis.Client{}
)

type RedisCommandRequest struct {
	URL       string `json:"url"`
	Command   string `json:"command"`
	Arguments []any  `json:"arguments"`
	TimeoutMs int    `json:"timeoutMs"`
}

type RedisCommandResponse struct {
	Result     any   `json:"result"`
	DurationMs int64 `json:"durationMs"`
}

func RunRedisCommand(ctx context.Context, request RedisCommandRequest, fallbackTimeout time.Duration) (RedisCommandResponse, error) {
	if request.URL == "" {
		return RedisCommandResponse{}, fmt.Errorf("url is required")
	}
	if request.Command == "" {
		return RedisCommandResponse{}, fmt.Errorf("command is required")
	}

	client, err := getOrCreateRedisClient(request.URL)
	if err != nil {
		return RedisCommandResponse{}, err
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := make([]any, 0, len(request.Arguments)+1)
	args = append(args, request.Command)
	args = append(args, request.Arguments...)

	start := time.Now()
	result, err := client.Do(timeoutCtx, args...).Result()
	if err != nil {
		return RedisCommandResponse{}, err
	}

	return RedisCommandResponse{
		Result:     result,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

func getOrCreateRedisClient(rawURL string) (*redis.Client, error) {
	redisClientsMu.Lock()
	client, ok := redisClients[rawURL]
	redisClientsMu.Unlock()
	if ok {
		return client, nil
	}

	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	client = redis.NewClient(options)

	redisClientsMu.Lock()
	if existing, exists := redisClients[rawURL]; exists {
		redisClientsMu.Unlock()
		_ = client.Close()
		return existing, nil
	}
	redisClients[rawURL] = client
	redisClientsMu.Unlock()

	return client, nil
}

func DisconnectRedisClient(rawURL string) error {
	redisClientsMu.Lock()
	client, ok := redisClients[rawURL]
	if ok {
		delete(redisClients, rawURL)
	}
	redisClientsMu.Unlock()
	if !ok {
		return nil
	}
	return client.Close()
}
