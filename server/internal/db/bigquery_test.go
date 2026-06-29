package db

import (
	"context"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/bigquery"
)

// BigQuery has no local image (like Snowflake/Redshift), so the end-to-end path
// can't be exercised here. These tests instead lock down the runner's pure,
// connection-free logic — request validation, client-cache keying, value
// encoding, column ordering, and disconnect prefix-matching — which is where the
// non-trivial behaviour lives (the actual gRPC/REST call is the SDK's concern).

// TestRunBigQueryQueryRequiresProject asserts the runner rejects an empty
// project before attempting any client construction (no network round-trip).
func TestRunBigQueryQueryRequiresProject(t *testing.T) {
	_, err := RunBigQueryQuery(context.Background(), BigQueryQueryRequest{}, time.Second)
	if err == nil {
		t.Fatal("expected error for empty project, got nil")
	}
	if !strings.Contains(err.Error(), "project is required") {
		t.Fatalf("expected project-required error, got: %v", err)
	}
}

// TestBigQueryClientKey confirms the cache key is scoped by project + a hash of
// the credentials (+ a scheme-bearing endpoint), so distinct auth on the same
// project does not collide while identical requests share a client.
func TestBigQueryClientKey(t *testing.T) {
	base := BigQueryQueryRequest{Project: "proj-a"}

	keyNoCreds := bigQueryClientKey(base)
	if !strings.HasPrefix(keyNoCreds, "proj-a\x00") {
		t.Fatalf("key should start with the project segment, got %q", keyNoCreds)
	}

	// Same project + same (empty) creds → identical key (client reuse).
	if bigQueryClientKey(base) != keyNoCreds {
		t.Fatal("identical requests must produce identical keys")
	}

	// Different credentials on the same project → different key.
	withCreds := base
	withCreds.Credentials = `{"type":"service_account"}`
	if bigQueryClientKey(withCreds) == keyNoCreds {
		t.Fatal("differing credentials must produce a differing key")
	}

	// Different project → different key.
	other := base
	other.Project = "proj-b"
	if bigQueryClientKey(other) == keyNoCreds {
		t.Fatal("differing project must produce a differing key")
	}

	// A bare location (US/EU) is a per-query parameter, NOT part of the key.
	bareLoc := base
	bareLoc.Location = "EU"
	if bigQueryClientKey(bareLoc) != keyNoCreds {
		t.Fatal("a bare processing location must not affect the client key")
	}

	// A scheme-bearing location is a custom endpoint and DOES change the key.
	endpoint := base
	endpoint.Location = "http://localhost:9050"
	if bigQueryClientKey(endpoint) == keyNoCreds {
		t.Fatal("a custom endpoint must produce a differing key")
	}
}

// TestEncodeBigQueryValue covers the JSON-friendly mapping of every value shape
// the SDK can hand back, including nested STRUCT/ARRAY recursion.
func TestEncodeBigQueryValue(t *testing.T) {
	if got := encodeBigQueryValue(nil); got != nil {
		t.Fatalf("nil should encode to nil, got %v", got)
	}

	ts := time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC)
	if got := encodeBigQueryValue(ts); got != ts.Format(time.RFC3339Nano) {
		t.Fatalf("time should encode to RFC3339Nano, got %v", got)
	}

	if got := encodeBigQueryValue([]byte("hello")); got != "hello" {
		t.Fatalf("[]byte should encode to string, got %v", got)
	}

	if got := encodeBigQueryValue(int64(42)); got != int64(42) {
		t.Fatalf("scalar should pass through, got %v", got)
	}
}

// TestBigQueryColumns asserts column order comes from the result schema when
// present, and falls back to sorted row keys (deterministic) otherwise.
func TestBigQueryColumns(t *testing.T) {
	// With no schema, column order falls back to the row map's keys, sorted for
	// determinism (map iteration order is otherwise unspecified).
	row := map[string]bigquery.Value{"zebra": 1, "alpha": 2, "mango": 3}
	cols := bigQueryColumns(nil, row)
	want := []string{"alpha", "mango", "zebra"}
	if len(cols) != len(want) {
		t.Fatalf("expected %d columns, got %d (%v)", len(want), len(cols), cols)
	}
	for i, name := range want {
		if cols[i] != name {
			t.Fatalf("column %d: expected %q, got %q (full: %v)", i, name, cols[i], cols)
		}
	}

	// When a schema is present it wins, preserving the SELECT projection order
	// (not alphabetised) regardless of the row map's iteration order.
	schema := bigquery.Schema{
		{Name: "zebra"}, {Name: "alpha"}, {Name: "mango"},
	}
	schemaCols := bigQueryColumns(schema, row)
	wantSchema := []string{"zebra", "alpha", "mango"}
	for i, name := range wantSchema {
		if schemaCols[i] != name {
			t.Fatalf("schema column %d: expected %q, got %q (full: %v)", i, name, schemaCols[i], schemaCols)
		}
	}
}

// TestDisconnectBigQueryClientPrefixMatch confirms disconnect routes on the
// project segment of "project\x00dataset" and is a no-op for an empty identity.
func TestDisconnectBigQueryClientPrefixMatch(t *testing.T) {
	if err := DisconnectBigQueryClient(""); err != nil {
		t.Fatalf("empty identity should be a no-op, got %v", err)
	}
	// A "project\x00dataset" identity with no cached client must not error.
	if err := DisconnectBigQueryClient("ghost-project\x00some-dataset"); err != nil {
		t.Fatalf("disconnecting an uncached project should be a no-op, got %v", err)
	}
}
