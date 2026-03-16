export type ToolStatus = "ready" | "planned";

export type ToolDefinition = {
  id: string;
  name: string;
  summary: string;
  category: string;
  status: ToolStatus;
};

export const tools: ToolDefinition[] = [
  {
    id: "api-client",
    name: "API Requests",
    summary: "Compose REST requests, inspect responses, and keep request history.",
    category: "Network",
    status: "ready"
  },
  {
    id: "ws-client",
    name: "WebSocket",
    summary: "Open test sessions against WebSocket endpoints from the extension UI.",
    category: "Network",
    status: "ready"
  },
  {
    id: "data-format",
    name: "Format Convert",
    summary: "Convert JSON, YAML, XML, Base64, URL params, and plain text snippets.",
    category: "Transform",
    status: "ready"
  },
  {
    id: "text-diff",
    name: "Text Diff",
    summary: "Compare request payloads, config files, and response snapshots.",
    category: "Transform",
    status: "ready"
  },
  {
    id: "query-lab",
    name: "Query Lab",
    summary: "Prepare future SQL and data query tooling without changing the shell.",
    category: "Data",
    status: "planned"
  },
  {
    id: "ssh-console",
    name: "SSH",
    summary: "Scoped out for later because a pure extension cannot do raw TCP safely.",
    category: "Remote",
    status: "planned"
  }
];

