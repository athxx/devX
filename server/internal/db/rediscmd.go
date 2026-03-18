package db

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
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

	options, err := redis.ParseURL(request.URL)
	if err != nil {
		return RedisCommandResponse{}, fmt.Errorf("parse redis url: %w", err)
	}

	client := redis.NewClient(options)
	defer client.Close()

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
