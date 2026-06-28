import { loadProxySettings } from "../../proxy/service";
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_VERSION,
  type DbAiSettings,
} from "./ai-settings";

// AI service: turns a chat-style request into a single LLM call. Two transports
// are supported — Anthropic Messages API and any OpenAI-compatible
// /chat/completions endpoint — and either can be routed through the existing Go
// relay (/api proxy) so the request originates from the local server rather than
// the browser. We add NO new backend route: the proxy forwards anything carrying
// `x-ason-proxy: devx` + `x-ason-url: <target>` (see server proxy handler).

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class AiError extends Error {}

type ProxyContext = {
  proxyEndpoint: string;
};

async function resolveProxyEndpoint(): Promise<string> {
  const proxy = await loadProxySettings();
  const endpoint = proxy.api.address.trim();
  if (!endpoint) {
    throw new AiError(
      "API 代理地址未配置，请在设置中填写中转地址，或关闭“通过代理转发”。",
    );
  }
  return endpoint;
}

/**
 * Build the fetch URL + headers for a target upstream, optionally tunnelled
 * through the local /api proxy. When proxied, the real destination travels in
 * `x-ason-url` and the body/headers are forwarded verbatim.
 */
function withProxy(
  targetUrl: string,
  headers: Record<string, string>,
  ctx: ProxyContext | null,
): { url: string; headers: Record<string, string> } {
  if (!ctx) {
    return { url: targetUrl, headers };
  }
  return {
    url: ctx.proxyEndpoint,
    headers: {
      ...headers,
      "x-ason-proxy": "devx",
      "x-ason-url": targetUrl,
    },
  };
}

function splitMessages(messages: AiChatMessage[]): {
  system: string;
  turns: AiChatMessage[];
} {
  const systemParts: string[] = [];
  const turns: AiChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      turns.push(message);
    }
  }
  return { system: systemParts.join("\n\n"), turns };
}

async function callAnthropic(
  settings: DbAiSettings,
  messages: AiChatMessage[],
  ctx: ProxyContext | null,
): Promise<string> {
  const base = (settings.baseUrl.trim() || ANTHROPIC_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const targetUrl = `${base}/v1/messages`;
  const { system, turns } = splitMessages(messages);

  const body = JSON.stringify({
    model: settings.model,
    max_tokens: 4096,
    ...(system ? { system } : {}),
    messages: turns.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });

  const { url, headers } = withProxy(
    targetUrl,
    {
      "content-type": "application/json",
      "x-api-key": settings.apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
      // Allows the browser to call the Anthropic API directly when not proxied.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    ctx,
  );

  const response = await fetch(url, { method: "POST", headers, body });
  const text = await response.text();
  if (!response.ok) {
    throw new AiError(`模型请求失败（${response.status}）：${text.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError(`无法解析模型响应：${text.slice(0, 500)}`);
  }

  const content = (parsed as { content?: Array<{ type: string; text?: string }> })
    .content;
  if (!Array.isArray(content)) {
    throw new AiError(`模型响应缺少 content 字段：${text.slice(0, 500)}`);
  }
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
}

async function callOpenAiCompatible(
  settings: DbAiSettings,
  messages: AiChatMessage[],
  ctx: ProxyContext | null,
): Promise<string> {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new AiError("OpenAI 兼容模式需要填写 Base URL。");
  }
  // Accept both a bare base ("https://host/v1") and a full endpoint.
  const targetUrl = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;

  const body = JSON.stringify({
    model: settings.model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    temperature: 0.2,
  });

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey.trim()) {
    headers.authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  const proxied = withProxy(targetUrl, headers, ctx);
  const response = await fetch(proxied.url, {
    method: "POST",
    headers: proxied.headers,
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AiError(`模型请求失败（${response.status}）：${text.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiError(`无法解析模型响应：${text.slice(0, 500)}`);
  }

  const message = (
    parsed as {
      choices?: Array<{ message?: { content?: string } }>;
    }
  ).choices?.[0]?.message?.content;
  if (typeof message !== "string") {
    throw new AiError(`模型响应缺少 choices 字段：${text.slice(0, 500)}`);
  }
  return message.trim();
}

/** Send a chat completion and return the assistant's text. */
export async function runAiChat(
  settings: DbAiSettings,
  messages: AiChatMessage[],
): Promise<string> {
  const ctx: ProxyContext | null = settings.useProxy
    ? { proxyEndpoint: await resolveProxyEndpoint() }
    : null;

  if (settings.provider === "anthropic") {
    return callAnthropic(settings, messages, ctx);
  }
  return callOpenAiCompatible(settings, messages, ctx);
}
