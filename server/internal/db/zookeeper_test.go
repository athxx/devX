package db

import (
	"context"
	"strings"
	"testing"
	"time"
)

// ZooKeeper has no local image wired into CI here, so the end-to-end TCP path
// can't be exercised. These tests lock down the runner's pure, connection-free
// logic — request validation, client-cache keying, server parsing, path
// normalization/joining, and disconnect prefix-matching — which is where the
// non-trivial behaviour lives.

// TestRunZookeeperQueryRequiresAddress asserts the runner rejects an empty
// address before attempting any connection (no network round-trip).
func TestRunZookeeperQueryRequiresAddress(t *testing.T) {
	_, err := RunZookeeperQuery(context.Background(), ZookeeperQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestZookeeperClientKey confirms the cache key is scoped by address +
// credentials so distinct auth on the same address does not collide while
// identical requests share a client.
func TestZookeeperClientKey(t *testing.T) {
	key := zookeeperClientKey("localhost:2181", "root", "pw")
	if !strings.HasPrefix(key, "localhost:2181\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}
	if zookeeperClientKey("localhost:2181", "root", "pw") != key {
		t.Fatal("identical requests must produce identical keys")
	}
	if zookeeperClientKey("localhost:2181", "root", "other") == key {
		t.Fatal("differing password must produce a differing key")
	}
	if zookeeperClientKey("localhost:3181", "root", "pw") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestParseZookeeperServers covers comma-splitting, trimming, empty-dropping, and
// the deterministic sort.
func TestParseZookeeperServers(t *testing.T) {
	got := parseZookeeperServers(" b:2181 , a:2181 ,, c:2181 ")
	want := []string{"a:2181", "b:2181", "c:2181"}
	if len(got) != len(want) {
		t.Fatalf("expected %d servers, got %d (%v)", len(want), len(got), got)
	}
	for i, srv := range want {
		if got[i] != srv {
			t.Fatalf("server %d: expected %q, got %q (full: %v)", i, srv, got[i], got)
		}
	}
}

// TestNormalizeZookeeperPath covers the root default and the leading-slash guard.
func TestNormalizeZookeeperPath(t *testing.T) {
	cases := map[string]string{
		"":        "/",
		"   ":     "/",
		"/foo":    "/foo",
		"foo/bar": "/foo/bar",
		" /a ":    "/a",
	}
	for in, want := range cases {
		if got := normalizeZookeeperPath(in); got != want {
			t.Fatalf("normalizeZookeeperPath(%q): expected %q, got %q", in, want, got)
		}
	}
}

// TestJoinZookeeperPath confirms the root's slash is collapsed (no "//a").
func TestJoinZookeeperPath(t *testing.T) {
	if got := joinZookeeperPath("/", "a"); got != "/a" {
		t.Fatalf(`joinZookeeperPath("/","a"): expected "/a", got %q`, got)
	}
	if got := joinZookeeperPath("/foo", "bar"); got != "/foo/bar" {
		t.Fatalf(`joinZookeeperPath("/foo","bar"): expected "/foo/bar", got %q`, got)
	}
}

// TestFirstNonEmpty confirms the first trimmed-non-empty value wins.
func TestFirstNonEmpty(t *testing.T) {
	if got := firstNonEmpty("", "  ", "x", "y"); got != "x" {
		t.Fatalf(`firstNonEmpty: expected "x", got %q`, got)
	}
	if got := firstNonEmpty("", "   "); got != "" {
		t.Fatalf(`firstNonEmpty all-empty: expected "", got %q`, got)
	}
}

// TestDisconnectZookeeperClientPrefixMatch confirms disconnect routes on the
// address segment and is a no-op for an empty or uncached identity.
func TestDisconnectZookeeperClientPrefixMatch(t *testing.T) {
	if err := DisconnectZookeeperClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectZookeeperClient("ghost:2181"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
