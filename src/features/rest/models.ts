export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "TRACE"
  | "CONNECT";
export type RequestKind = "http" | "curl" | "websocket" | "graphql" | "socketio";

export type KeyValueEntry = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  valueType?: "text" | "file";
  fileName?: string;
  fileContent?: string;
  fileContentType?: string;
};

export type AuthType = "none" | "bearer" | "basic" | "api-key";
export type BodyType =
  | "none"
  | "json"
  | "form-data"
  | "form-urlencoded"
  | "raw"
  | "binary";

export type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "api-key"; key: string; value: string; addTo: "header" | "query" };

export type RequestBody =
  | { type: "none" }
  | { type: "json"; value: string }
  | { type: "form-data"; entries: KeyValueEntry[] }
  | { type: "raw"; value: string; contentType: string }
  | { type: "form-urlencoded"; entries: KeyValueEntry[] }
  | { type: "binary"; value: string };

export type RequestScripts = {
  preRequest: string;
  postResponse: string;
};

export type RequestDraft = {
  id: string;
  name: string;
  createdAt: string;
  collectionId: string;
  folderId?: string | null;
  kind: RequestKind;
  method: RequestMethod;
  url: string;
  query: KeyValueEntry[];
  headers: KeyValueEntry[];
  body: RequestBody;
  auth: RequestAuth;
  scripts: RequestScripts;
};

export type CollectionFolder = {
  id: string;
  name: string;
  requestIds: string[];
};

export type Collection = {
  id: string;
  name: string;
  folders: CollectionFolder[];
  requestIds: string[];
};

export type Environment = {
  id: string;
  name: string;
  variables: KeyValueEntry[];
};

export type HistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: RequestMethod;
  status: number | null;
  timeMs: number;
  createdAt: string;
  requestSnapshot: RequestDraft;
};

export type ResponseSummary = {
  ok: boolean;
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  contentType: string;
  body: string;
  headers: KeyValueEntry[];
  finalUrl: string;
};

export type StoredResponseSummary = {
  requestId: string;
  response: ResponseSummary;
};

export type RestWorkspaceState = {
  collections: Collection[];
  requests: RequestDraft[];
  environments: Environment[];
  history: HistoryEntry[];
  lastResponse: StoredResponseSummary | null;
  openRequestIds: string[];
  pinnedRequestIds: string[];
  activeCollectionId: string;
  activeRequestId: string;
  activeEnvironmentId: string;
};
