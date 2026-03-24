import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { completeFromList } from "@codemirror/autocomplete"
import {
  schemaCompletionSource,
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql"
import type { DbConnectionKind } from "../models"

// ── Dialect mapping ────────────────────────────────────────────────

function getSqlDialect(kind: DbConnectionKind): SQLDialect | null {
  switch (kind) {
    case "postgresql":
    case "gaussdb":
      return PostgreSQL
    case "mysql":
    case "tidb":
      return MySQL
    case "sqlserver":
      return MSSQL
    case "sqlite":
      return SQLite
    case "clickhouse":
    case "oracle":
      return StandardSQL
    default:
      return null
  }
}

// ── SQL keywords — ordered by frequency, boost controls ranking ───

// Tier 1: highest frequency (everyday DML)
const Tier1 = [
  "SELECT", "FROM", "WHERE", "UPDATE", "DELETE",
  "INSERT", "INTO", "VALUES", "SET",
  "JOIN", "LEFT", "INNER", "ON",
  "AND", "OR", "NOT", "IN", "AS",
  "ORDER", "GROUP", "BY", "HAVING",
  "LIMIT", "OFFSET", "DISTINCT",
]
// Tier 2: common clauses & operators
const Tier2 = [
  "LIKE", "BETWEEN", "EXISTS", "IS", "NULL",
  "UNION", "ALL", "RIGHT", "OUTER", "CROSS", "FULL",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "COUNT", "SUM", "AVG", "MIN", "MAX",
  "ASC", "DESC", "WITH",
]
// Tier 3: DDL & less frequent
const Tier3 = [
  "CREATE", "TABLE", "DROP", "ALTER", "VIEW", "INDEX",
  "ADD", "COLUMN", "DATABASE", "SCHEMA",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT",
  "UNIQUE", "DEFAULT", "CHECK", "CASCADE",
  "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION",
  "EXECUTE", "PROCEDURE", "FUNCTION", "TRIGGER",
  "TRUNCATE", "EXPLAIN", "ANALYZE", "RECURSIVE",
  "RETURNING", "CONFLICT", "REPLACE", "IGNORE",
  "CAST", "COALESCE", "NULLIF", "IF", "IFNULL",
  "TRUE", "FALSE", "GO",
]

const SqlKeywords: Completion[] = [
  ...Tier1.map(kw => ({ label: kw, type: "keyword" as const, boost: 3 })),
  ...Tier2.map(kw => ({ label: kw, type: "keyword" as const, boost: 1 })),
  ...Tier3.map(kw => ({ label: kw, type: "keyword" as const, boost: -1 })),
]

const sqlKeywordSource = completeFromList(SqlKeywords)

// ── Redis commands ─────────────────────────────────────────────────

const RedisKeywords: Completion[] = [
  "APPEND", "AUTH", "BGSAVE", "BITCOUNT", "BLPOP", "BRPOP",
  "CLIENT", "CLUSTER", "CONFIG", "COPY", "DBSIZE", "DECR", "DECRBY",
  "DEL", "DISCARD", "DUMP", "ECHO", "EVAL", "EXEC", "EXISTS",
  "EXPIRE", "EXPIREAT", "FLUSHALL", "FLUSHDB",
  "GEOADD", "GEODIST", "GEOHASH", "GEOPOS", "GEORADIUS", "GEOSEARCH",
  "GET", "GETDEL", "GETEX", "GETRANGE", "GETSET",
  "HDEL", "HEXISTS", "HGET", "HGETALL", "HINCRBY", "HINCRBYFLOAT",
  "HKEYS", "HLEN", "HMGET", "HMSET", "HRANDFIELD", "HSCAN",
  "HSET", "HSETNX", "HSTRLEN", "HVALS",
  "INCR", "INCRBY", "INCRBYFLOAT", "INFO", "KEYS",
  "LINDEX", "LINSERT", "LLEN", "LMOVE", "LPOP", "LPOS",
  "LPUSH", "LPUSHX", "LRANGE", "LREM", "LSET", "LTRIM",
  "MGET", "MONITOR", "MOVE", "MSET", "MSETNX", "MULTI",
  "OBJECT", "PERSIST", "PEXPIRE", "PEXPIREAT",
  "PFADD", "PFCOUNT", "PFMERGE", "PING", "PSETEX",
  "PSUBSCRIBE", "PTTL", "PUBLISH", "PUBSUB", "PUNSUBSCRIBE",
  "RANDOMKEY", "RENAME", "RENAMENX", "RESTORE", "ROLE",
  "RPOP", "RPOPLPUSH", "RPUSH", "RPUSHX",
  "SADD", "SAVE", "SCAN", "SCARD", "SDIFF", "SDIFFSTORE",
  "SELECT", "SET", "SETEX", "SETNX", "SETRANGE", "SHUTDOWN",
  "SINTER", "SINTERSTORE", "SISMEMBER", "SMEMBERS", "SMISMEMBER",
  "SMOVE", "SORT", "SPOP", "SRANDMEMBER", "SREM", "SSCAN",
  "STRLEN", "SUBSCRIBE", "SUNION", "SUNIONSTORE", "SWAPDB",
  "TIME", "TOUCH", "TTL", "TYPE", "UNLINK", "UNSUBSCRIBE",
  "UNWATCH", "WAIT", "WATCH",
  "XACK", "XADD", "XCLAIM", "XDEL", "XGROUP", "XINFO",
  "XLEN", "XPENDING", "XRANGE", "XREAD", "XREADGROUP",
  "XREVRANGE", "XTRIM",
  "ZADD", "ZCARD", "ZCOUNT", "ZINCRBY", "ZINTERSTORE",
  "ZLEXCOUNT", "ZPOPMAX", "ZPOPMIN", "ZRANDMEMBER",
  "ZRANGE", "ZRANGEBYLEX", "ZRANGEBYSCORE", "ZRANK",
  "ZREM", "ZREMRANGEBYLEX", "ZREMRANGEBYRANK", "ZREMRANGEBYSCORE",
  "ZREVRANGE", "ZREVRANGEBYLEX", "ZREVRANGEBYSCORE", "ZREVRANK",
  "ZSCAN", "ZSCORE", "ZUNIONSTORE",
].map(cmd => ({ label: cmd, type: "keyword" }))

const redisSource = completeFromList(RedisKeywords)

// ── MongoDB keywords ───────────────────────────────────────────────

const MongoKeywords: Completion[] = [
  // Shell
  "db", "use", "show",
  // Collection methods
  "find", "findOne", "findOneAndUpdate", "findOneAndDelete",
  "findOneAndReplace", "insertOne", "insertMany", "updateOne",
  "updateMany", "deleteOne", "deleteMany", "replaceOne",
  "aggregate", "countDocuments", "estimatedDocumentCount", "distinct",
  "createIndex", "dropIndex", "getIndexes", "createCollection",
  "drop", "renameCollection", "explain", "bulkWrite", "watch",
  // Aggregation stages
  "$match", "$group", "$project", "$sort", "$limit", "$skip",
  "$unwind", "$lookup", "$addFields", "$set", "$unset",
  "$replaceRoot", "$facet", "$bucket", "$bucketAuto", "$count",
  "$merge", "$out", "$sample", "$graphLookup", "$unionWith",
  // Query operators
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin",
  "$and", "$or", "$not", "$nor", "$exists", "$type", "$regex",
  "$expr", "$all", "$elemMatch", "$size",
  // Update operators
  "$push", "$pull", "$addToSet", "$pop", "$inc", "$min", "$max",
  "$mul", "$rename", "$currentDate",
  // Types
  "ObjectId", "ISODate", "NumberLong", "NumberInt", "NumberDecimal",
  "Timestamp", "BinData", "UUID",
].map(kw => ({ label: kw, type: "keyword" }))

const mongoSource = completeFromList(MongoKeywords)

// ── SQL alias analysis ─────────────────────────────────────────────

type QuerySource = { name: string; alias?: string }

const TableKw = /^(from|join|inner|left|right|cross|full|natural|update|delete|into)$/i
const AliasStop = /^(where|inner|left|right|on|join|set|order|group|having|limit|union|into|values|cross|full|natural|select)$/i
const SkipColumnCtx = /^(FROM|JOIN|UPDATE|DELETE|INTO|TABLE|INDEX|VIEW|DATABASE|SCHEMA|EXEC|EXECUTE|CALL)$/

/** Strip backticks (MySQL), double quotes (PG/ANSI), square brackets (SQL Server) */
function stripQuotes(s: string): string {
  return s.replace(/^[`"\[]+|[`"\]]+$/g, "")
}

function analyseQuerySources(sql: string, knownTables: string[]): QuerySource[] {
  const upper = new Set(knownTables.map(n => n.toUpperCase()))
  const tokens = sql.split(/\s+/).filter(Boolean)
  const out: QuerySource[] = []

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[,;]+$/, "")
    if (!raw) continue
    const prev = i > 0 ? stripQuotes(tokens[i - 1].replace(/[,;]+$/, "")) : ""
    if (!TableKw.test(prev)) continue

    const parts = raw.split(".")
    const tableName = stripQuotes(parts[parts.length - 1])
    if (!upper.has(tableName.toUpperCase())) continue

    let next = tokens[i + 1]?.replace(/[,;]+$/, "")
    if (next) next = stripQuotes(next)
    if (next && /^as$/i.test(next)) {
      next = tokens[i + 2]?.replace(/[,;]+$/, "")
      if (next) next = stripQuotes(next)
    }
    const alias =
      next && !AliasStop.test(next) && /^[a-zA-Z_]\w*$/.test(next)
        ? next
        : undefined

    out.push({ name: tableName, alias })
  }
  return out
}

// ── Schema flattening ──────────────────────────────────────────────

type FlatSchema = {
  tableNames: string[]
  columns: Map<string, string[]>
}

function flattenSchema(ns: SQLNamespace | undefined): FlatSchema {
  const r: FlatSchema = { tableNames: [], columns: new Map() }
  if (!ns || Array.isArray(ns)) return r

  for (const [key, value] of Object.entries(ns)) {
    if (Array.isArray(value)) {
      r.tableNames.push(key)
      r.columns.set(key.toLowerCase(), value.map(c => typeof c === "string" ? c : c.label))
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [tbl, cols] of Object.entries(value)) {
        if (Array.isArray(cols)) {
          if (!r.tableNames.includes(tbl)) r.tableNames.push(tbl)
          r.columns.set(tbl.toLowerCase(), cols.map(c => typeof c === "string" ? c : c.label))
        }
      }
    }
  }
  return r
}

