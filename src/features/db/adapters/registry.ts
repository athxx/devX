// Central adapter registry. The `Record<DbConnectionKind, DbAdapter>` type
// makes the mapping exhaustive — adding a new DbConnectionKind without a matching
// adapter is a compile error, which is what replaces the old scattered
// `switch (connection.kind) { default: ... }` fallthroughs.

import type { DbConnectionKind } from "../models";
import type { DbAdapter } from "./types";
import { RedisAdapter } from "./redis";
import { PostgresAdapter } from "./postgresql";
import { GaussDbAdapter } from "./gaussdb";
import { MySqlAdapter } from "./mysql";
import { TiDbAdapter } from "./tidb";
import { MongoAdapter } from "./mongodb";
import { ClickHouseAdapter } from "./clickhouse";
import { OracleAdapter } from "./oracle";
import { SqliteAdapter } from "./sqlite";
import { SqlServerAdapter } from "./sqlserver";
import { MariaDbAdapter } from "./mariadb";
import { OceanBaseAdapter } from "./oceanbase";
import { DorisAdapter } from "./doris";
import { StarRocksAdapter } from "./starrocks";
import { CockroachDbAdapter } from "./cockroachdb";
import { KingBaseAdapter } from "./kingbase";
import { OpenGaussAdapter } from "./opengauss";

const ADAPTERS: Record<DbConnectionKind, DbAdapter> = {
  redis: new RedisAdapter(),
  postgresql: new PostgresAdapter(),
  gaussdb: new GaussDbAdapter(),
  mysql: new MySqlAdapter(),
  tidb: new TiDbAdapter(),
  mongodb: new MongoAdapter(),
  clickhouse: new ClickHouseAdapter(),
  oracle: new OracleAdapter(),
  sqlite: new SqliteAdapter(),
  sqlserver: new SqlServerAdapter(),
  mariadb: new MariaDbAdapter(),
  oceanbase: new OceanBaseAdapter(),
  doris: new DorisAdapter(),
  starrocks: new StarRocksAdapter(),
  cockroachdb: new CockroachDbAdapter(),
  kingbase: new KingBaseAdapter(),
  opengauss: new OpenGaussAdapter(),
};

export function getDbAdapter(kind: DbConnectionKind): DbAdapter {
  return ADAPTERS[kind];
}
