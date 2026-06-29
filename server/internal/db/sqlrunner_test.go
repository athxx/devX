package db

import "testing"

// TestBuildDialectorSupportedKinds asserts every wire-compatible driver string
// the frontend can send (driver == connection.kind) resolves to a dialector.
// Tier-A kinds reuse the MySQL/PostgreSQL/GaussDB dialectors via wire-protocol
// compatibility, so a missing case here is a regression.
func TestBuildDialectorSupportedKinds(t *testing.T) {
	supported := []string{
		// core
		"clickhouse", "mysql", "tidb", "sqlite", "postgres", "postgresql",
		"sqlserver", "mssql", "oracle", "dm", "dameng",
		// gauss family
		"gaussdb", "opengauss",
		// MySQL-wire
		"oceanbase", "doris", "starrocks", "kwdb", "goldendb", "selectdb", "manticore",
		// PostgreSQL-wire
		"cockroachdb", "kingbase", "vastbase", "highgo", "redshift", "questdb",
	}

	for _, driver := range supported {
		t.Run(driver, func(t *testing.T) {
			dialector, err := buildDialector(driver, "dsn-placeholder")
			if err != nil {
				t.Fatalf("buildDialector(%q) returned error: %v", driver, err)
			}
			if dialector == nil {
				t.Fatalf("buildDialector(%q) returned nil dialector", driver)
			}
		})
	}
}

func TestBuildDialectorRejectsUnknownDriver(t *testing.T) {
	if _, err := buildDialector("not-a-real-driver", "dsn"); err == nil {
		t.Fatal("expected error for unknown driver, got nil")
	}
}

// TestBuildDialectorCaseInsensitive confirms the driver string is normalized,
// matching how getOrCreateSQLConnection keys connections.
func TestBuildDialectorCaseInsensitive(t *testing.T) {
	if _, err := buildDialector("  RedShift  ", "dsn"); err != nil {
		t.Fatalf("expected case-insensitive match for Redshift, got: %v", err)
	}
}

// TestRawSQLBackendsRegistered asserts the pure-Go Tier-B drivers register a raw
// database/sql backend (these have no GORM dialector and route through
// querySQLRaw). cgo-gated kinds (duckdb, tdengine) are only present under
// `-tags cgo_drivers`, so they're intentionally not asserted here.
func TestRawSQLBackendsRegistered(t *testing.T) {
	// Each kind maps to the driver name its package registers with sql.Register.
	want := map[string]string{
		"snowflake":  "snowflake",
		"trino":      "trino",
		"databend":   "databend",
		"databricks": "databricks",
		"hive":       "hive",
	}
	for kind, driver := range want {
		t.Run(kind, func(t *testing.T) {
			backend, ok := lookupRawSQLBackend(kind)
			if !ok {
				t.Fatalf("raw backend for %q not registered", kind)
			}
			if backend.sqlDriverName != driver {
				t.Fatalf("raw backend for %q: want driver %q, got %q", kind, driver, backend.sqlDriverName)
			}
		})
	}
}

// TestRawSQLBackendCaseInsensitive mirrors the connection-key normalization.
func TestRawSQLBackendCaseInsensitive(t *testing.T) {
	if _, ok := lookupRawSQLBackend("  SnowFlake  "); !ok {
		t.Fatal("expected case-insensitive match for snowflake raw backend")
	}
}

// TestRawSQLBackendDisconnectNoop confirms disconnecting an unknown driver is
// reported as not-handled so the caller falls through to the GORM path.
func TestRawSQLBackendDisconnectNoop(t *testing.T) {
	if handled, _ := disconnectRawSQLConnection("mysql", "dsn"); handled {
		t.Fatal("mysql should not be handled by the raw backend path")
	}
}
