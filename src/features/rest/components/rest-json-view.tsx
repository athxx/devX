import { For, Show, createMemo } from "solid-js";

export function isJsonContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

export function isHtmlContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.includes("text/html") || normalized.includes("application/xhtml+xml");
}

export function JsonPreviewNode(props: {
  value: unknown;
  name?: string;
  depth?: number;
}) {
  const depth = props.depth ?? 0;

  if (props.value === null) {
    return (
      <div class="font-mono text-sm">
        <Show when={props.name}>
          <span class="theme-text-soft mr-2">{props.name}:</span>
        </Show>
        <span class="text-[#ff6482]">null</span>
      </div>
    );
  }

  if (Array.isArray(props.value)) {
    return (
      <details class="pl-2" open={depth < 1}>
        <summary class="cursor-pointer list-none font-mono text-sm">
          <Show when={props.name}>
            <span class="theme-text-soft mr-2">{props.name}:</span>
          </Show>
          <span class="theme-text">[{props.value.length}]</span>
        </summary>
        <div class="mt-1 space-y-1 border-l pl-3" style={{ "border-color": "var(--app-border)" }}>
          <For each={props.value}>
            {(item, index) => (
              <JsonPreviewNode value={item} name={`${index()}`} depth={depth + 1} />
            )}
          </For>
        </div>
      </details>
    );
  }

  if (typeof props.value === "object") {
    const entries = Object.entries(props.value as Record<string, unknown>);

    return (
      <details class="pl-2" open={depth < 1}>
        <summary class="cursor-pointer list-none font-mono text-sm">
          <Show when={props.name}>
            <span class="theme-text-soft mr-2">{props.name}:</span>
          </Show>
          <span class="theme-text">{`{${entries.length}}`}</span>
        </summary>
        <div class="mt-1 space-y-1 border-l pl-3" style={{ "border-color": "var(--app-border)" }}>
          <For each={entries}>
            {([key, value]) => <JsonPreviewNode value={value} name={key} depth={depth + 1} />}
          </For>
        </div>
      </details>
    );
  }

  const valueType = typeof props.value;
  const valueClass =
    valueType === "string"
      ? "text-[#34c759]"
      : valueType === "number"
        ? "text-[#0a84ff]"
        : valueType === "boolean"
          ? "text-[#ff9f0a]"
          : "theme-text";

  return (
    <div class="font-mono text-sm">
      <Show when={props.name}>
        <span class="theme-text-soft mr-2">{props.name}:</span>
      </Show>
      <span class={valueClass}>
        {valueType === "string" ? `"${String(props.value)}"` : String(props.value)}
      </span>
    </div>
  );
}

type JsonHighlightToken = {
  text: string;
  className?: string;
};

function getJsonHighlightTokens(value: string): JsonHighlightToken[] | null {
  try {
    const normalized = JSON.stringify(JSON.parse(value), null, 2);
    const tokens: JsonHighlightToken[] = [];
    const tokenPattern =
      /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(normalized))) {
      if (match.index > lastIndex) {
        tokens.push({ text: normalized.slice(lastIndex, match.index) });
      }

      const [fullMatch, stringLiteral, keySuffix] = match;
      let className = "";

      if (stringLiteral) {
        className = keySuffix ? "theme-json-key" : "theme-json-string";
      } else if (fullMatch === "true" || fullMatch === "false") {
        className = "theme-json-boolean";
      } else if (fullMatch === "null") {
        className = "theme-json-null";
      } else if (/^-?\d/.test(fullMatch)) {
        className = "theme-json-number";
      } else {
        className = "theme-json-punctuation";
      }

      tokens.push({ text: fullMatch, className });
      lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < normalized.length) {
      tokens.push({ text: normalized.slice(lastIndex) });
    }

    return tokens;
  } catch {
    return null;
  }
}

export function JsonHighlightedCode(props: { value: string }) {
  const tokens = createMemo(() => getJsonHighlightTokens(props.value));

  return (
    <pre class="theme-text-muted h-full flex-1 overflow-x-auto px-3 py-3 font-mono text-sm leading-7">
      <code>
        <Show when={tokens()} fallback={props.value}>
          {(highlighted) => (
            <For each={highlighted()}>
              {(token) => (
                <Show when={token.className} fallback={token.text}>
                  <span class={token.className}>{token.text}</span>
                </Show>
              )}
            </For>
          )}
        </Show>
      </code>
    </pre>
  );
}
