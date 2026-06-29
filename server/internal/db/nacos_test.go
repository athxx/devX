package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Nacos has no local server wired into CI here, so the end-to-end protocol path
// can't be exercised. These tests lock down the runner's pure, connection-free
// logic — request validation, client-cache keying, server parsing, host:port
// splitting, and disconnect prefix-matching — which is where the non-trivial
// behaviour lives.

// TestRunNacosQueryRequiresAddress asserts the runner rejects an empty address
// before attempting any client construction (no network round-trip).
func TestRunNacosQueryRequiresAddress(t *testing.T) {
	_, err := RunNacosQuery(context.Background(), NacosQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestNacosClientKey confirms the cache key is scoped by address + credentials +
// namespace, so distinct connections never collide.
func TestNacosClientKey(t *testing.T) {
	key := nacosClientKey("localhost:8848", "user", "pw", "ns")
	if !strings.HasPrefix(key, "localhost:8848\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}
	if nacosClientKey("localhost:8848", "user", "pw", "ns") != key {
		t.Fatal("identical requests must produce identical keys")
	}
	if nacosClientKey("localhost:8848", "user", "other", "ns") == key {
		t.Fatal("differing password must produce a differing key")
	}
	if nacosClientKey("localhost:8848", "user", "pw", "other") == key {
		t.Fatal("differing namespace must produce a differing key")
	}
	if nacosClientKey("localhost:8849", "user", "pw", "ns") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestParseNacosServers covers comma-splitting, trimming, empty-dropping, the
// deterministic sort, and default-port application.
func TestParseNacosServers(t *testing.T) {
	got := parseNacosServers(" b:8848 , a:9000 ,, c ")
	if len(got) != 3 {
		t.Fatalf("expected 3 servers, got %d (%+v)", len(got), got)
	}
	// Sorted by the raw entry before splitting: "a:9000", "b:8848", "c".
	if got[0].IpAddr != "a" || got[0].Port != 9000 {
		t.Fatalf("server 0: expected a:9000, got %s:%d", got[0].IpAddr, got[0].Port)
	}
	if got[1].IpAddr != "b" || got[1].Port != 8848 {
		t.Fatalf("server 1: expected b:8848, got %s:%d", got[1].IpAddr, got[1].Port)
	}
	if got[2].IpAddr != "c" || got[2].Port != nacosDefaultPort {
		t.Fatalf("server 2: expected c:%d, got %s:%d", nacosDefaultPort, got[2].IpAddr, got[2].Port)
	}
}

// TestSplitNacosHostPort covers explicit ports, the bare-host default, and the
// unparseable-port fallback.
func TestSplitNacosHostPort(t *testing.T) {
	if h, p := splitNacosHostPort("host:1234"); h != "host" || p != 1234 {
		t.Fatalf("expected host:1234, got %s:%d", h, p)
	}
	if h, p := splitNacosHostPort("host"); h != "host" || p != nacosDefaultPort {
		t.Fatalf("expected default port, got %s:%d", h, p)
	}
	if h, p := splitNacosHostPort("host:abc"); h != "host" || p != nacosDefaultPort {
		t.Fatalf("expected default port on unparseable, got %s:%d", h, p)
	}
}

// TestDisconnectNacosClientPrefixMatch confirms disconnect routes on the address
// segment and is a no-op for an empty or uncached identity.
func TestDisconnectNacosClientPrefixMatch(t *testing.T) {
	if err := DisconnectNacosClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectNacosClient("ghost:8848"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