// ── Smart SQL completion (alias-aware dots + bare column names) ────

function createSmartSqlCompletion(
  getSchema: () => SQLNamespace | undefined,
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const schema = getSchema()
    if (!schema) return null
    const flat = flattenSchema(schema)
    if (flat.tableNames.length === 0) return null

    const pos = ctx.pos
    const line = ctx.state.doc.lineAt(pos)
    const lineBefore = line.text.slice(0, pos - line.from)

    // Dot completion: alias.col
    const dotMatch = lineBefore.match(/([a-zA-Z_]\w*)\.(\w*)$/)
    if (dotMatch) {
      const prefix = dotMatch[1]
      const from = pos - dotMatch[2].length
      const fullText = ctx.state.doc.toString()
      const sources = analyseQuerySources(fullText, flat.tableNames)
      const src = sources.find(
        s => (s.alias ?? s.name).toLowerCase() === prefix.toLowerCase(),
      )
      if (!src) return null
      const cols = flat.columns.get(src.name.toLowerCase())
      if (!cols?.length) return null
      return {
        from,
        options: cols.map(col => ({
          label: col,
          type: "property",
          detail: src.name,
          boost: 20,
        })),
        validFor: /^\w*$/,
      }
    }

    // Bare column names from referenced tables
    const wordMatch = lineBefore.match(/([a-zA-Z_]\w*)$/)
    if (!wordMatch && !ctx.explicit) return null

    const before = wordMatch
      ? lineBefore.slice(0, -wordMatch[1].length).trimEnd()
      : lineBefore.trimEnd()
    const kwMatch = before.match(/(\w+)\s*$/)
    if (kwMatch && SkipColumnCtx.test(kwMatch[1].toUpperCase())) return null

    const fullText = ctx.state.doc.toString()
    const sources = analyseQuerySources(fullText, flat.tableNames)
    if (sources.length === 0) return null

    const from = wordMatch ? pos - wordMatch[1].length : pos
    const options: Completion[] = []
    const seen = new Set<string>()

    for (const src of sources) {
      const cols = flat.columns.get(src.name.toLowerCase())
      if (!cols) continue
      for (const col of cols) {
        const key = col.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        options.push({
          label: col,
          type: "property",
          detail: src.name,
          boost: 5,
        })
      }
    }

    return options.length > 0
      ? { from, options, validFor: /^\w*$/ }
      : null
  }
}

