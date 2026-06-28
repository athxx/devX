import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import {
  type AiProvider,
  type DbAiSettings,
  defaultBaseUrlForProvider,
  defaultModelForProvider,
  isAiConfigured,
  loadDbAiSettings,
  saveDbAiSettings,
} from "../../ai/ai-settings";
import {
  type AiOperation,
  assessSqlSafety,
  buildMessages,
  buildSchemaHint,
  operationProducesSql,
  stripCodeFences,
} from "../../ai/ai-operations";
import { AiError, runAiChat } from "../../ai/ai-service";
import { getDbAdapter } from "../../adapters/registry";
import { useDbPanel } from "../db-panel-context";

type HistoryEntry = {
  operation: AiOperation;
  request: string;
  output: string;
  isSql: boolean;
};

const OPERATION_LABELS: Record<AiOperation, string> = {
  generate: "生成 SQL",
  explain: "解释",
  optimize: "优化",
  fix: "修复",
};

export function DbAiSidebar(props: { onClose: () => void }) {
  const panel = useDbPanel();

  const [settings, { mutate: setSettings, refetch: reloadSettings }] =
    createResource(loadDbAiSettings);
  const [showSettings, setShowSettings] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal<AiOperation | null>(null);
  const [error, setError] = createSignal("");
  const [history, setHistory] = createSignal<HistoryEntry[]>([]);

  const configured = createMemo(() => {
    const s = settings();
    return s ? isAiConfigured(s) : false;
  });

  function dialectName(): string {
    const connection = panel.activeConnection();
    if (!connection) return "SQL";
    return getDbAdapter(connection.kind).displayName();
  }

  function currentSchemaHint(): string {
    const connection = panel.activeConnection();
    const tab = panel.activeTab();
    if (!connection || !tab) return "";
    const cache = panel.schemaCompletionCache();
    const namespace =
      cache[panel.schemaCompletionKey(connection.id, tab.databaseName)] ??
      cache[connection.id];
    return buildSchemaHint(namespace);
  }

  async function runOperation(operation: AiOperation) {
    setError("");
    const s = settings();
    if (!s) return;
    if (!isAiConfigured(s)) {
      setShowSettings(true);
      setError("请先配置模型（API Key / Base URL / 模型名）。");
      return;
    }
    const connection = panel.activeConnection();
    if (!connection) {
      setError("请先选择一个数据库连接。");
      return;
    }

    const sql = panel.getEffectiveQuery().trim();
    if (operation !== "generate" && !sql) {
      setError("编辑器为空：请先输入或选中一段 SQL。");
      return;
    }
    if (operation === "generate" && !prompt().trim()) {
      setError("请先输入自然语言需求。");
      return;
    }

    const messages = buildMessages(operation, {
      kind: connection.kind,
      dialectName: dialectName(),
      sql,
      schemaHint: currentSchemaHint(),
      prompt: prompt(),
    });

    setBusy(operation);
    try {
      const raw = await runAiChat(s, messages);
      const isSql = operationProducesSql(operation);
      const output = isSql ? stripCodeFences(raw) : raw;
      setHistory((current) => [
        {
          operation,
          request: operation === "generate" ? prompt() : sql,
          output,
          isSql,
        },
        ...current,
      ]);
      if (operation === "generate") setPrompt("");
    } catch (err) {
      setError(
        err instanceof AiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "请求失败。",
      );
    } finally {
      setBusy(null);
    }
  }

  function applyToEditor(entry: HistoryEntry) {
    panel.applyTextResult(entry.output);
  }

  function runFromEditor() {
    void panel.runCurrentTab();
  }

  return (
    <div
      class="flex h-full w-[340px] flex-none flex-col border-l"
      style={{ "border-color": "var(--app-border)" }}
    >
      <div
        class="flex items-center gap-2 border-b px-3 py-2"
        style={{ "border-color": "var(--app-border)" }}
      >
        <span class="text-sm font-semibold">AI 助手</span>
        <div class="ml-auto flex items-center gap-1">
          <button
            class="theme-control h-7 rounded-md px-2 text-xs font-medium"
            title="设置"
            onClick={() => setShowSettings((v) => !v)}
          >
            设置
          </button>
          <button
            class="theme-control h-7 w-7 rounded-md p-0 text-sm"
            title="关闭"
            onClick={() => props.onClose()}
          >
            ×
          </button>
        </div>
      </div>

      <Show when={showSettings()}>
        <AiSettingsForm
          settings={settings()}
          onSaved={(next) => {
            setSettings(next);
            void reloadSettings();
            setShowSettings(false);
          }}
        />
      </Show>

      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <Show when={!configured() && !showSettings()}>
          <div class="theme-text-soft rounded-md border border-dashed p-2 text-xs" style={{ "border-color": "var(--app-border)" }}>
            尚未配置模型。点击右上角“设置”填写 API Key 与模型。
          </div>
        </Show>

        <textarea
          class="theme-input min-h-[72px] w-full resize-y rounded-md px-3 py-2 text-sm"
          placeholder="用自然语言描述你想要的查询，例如：统计每个用户最近 30 天的订单数"
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
        />

        <div class="flex flex-wrap gap-2">
          <button
            class="theme-success h-8 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
            disabled={busy() !== null}
            onClick={() => void runOperation("generate")}
          >
            {busy() === "generate" ? "生成中…" : "生成 SQL"}
          </button>
          <For each={["explain", "optimize", "fix"] as AiOperation[]}>
            {(op) => (
              <button
                class="theme-control h-8 rounded-md px-3 text-sm font-medium disabled:opacity-50"
                disabled={busy() !== null}
                onClick={() => void runOperation(op)}
              >
                {busy() === op ? "处理中…" : OPERATION_LABELS[op]}
              </button>
            )}
          </For>
        </div>

        <Show when={error()}>
          <div class="theme-warn rounded-md p-2 text-xs">{error()}</div>
        </Show>

        <For each={history()}>
          {(entry) => (
            <AiResultCard
              entry={entry}
              onApply={() => applyToEditor(entry)}
              onRun={() => {
                applyToEditor(entry);
                runFromEditor();
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function AiResultCard(props: {
  entry: HistoryEntry;
  onApply: () => void;
  onRun: () => void;
}) {
  const safety = createMemo(() =>
    props.entry.isSql ? assessSqlSafety(props.entry.output) : null,
  );
  const [confirming, setConfirming] = createSignal(false);

  function handleRun() {
    const s = safety();
    if (s?.destructive && !confirming()) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    props.onRun();
  }

  return (
    <div
      class="rounded-md border p-2"
      style={{ "border-color": "var(--app-border)" }}
    >
      <div class="theme-text-soft mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide">
        <span>{OPERATION_LABELS[props.entry.operation]}</span>
      </div>
      <pre
        class="max-h-60 overflow-auto whitespace-pre-wrap rounded p-2 text-xs"
        style={{ background: "var(--app-code)" }}
      >
        {props.entry.output}
      </pre>
      <Show when={props.entry.isSql}>
        <Show when={safety()?.reason}>
          <div class="theme-warn mt-2 rounded p-2 text-[11px]">
            ⚠ {safety()?.reason}
          </div>
        </Show>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            class="theme-control h-7 rounded-md px-2 text-xs font-medium"
            onClick={() => props.onApply()}
          >
            填入编辑器
          </button>
          <button
            class="theme-success h-7 rounded-md px-2 text-xs font-semibold"
            onClick={() => handleRun()}
          >
            {confirming() ? "确认执行？" : "填入并运行"}
          </button>
          <Show when={confirming()}>
            <button
              class="theme-control h-7 rounded-md px-2 text-xs font-medium"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function AiSettingsForm(props: {
  settings: DbAiSettings | undefined;
  onSaved: (next: DbAiSettings) => void;
}) {
  const initial = props.settings;
  const [provider, setProvider] = createSignal<AiProvider>(
    initial?.provider ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = createSignal(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = createSignal(initial?.apiKey ?? "");
  const [model, setModel] = createSignal(
    initial?.model ?? defaultModelForProvider("anthropic"),
  );
  const [useProxy, setUseProxy] = createSignal(initial?.useProxy ?? true);
  const [saving, setSaving] = createSignal(false);

  function onProviderChange(next: AiProvider) {
    setProvider(next);
    // Reset model/baseUrl to the new provider's defaults when they still match
    // the old default (avoid clobbering a user's custom value).
    if (!model().trim() || model() === defaultModelForProvider(provider())) {
      setModel(defaultModelForProvider(next));
    }
    if (!baseUrl().trim()) {
      setBaseUrl(defaultBaseUrlForProvider(next));
    }
  }

  async function save() {
    setSaving(true);
    const next: DbAiSettings = {
      provider: provider(),
      baseUrl: baseUrl().trim(),
      apiKey: apiKey().trim(),
      model: model().trim() || defaultModelForProvider(provider()),
      useProxy: useProxy(),
    };
    try {
      await saveDbAiSettings(next);
      props.onSaved(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      class="flex flex-col gap-2 border-b p-3 text-sm"
      style={{ "border-color": "var(--app-border)" }}
    >
      <label class="flex flex-col gap-1">
        <span class="theme-text-soft text-xs">服务商</span>
        <select
          class="theme-input h-8 rounded-md px-2 text-sm"
          value={provider()}
          onInput={(event) =>
            onProviderChange(event.currentTarget.value as AiProvider)
          }
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai-compatible">OpenAI 兼容</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="theme-text-soft text-xs">
          Base URL{provider() === "anthropic" ? "（留空用官方地址）" : ""}
        </span>
        <input
          class="theme-input h-8 rounded-md px-2 text-sm"
          placeholder={
            provider() === "anthropic"
              ? "https://api.anthropic.com"
              : "https://your-endpoint/v1"
          }
          value={baseUrl()}
          onInput={(event) => setBaseUrl(event.currentTarget.value)}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="theme-text-soft text-xs">API Key</span>
        <input
          class="theme-input h-8 rounded-md px-2 text-sm"
          type="password"
          value={apiKey()}
          onInput={(event) => setApiKey(event.currentTarget.value)}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="theme-text-soft text-xs">模型</span>
        <input
          class="theme-input h-8 rounded-md px-2 text-sm"
          value={model()}
          onInput={(event) => setModel(event.currentTarget.value)}
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={useProxy()}
          onInput={(event) => setUseProxy(event.currentTarget.checked)}
        />
        <span>通过本地中转（/api 代理）转发请求</span>
      </label>
      <button
        class="theme-success h-8 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
        disabled={saving()}
        onClick={() => void save()}
      >
        {saving() ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
