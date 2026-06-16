import { format as sqlFormat } from "sql-formatter"
import type { DbConnectionKind } from "./models"
import { getDbAdapter } from "./adapters"

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
  return getDbAdapter(kind).formatLanguage() !== null
}

/**
 * Compact SQL/text: collapse each statement to a single line.
 * Statements separated by `;` are kept on separate lines.
 */
export function compactQuery(kind: DbConnectionKind, query: string): string {
  const language = getDbAdapter(kind).formatLanguage()
  if (language === null) return query

  if (language === "javascript") {
    // MongoDB: collapse all whitespace to single spaces
    return query.replace(/\s+/g, " ").trim()
  }

  // SQL: split on `;` (respecting quoted strings), collapse each statement
  const statements: string[] = []
  let current = ""
  let inQuote: string | null = null

  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (inQuote) {
      current += ch
      if (ch === inQuote && query[i - 1] !== "\\") inQuote = null
    } else if (ch === "'" || ch === '"' || ch === "`") {
      current += ch
      inQuote = ch
    } else if (ch === ";") {
      const trimmed = current.replace(/\s+/g, " ").trim()
      if (trimmed) statements.push(trimmed)
      current = ""
    } else {
      current += ch
    }
  }
  const last = current.replace(/\s+/g, " ").trim()
  if (last) statements.push(last)

  return statements.join("\n")
}

export async function formatQuery(
  kind: DbConnectionKind,
  query: string,
): Promise<string> {
  const language = getDbAdapter(kind).formatLanguage()
  if (language === null) return query

  if (language === "javascript") {
    return formatJavaScript(query)
  }

  return sqlFormat(query, {
    language,
    tabWidth: 2,
    useTabs: false,
    keywordCase: "upper",
    linesBetweenQueries: 2,
  })
}
