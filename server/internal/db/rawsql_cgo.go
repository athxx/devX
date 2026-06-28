//go:build cgo_drivers

package db

// cgo-heavy database/sql drivers, compiled only with `-tags cgo_drivers` so the
// default binary stays pure-Go and cross-compilable. Build with cgo enabled:
//
//	CGO_ENABLED=1 go build -tags cgo_drivers ./...
//
// DuckDB embeds the engine via cgo; the TDengine native connector links the
// libtaos client. (TDengine also has a REST mode that is pure-Go and could be
// registered in rawsql_drivers.go instead.)

import (
	_ "github.com/marcboeker/go-duckdb"
	_ "github.com/taosdata/driver-go/v3/taosSql"
)

func init() {
	registerRawSQLBackend("duckdb", "duckdb")
	registerRawSQLBackend("tdengine", "taosSql")
}
