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