// ── Main export: all completion sources for a DB kind ──────────────

export function createDbCompletionSources(
  getKind: () => DbConnectionKind,
  getSchema: () => SQLNamespace | undefined,
  getDefaultSchema: () => string | undefined,
): CompletionSource[] {
  const kwSource: CompletionSource = (ctx) => {
    const kind = getKind()
    if (kind === "redis") return redisSource(ctx)
    if (kind === "mongodb") return mongoSource(ctx)
    return sqlKeywordSource(ctx)
  }

  // Cache for schema source (recreate only when schema/dialect changes)
  let _schemaRef: SQLNamespace | undefined
  let _defaultSchemaRef: string | undefined
  let _schDialect: SQLDialect | undefined
  let _schSource: CompletionSource | null = null

  const schSource: CompletionSource = async (ctx) => {
    const kind = getKind()
    if (kind === "redis" || kind === "mongodb") return null
    const schema = getSchema()
    if (!schema) return null
    const dialect = getSqlDialect(kind) ?? undefined
    const defaultSchema = getDefaultSchema()
    if (schema !== _schemaRef || defaultSchema !== _defaultSchemaRef || dialect !== _schDialect) {
      _schemaRef = schema
      _defaultSchemaRef = defaultSchema
      _schDialect = dialect
      _schSource = schemaCompletionSource({ schema, defaultSchema, dialect })
    }
    const result = _schSource!(ctx)
    if (!result) return null
    const resolved = result instanceof Promise ? await result : result
    if (!resolved) return null

    // Auto-quote: if the completion follows a quoted parent (e.g. "public".)
    // but the cursor is NOT already inside quotes, wrap completions in quotes.
    const quoteChar = kind === "mysql" || kind === "tidb" ? "`" : '"'
    const textBefore = ctx.state.sliceDoc(Math.max(0, resolved.from - 2), resolved.from)
    const needsQuote = textBefore.endsWith(quoteChar + ".")
    const charAfter = ctx.state.sliceDoc(ctx.pos, ctx.pos + 1)
    const alreadyQuoted = ctx.state.sliceDoc(Math.max(0, resolved.from - 1), resolved.from) === quoteChar

    if (needsQuote && !alreadyQuoted) {
      return {
        ...resolved,
        options: resolved.options.map(opt => {
          const raw = opt.label.replace(/^[`"\[]+|[`"\]]+$/g, "")
          const closing = charAfter === quoteChar ? "" : quoteChar
          return { ...opt, apply: quoteChar + raw + closing }
        }),
      }
    }
    return resolved
  }

  // Smart source (alias + bare columns) — only for SQL databases
  const smartSource = createSmartSqlCompletion(getSchema)
  const colSource: CompletionSource = (ctx) => {
    const kind = getKind()
    if (kind === "redis" || kind === "mongodb") return null
    return smartSource(ctx)
  }

  return [kwSource, schSource, colSource]
}
