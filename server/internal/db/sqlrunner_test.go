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
