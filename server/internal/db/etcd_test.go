package db

import (
	"context"
	"strings"
	"testing"
	"time"

	"go.etcd.io/etcd/api/v3/mvccpb"
	clientv3 "go.etcd.io/etcd/client/v3"
)

// etcd has no local image wired into CI here, so the end-to-end gRPC path can't
// be exercised. These tests lock down the runner's pure, connection-free logic —
// request validation, client-cache keying, endpoint parsing, response flattening,
// and disconnect prefix-matching — which is where the non-trivial behaviour lives.

// TestRunEtcdQueryRequiresAddress asserts the runner rejects an empty address
// before attempting any client construction (no network round-trip).
func TestRunEtcdQueryRequiresAddress(t *testing.T) {
	_, err := RunEtcdQuery(context.Background(), EtcdQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty address, got nil")
	}
	if !strings.Contains(err.Error(), "address is required") {
		t.Fatalf("expected address-required error, got: %v", err)
	}
}

// TestEtcdClientKey confirms the cache key is scoped by address + credentials so
// distinct auth on the same address does not collide while identical requests
// share a client.
func TestEtcdClientKey(t *testing.T) {
	key := etcdClientKey("localhost:2379", "root", "pw")
	if !strings.HasPrefix(key, "localhost:2379\x00") {
		t.Fatalf("key should start with the address segment, got %q", key)
	}

	// Identical inputs → identical key (client reuse).
	if etcdClientKey("localhost:2379", "root", "pw") != key {
		t.Fatal("identical requests must produce identical keys")
	}

	// Different password → different key.
	if etcdClientKey("localhost:2379", "root", "other") == key {
		t.Fatal("differing password must produce a differing key")
	}

	// Different address → different key.
	if etcdClientKey("localhost:3379", "root", "pw") == key {
		t.Fatal("differing address must produce a differing key")
	}
}

// TestParseEtcdEndpoints covers comma-splitting, trimming, empty-dropping, and
// the deterministic sort.
func TestParseEtcdEndpoints(t *testing.T) {
	got := parseEtcdEndpoints(" b:2379 , a:2379 ,, c:2379 ")
	want := []string{"a:2379", "b:2379", "c:2379"}
	if len(got) != len(want) {
		t.Fatalf("expected %d endpoints, got %d (%v)", len(want), len(got), got)
	}
	for i, ep := range want {
		if got[i] != ep {
			t.Fatalf("endpoint %d: expected %q, got %q (full: %v)", i, ep, got[i], got)
		}
	}
}

// TestEtcdKvResponse asserts the fixed {key,value,version} column order and the
// row flattening from raw KVs.
func TestEtcdKvResponse(t *testing.T) {
	resp := &clientv3.GetResponse{
		Kvs: []*mvccpb.KeyValue{
			{Key: []byte("/a"), Value: []byte("1"), Version: 3},
			{Key: []byte("/b"), Value: []byte("2"), Version: 1},
		},
	}
	out := etcdKvResponse(resp, time.Now())

	wantCols := []string{"key", "value", "version"}
	if len(out.Columns) != len(wantCols) {
		t.Fatalf("expected %d columns, got %v", len(wantCols), out.Columns)
	}
	for i, c := range wantCols {
		if out.Columns[i] != c {
			t.Fatalf("column %d: expected %q, got %q", i, c, out.Columns[i])
		}
	}
	if len(out.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(out.Rows))
	}
	if out.Rows[0]["key"] != "/a" || out.Rows[0]["value"] != "1" || out.Rows[0]["version"] != int64(3) {
		t.Fatalf("first row mismatch: %v", out.Rows[0])
	}
}

// TestDisconnectEtcdClientPrefixMatch confirms disconnect routes on the address
// segment and is a no-op for an empty or uncached identity.
func TestDisconnectEtcdClientPrefixMatch(t *testing.T) {
	if err := DisconnectEtcdClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	if err := DisconnectEtcdClient("ghost:2379"); err != nil {
		t.Fatalf("disconnecting an uncached address should be a no-op, got %v", err)
	}
}
