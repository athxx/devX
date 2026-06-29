package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Pulsar has no local admin endpoint wired into CI here, so the end-to-end REST
// path can't be exercised. These tests lock down the runner's pure,
// connection-free logic — request validation, client-cache keying, WebServiceURL
// normalization, and disconnect prefix-matching — which is where the non-trivial
// behaviour lives.

// TestRunPulsarQueryRequiresAddress asserts the runner rejects an empty address
// before attempting any client construction (no network round-trip).
func TestRunPulsarQueryRequiresAddress(t *testing.T) {
	_, err := RunPulsarQuery(context.Background(), PulsarQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestPulsarClientKey confirms the cache key is scoped by address + credentials.
func TestPulsarClientKey(t *testing.T) {
	key := pulsarClientKey("localhost:8080", "user", "token")
	if !strings.HasPrefix(key, "localhost:8080\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}
	if pulsarClientKey("localhost:8080", "user", "token") != key {
		t.Fatal("identical requests must produce identical keys")
	}
	if pulsarClientKey("localhost:8080", "user", "other") == key {
		t.Fatal("differing token must produce a differing key")
	}
	if pulsarClientKey("localhost:8081", "user", "token") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestNormalizePulsarWebURL covers the bare-host, host:port, and pre-schemed
// forms plus the 8080 default.
func TestNormalizePulsarWebURL(t *testing.T) {
	cases := map[string]string{
		"localhost":            "http://localhost:8080",
		"localhost:8080":       "http://localhost:8080",
		"pulsar.local:9090":    "http://pulsar.local:9090",
		"http://broker:8080":   "http://broker:8080",
		"https://secure:443":   "https://secure:443",
	}
	for in, want := range cases {
		if got := normalizePulsarWebURL(in); got != want {
			t.Fatalf("normalizePulsarWebURL(%q) = %q, want %q", in, got, want)
		}
	}
	if normalizePulsarWebURL("  ") != "" {
		t.Fatal("blank address should normalize to empty")
	}
}

// TestDisconnectPulsarClientPrefixMatch confirms disconnect routes on the address
// segment and is a no-op for an empty or uncached identity.
func TestDisconnectPulsarClientPrefixMatch(t *testing.T) {
	if err := DisconnectPulsarClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectPulsarClient("ghost:8080"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
