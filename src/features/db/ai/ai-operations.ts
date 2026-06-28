import type { DbConnectionKind } from "../models";
import type { AiChatMessage } from "./ai-service";

// AI operations: build the message list for each assistant action and post-process
// the model's reply. The assistant only ever returns text; the caller decides
// whether to drop it into the editor or show it as an explanation.

export type AiOperation = "generate" | "explain" | "optimize" | "fix";

export type AiOperationContext = {
  /** The DB kind, so the model targets the right SQL dialect. */
  kind: DbConnectionKind;
  dialectName: string;
  /** The SQL currently in (or selected in) the editor, if any. */
  sql: string;
  /** Optional schema hint (table/column names) for grounding. */
  schemaHint?: string;
  /** For "generate": the user's natural-language request. */
  prompt?: string;
  /** For "fix": the error message returned by the database. */
  errorMessage?: string;
};

function schemaSection(schemaHint?: string): string {
  const hint = schemaHint?.trim();
  if (!hint) return "";
  return `\n\n可用的库结构（表/列名，供参考，不要臆造不存在的对象）：\n${hint}`;
}

function baseSystem(dialectName: string): string {
  return [
    `你是一个资深的数据库工程师，精通 ${dialectName} 方言的 SQL。`,
    "回答要准确、安全、可直接执行。",
  ].join("");
}

/**
 * When the action should yield runnable SQL (generate/optimize/fix), instruct the
 * model to return ONLY SQL with no prose or code fences so we can drop it straight
 * into the editor.
 */
const SQL_ONLY_INSTRUCTION =
  "只输出 SQL 语句本身，不要任何解释、注释或 Markdown 代码块标记（```）。";

export function buildMessages(
  operation: AiOperation,
  ctx: AiOperationContext,
): AiChatMessage[] {
  const system = baseSystem(ctx.dialectName);
  const schema = schemaSection(ctx.schemaHint);

  switch (operation) {
    case "generate":
      return [
        { role: "system", content: `${system}\n${SQL_ONLY_INSTRUCTION}` },
        {
          role: "user",
          content: `根据下面的自然语言需求，生成一条 ${ctx.dialectName} SQL：\n\n${ctx.prompt ?? ""}${schema}`,
        },
      ];
    case "explain":
      return [
        {
          role: "system",
          content: `${system}\n用中文清晰地分步解释 SQL 的作用、涉及的表与潜在性能问题。`,
        },
        {
          role: "user",
          content: `解释下面这条 SQL：\n\n${ctx.sql}${schema}`,
        },
      ];
    case "optimize":
      return [
        { role: "system", content: `${system}\n${SQL_ONLY_INSTRUCTION}` },
        {
          role: "user",
          content: `在保持语义不变的前提下，优化下面这条 ${ctx.dialectName} SQL 的性能（如索引利用、避免全表扫描、改写子查询等）：\n\n${ctx.sql}${schema}`,
        },
      ];
    case "fix":
      return [
        { role: "system", content: `${system}\n${SQL_ONLY_INSTRUCTION}` },
        {
          role: "user",
          content: `下面这条 ${ctx.dialectName} SQL 执行时报错，请修复它：\n\nSQL：\n${ctx.sql}\n\n错误信息：\n${ctx.errorMessage ?? "(未提供)"}${schema}`,
        },
      ];
  }
}

/** True for operations whose output is meant to replace the editor's SQL. */
export function operationProducesSql(operation: AiOperation): boolean {
  return operation !== "explain";
}

/**
 * Strip Markdown code fences the model may add despite instructions, leaving raw
 * SQL. Leaves non-fenced text untouched.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:sql)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}

const DESTRUCTIVE_PATTERN =
  /\b(drop|truncate|delete|update|alter|grant|revoke|insert|replace|merge|create)\b/i;
const UNSCOPED_WRITE_PATTERN =
  /\b(delete|update)\b(?![\s\S]*\bwhere\b)/i;

export type SqlSafety = {
  destructive: boolean;
  /** A DELETE/UPDATE with no WHERE clause — the most dangerous case. */
  unscoped: boolean;
  /** Human-readable reason, shown before the user confirms a run. */
  reason: string;
};

/**
 * Flatten a CodeMirror `SQLNamespace`-shaped completion cache into a compact
 * "table(col, col, ...)" hint for grounding the model. Accepts the loose shape
 * the cache can take (array of {label,...}, nested record, or self) and caps the
 * output so a huge schema can't blow the prompt budget.
 */
export function buildSchemaHint(namespace: unknown, maxTables = 60): string {
  if (!namespace || typeof namespace !== "object") return "";
  const lines: string[] = [];

  const labelsOf = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === "string"
            ? item
            : item && typeof item === "object" && "label" in item
              ? String((item as { label: unknown }).label)
              : "",
        )
        .filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>);
    }
    return [];
  };

  const entries = Array.isArray(namespace)
    ? []
    : Object.entries(namespace as Record<string, unknown>);

  for (const [table, cols] of entries) {
    if (lines.length >= maxTables) {
      lines.push(`… 其余 ${entries.length - maxTables} 张表已省略`);
      break;
    }
    const columns = labelsOf(
      cols && typeof cols === "object" && "children" in (cols as object)
        ? (cols as { children: unknown }).children
        : cols,
    );
    lines.push(columns.length ? `${table}(${columns.join(", ")})` : table);
  }

  return lines.join("\n");
}

/** Classify SQL for the run-with-safety confirmation gate. */
export function assessSqlSafety(sql: string): SqlSafety {
  const normalized = sql.trim();
  const destructive = DESTRUCTIVE_PATTERN.test(normalized);
  const unscoped = UNSCOPED_WRITE_PATTERN.test(normalized);
  let reason = "";
  if (unscoped) {
    reason = "检测到没有 WHERE 条件的 DELETE/UPDATE，可能影响整张表。";
  } else if (destructive) {
    reason = "检测到会修改数据或结构的语句（写入 / DDL）。";
  }
  return { destructive, unscoped, reason };
}
