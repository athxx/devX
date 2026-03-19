import { loadProxySettings } from "../proxy/service";
import {
  loadSshWorkspace as loadStoredSshWorkspace,
  saveSshWorkspace
} from "./local-db";
import type { SshFolder, SshProfile, SshWorkspaceState } from "./models";

function normalizeSshProfile(profile: SshProfile, folderIds: Set<string>): SshProfile {
  return {
    ...profile,
    folderId: profile.folderId && folderIds.has(profile.folderId) ? profile.folderId : null,
    target: profile.target ?? "remote",
    port: profile.port ?? 22,
    authMethod: profile.authMethod ?? "password",
    host: profile.host ?? "",
    username: profile.username ?? "",
    password: profile.password ?? "",
    privateKey: profile.privateKey ?? "",
    passphrase: profile.passphrase ?? ""
  };
}

function normalizeSshFolder(folder: SshFolder): SshFolder {
  return {
    id: folder.id,
    name: folder.name?.trim() || "New Folder"
  };
}

function normalizeWorkspace(workspace: SshWorkspaceState): SshWorkspaceState {
  const folders = (workspace.folders ?? []).map(normalizeSshFolder);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const profiles = (workspace.profiles ?? []).map((profile) =>
    normalizeSshProfile(profile, folderIds)
  );

  return {
    folders,
    profiles
  };
}

export { saveSshWorkspace };

export async function loadSshWorkspace(): Promise<SshWorkspaceState> {
  const stored = await loadStoredSshWorkspace();
  const normalized = normalizeWorkspace(
    stored ?? {
      folders: [],
      profiles: []
    }
  );

  if (!stored || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await saveSshWorkspace(normalized);
  }

  return normalized;
}

export async function addSshProfile(profile: SshProfile): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const folderIds = new Set(workspace.folders.map((folder) => folder.id));
  const next = {
    ...workspace,
    profiles: [...workspace.profiles, normalizeSshProfile(profile, folderIds)]
  };
  await saveSshWorkspace(next);
  return next;
}

export async function updateSshProfile(updated: SshProfile): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const folderIds = new Set(workspace.folders.map((folder) => folder.id));
  const next = {
    ...workspace,
    profiles: workspace.profiles.map((profile) =>
      profile.id === updated.id ? normalizeSshProfile(updated, folderIds) : profile
    )
  };
  await saveSshWorkspace(next);
  return next;
}

export async function deleteSshProfile(id: string): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const next = {
    ...workspace,
    profiles: workspace.profiles.filter((profile) => profile.id !== id)
  };
  await saveSshWorkspace(next);
  return next;
}

export async function addSshFolder(folder: SshFolder): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const next = {
    ...workspace,
    folders: [...workspace.folders, normalizeSshFolder(folder)]
  };
  await saveSshWorkspace(next);
  return next;
}

export async function updateSshFolder(updated: SshFolder): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const next = {
    ...workspace,
    folders: workspace.folders.map((folder) =>
      folder.id === updated.id ? normalizeSshFolder(updated) : folder
    )
  };
  await saveSshWorkspace(next);
  return next;
}

export async function deleteSshFolder(id: string): Promise<SshWorkspaceState> {
  const workspace = await loadSshWorkspace();
  const next = {
    folders: workspace.folders.filter((folder) => folder.id !== id),
    profiles: workspace.profiles.map((profile) =>
      profile.folderId === id ? { ...profile, folderId: null } : profile
    )
  };
  await saveSshWorkspace(next);
  return next;
}

export async function buildSshRelayUrl(): Promise<string | null> {
  const settings = await loadProxySettings();
  if (settings.ssh.mode !== "proxy" || !settings.ssh.address.trim()) {
    return null;
  }
  const normalized = settings.ssh.address
    .trim()
    .replace(/\/+$/, "")
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:");

  try {
    const url = new URL(normalized);
    url.searchParams.set("x-ason-proxy", "devx");
    return url.toString();
  } catch {
    const separator = normalized.includes("?") ? "&" : "?";
    return `${normalized}${separator}x-ason-proxy=devx`;
  }
}
