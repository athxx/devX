package db

// Pure-Go database/sql drivers for Tier-B SQL databases. Each blank import
// registers the driver with database/sql via its init(); registerRawSQLBackend
// then maps the frontend connection-kind(s) to that driver name. These compile
// into the default binary (no cgo). cgo-heavy drivers live in rawsql_cgo.go
// behind the `cgo_drivers` build tag.

import (
	_ "github.com/databricks/databricks-sql-go"
	_ "github.com/datafuselabs/databend-go"
	_ "github.com/snowflakedb/gosnowflake"
	_ "github.com/trinodb/trino-go-client/trino"
)

func init() {
	// driver names match what each package registers with sql.Register.
	registerRawSQLBackend("snowflake", "snowflake")
	registerRawSQLBackend("trino", "trino")
	registerRawSQLBackend("databend", "databend")
	registerRawSQLBackend("databricks", "databricks")
}
