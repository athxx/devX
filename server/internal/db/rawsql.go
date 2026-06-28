package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"
)

// rawSQLBackend describes a database/sql-based driver that does NOT have a GORM
// dialector. These speak SQL but ship as plain `database/sql` drivers
// (Snowflake, Trino, Databend, DuckDB, native TDengine, …). They share the GORM
// path's result scanning (scanSQLRows) and SQL classification (classifySQL),
// differing only in how the connection is opened.
//
// This is the "DbDriverBackend seam" from the roadmap: it lets raw drivers and
// GORM drivers coexist behind a single QuerySQL entry point. Drivers register
// here from an init() — pure-Go ones unconditionally (rawsql_drivers.go), and
// cgo-heavy ones only under the `cgo_drivers` build tag (rawsql_cgo.go) so the
// default binary stays pure-Go.
type rawSQLBackend struct {
	// sqlDriverName is the name the driver registered with database/sql
	// (e.g. "snowflake", "trino", "databend", "duckdb").
	sqlDriverName string
}

var (
	rawSQLBackendsMu sync.RWMutex
	rawSQLBackends   = map[string]rawSQLBackend{}

	rawSQLConnectionsMu sync.Mutex
	rawSQLConnections   = map[string]*sql.DB{}
)

// registerRawSQLBackend maps one or more connection-kind aliases to a
// database/sql driver name. Safe to call from init().
func registerRawSQLBackend(sqlDriverName string, kinds ...string) {
	rawSQLBackendsMu.Lock()
	defer rawSQLBackendsMu.Unlock()
	for _, kind := range kinds {
		rawSQLBackends[strings.ToLower(strings.TrimSpace(kind))] = rawSQLBackend{
			sqlDriverName: sqlDriverName,
		}
	}
}

func lookupRawSQLBackend(driver string) (rawSQLBackend, bool) {
	rawSQLBackendsMu.RLock()
	defer rawSQLBackendsMu.RUnlock()
	backend, ok := rawSQLBackends[strings.ToLower(strings.TrimSpace(driver))]
	return backend, ok
}

// querySQLRaw mirrors the GORM branch of QuerySQL for database/sql drivers,
// reusing scanSQLRows and classifySQL so results look identical to the frontend.
func querySQLRaw(ctx context.Context, backend rawSQLBackend, request SQLQueryRequest, timeout time.Duration) (SQLQueryResponse, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	db, err := getOrCreateRawSQLConnection(request.Driver, backend.sqlDriverName, request.DSN)
	if err != nil {
		return SQLQueryResponse{}, err
	}

	if request.MaxOpenConns > 0 {
		db.SetMaxOpenConns(request.MaxOpenConns)
	}
	if request.MaxIdleConns > 0 {
		db.SetMaxIdleConns(request.MaxIdleConns)
	}

	start := time.Now()
	if classifySQL(request.Query) == "query" {
		rows, err := db.QueryContext(timeoutCtx, request.Query)
		if err != nil {
			return SQLQueryResponse{}, err
		}
		defer rows.Close()
		return scanSQLRows(rows, start)
	}

	result, err := db.ExecContext(timeoutCtx, request.Query)
	if err != nil {
		return SQLQueryResponse{}, err
	}
	affected, _ := result.RowsAffected()
	return SQLQueryResponse{
		AffectedRows: affected,
		DurationMs:   time.Since(start).Milliseconds(),
	}, nil
}

func getOrCreateRawSQLConnection(driver, sqlDriverName, dsn string) (*sql.DB, error) {
	key := strings.ToLower(strings.TrimSpace(driver)) + "\x00" + dsn

	rawSQLConnectionsMu.Lock()
	defer rawSQLConnectionsMu.Unlock()
	if db, ok := rawSQLConnections[key]; ok {
		return db, nil
	}

	db, err := sql.Open(sqlDriverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s database: %w", sqlDriverName, err)
	}
	rawSQLConnections[key] = db
	return db, nil
}

// disconnectRawSQLConnection closes and forgets a raw connection. Returns
// (handled, error): handled is false when the driver isn't a raw backend, so
// the caller can fall through to the GORM path.
func disconnectRawSQLConnection(driver, dsn string) (bool, error) {
	if _, ok := lookupRawSQLBackend(driver); !ok {
		return false, nil
	}
	key := strings.ToLower(strings.TrimSpace(driver)) + "\x00" + dsn

	rawSQLConnectionsMu.Lock()
	db, ok := rawSQLConnections[key]
	if ok {
		delete(rawSQLConnections, key)
	}
	rawSQLConnectionsMu.Unlock()
	if !ok {
		return true, nil
	}
	return true, db.Close()
}
