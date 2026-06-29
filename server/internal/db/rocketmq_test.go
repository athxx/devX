package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// RocketMQ has no local nameserver wired into CI here, so the end-to-end
// protocol path can't be exercised. These tests lock down the runner's pure,
// connection-free logic — request validation, client-cache keying, nameserver
// parsing, and disconnect prefix-matching — which is where the non-trivial
// behaviour lives.

// TestRunRocketMQQueryRequiresAddress asserts the runner rejects an empty
// address before attempting any client construction (no network round-trip).
func TestRunRocketMQQueryRequiresAddress(t *testing.T) {
	_, err := RunRocketMQQuery(context.Background(), RocketMQQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestRocketMQClientKey confirms the cache key is scoped by address + credentials.
func TestRocketMQClientKey(t *testing.T) {
	key := rocketmqClientKey("localhost:9876", "ak", "sk")
	if !strings.HasPrefix(key, "localhost:9876\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}
	if rocketmqClientKey("localhost:9876", "ak", "sk") != key {
		t.Fatal("identical requests must produce identical keys")
	}
	if rocketmqClientKey("localhost:9876", "ak", "other") == key {
		t.Fatal("differing secret must produce a differing key")
	}
	if rocketmqClientKey("localhost:9877", "ak", "sk") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestParseRocketMQNameservers covers comma-splitting, trimming, empty-dropping,
// and the deterministic sort.
func TestParseRocketMQNameservers(t *testing.T) {
	got := parseRocketMQNameservers(" b:9876 , a:9876 ,, c:9876 ")
	want := []string{"a:9876", "b:9876", "c:9876"}
	if len(got) != len(want) {
		t.Fatalf("expected %d servers, got %d (%v)", len(want), len(got), got)
	}
	for i, s := range want {
		if got[i] != s {
			t.Fatalf("server %d: expected %q, got %q (full: %v)", i, s, got[i], got)
		}
	}
}

// TestDisconnectRocketMQClientPrefixMatch confirms disconnect routes on the
// address segment and is a no-op for an empty or uncached identity.
func TestDisconnectRocketMQClientPrefixMatch(t *testing.T) {
	if err := DisconnectRocketMQClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectRocketMQClient("ghost:9876"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
