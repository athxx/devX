export type SshAuthMethod = "password" | "key";
export type SshTarget = "local" | "remote";

export type SshProfile = {
  id: string;
  name: string;
  folderId?: string | null;
  target: SshTarget;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type SshFolder = {
  id: string;
  name: string;
};

export type SshWorkspaceState = {
  folders: SshFolder[];
  profiles: SshProfile[];
};

export type SshConnectPayload = {
  type: "connect";
  target: SshTarget;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  cols: number;
  rows: number;
};

export type SshResizePayload = {
  type: "resize";
  cols: number;
  rows: number;
};
