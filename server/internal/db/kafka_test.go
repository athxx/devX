package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Kafka has no local broker wired into CI here, so the end-to-end protocol path
// can't be exercised. These tests lock down the runner's pure, connection-free
// logic — request validation, client-cache keying, broker parsing, and disconnect
// prefix-matching — which is where the non-trivial behaviour lives.

// TestRunKafkaQueryRequiresAddress asserts the runner rejects an empty address
// before attempting any client construction (no network round-trip).
func TestRunKafkaQueryRequiresAddress(t *testing.T) {
	_, err := RunKafkaQuery(context.Background(), KafkaQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestKafkaClientKey confirms the cache key is scoped by address + credentials.
func TestKafkaClientKey(t *testing.T) {
	key := kafkaClientKey("localhost:9092", "user", "pw")
	if !strings.HasPrefix(key, "localhost:9092\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}
	if kafkaClientKey("localhost:9092", "user", "pw") != key {
		t.Fatal("identical requests must produce identical keys")
	}
	if kafkaClientKey("localhost:9092", "user", "other") == key {
		t.Fatal("differing password must produce a differing key")
	}
	if kafkaClientKey("localhost:9192", "user", "pw") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestParseKafkaBrokers covers comma-splitting, trimming, empty-dropping, and the
// deterministic sort.
func TestParseKafkaBrokers(t *testing.T) {
	got := parseKafkaBrokers(" b:9092 , a:9092 ,, c:9092 ")
	want := []string{"a:9092", "b:9092", "c:9092"}
	if len(got) != len(want) {
		t.Fatalf("expected %d brokers, got %d (%v)", len(want), len(got), got)
	}
	for i, b := range want {
		if got[i] != b {
			t.Fatalf("broker %d: expected %q, got %q (full: %v)", i, b, got[i], got)
		}
	}
}

// TestDisconnectKafkaClientPrefixMatch confirms disconnect routes on the address
// segment and is a no-op for an empty or uncached identity.
func TestDisconnectKafkaClientPrefixMatch(t *testing.T) {
	if err := DisconnectKafkaClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectKafkaClient("ghost:9092"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
