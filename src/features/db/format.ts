import { format as sqlFormat } from "sql-formatter"
import type { DbConnectionKind } from "./models"

type SqlFormatterLanguage =
  | "sql"
  | "mysql"
  | "postgresql"
  | "sqlite"
  | "transactsql"
  | "plsql"

function getSqlDialect(kind: DbConnectionKind): SqlFormatterLanguage | null {
  switch (kind) {
    case "mysql":
    case "tidb":
      return "mysql"
    case "postgresql":
    case "gaussdb":
      return "postgresql"
    case "sqlite":
      return "sqlite"
    case "sqlserver":
      return "transactsql"
    case "oracle":
      return "plsql"
    case "clickhouse":
      return "sql"
    default:
      return null
  }
}

async function formatJavaScript(code: string): Promise<string> {
  const prettier = await import("prettier/standalone")
  const babelPlugin = await import("prettier/plugins/babel")
  const estreePlugin = await import("prettier/plugins/estree")
  return prettier.format(code, {
    parser: "babel",
    plugins: [babelPlugin.default ?? babelPlugin, estreePlugin.default ?? estreePlugin],
    semi: false,
    singleQuote: true,
    printWidth: 80,
    tabWidth: 2,
  })
}

export function supportsFormat(kind: DbConnectionKind): boolean {
  return kind !== "redis"
}

export async function formatQuery(
  kind: DbConnectionKind,
  query: string,
): Promise<string> {
  if (kind === "mongodb") {
    return formatJavaScript(query)
  }

  const dialect = getSqlDialect(kind)
  if (!dialect) return query

  return sqlFormat(query, {
    language: dialect,
    tabWidth: 2,
    useTabs: false,
    keywordCase: "upper",
    linesBetweenQueries: 2,
  })
}
