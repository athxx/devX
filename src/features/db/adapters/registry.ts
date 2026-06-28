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
import { OceanBaseAdapter } from "./oceanbase";
import { DorisAdapter } from "./doris";
import { StarRocksAdapter } from "./starrocks";
import { CockroachDbAdapter } from "./cockroachdb";
import { KingBaseAdapter } from "./kingbase";
import { DamengAdapter } from "./dameng";
import { KwDbAdapter } from "./kwdb";
import { GoldenDbAdapter } from "./goldendb";
import { SelectDbAdapter } from "./selectdb";
import { ManticoreAdapter } from "./manticore";
import { VastbaseAdapter } from "./vastbase";
import { HighGoAdapter } from "./highgo";
import { RedshiftAdapter } from "./redshift";
import { QuestDbAdapter } from "./questdb";
import { OpenGaussAdapter } from "./opengauss";
import { SnowflakeAdapter } from "./snowflake";
import { TrinoAdapter } from "./trino";
import { DatabendAdapter } from "./databend";
import { DuckDbAdapter } from "./duckdb";
import { TDengineAdapter } from "./tdengine";
import { ElasticsearchAdapter } from "./elasticsearch";
import { BigtableAdapter } from "./bigtable";
import { QdrantAdapter } from "./qdrant";
import { InfluxDbAdapter } from "./influxdb";
import { WeaviateAdapter } from "./weaviate";
import { Neo4jAdapter } from "./neo4j";

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
  oceanbase: new OceanBaseAdapter(),
  doris: new DorisAdapter(),
  starrocks: new StarRocksAdapter(),
  cockroachdb: new CockroachDbAdapter(),
  kingbase: new KingBaseAdapter(),
  dameng: new DamengAdapter(),
  kwdb: new KwDbAdapter(),
  goldendb: new GoldenDbAdapter(),
  selectdb: new SelectDbAdapter(),
  manticore: new ManticoreAdapter(),
  vastbase: new VastbaseAdapter(),
  highgo: new HighGoAdapter(),
  redshift: new RedshiftAdapter(),
  questdb: new QuestDbAdapter(),
  opengauss: new OpenGaussAdapter(),
  snowflake: new SnowflakeAdapter(),
  trino: new TrinoAdapter(),
  databend: new DatabendAdapter(),
  duckdb: new DuckDbAdapter(),
  tdengine: new TDengineAdapter(),
  elasticsearch: new ElasticsearchAdapter(),
  bigtable: new BigtableAdapter(),
  qdrant: new QdrantAdapter(),
  influxdb: new InfluxDbAdapter(),
  weaviate: new WeaviateAdapter(),
  neo4j: new Neo4jAdapter(),
};

export function getDbAdapter(kind: DbConnectionKind): DbAdapter {
  return ADAPTERS[kind];
}
