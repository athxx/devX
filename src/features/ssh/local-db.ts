import { loadIndexedDbValue, saveIndexedDbValue } from "../../lib/indexed-db";
import type { SshProfile, SshWorkspaceState } from "./models";

const SSH_PROFILES_KEY = "ssh-profiles";

export async function loadSshWorkspace(): Promise<SshWorkspaceState | null> {
  const stored = await loadIndexedDbValue<SshWorkspaceState | SshProfile[]>(SSH_PROFILES_KEY);
  if (!stored) {
    return null;
  }

  if (Array.isArray(stored)) {
    return {
      folders: [],
      profiles: stored.map((profile) => ({ ...profile, folderId: null }))
    };
  }

  return stored;
}

export async function saveSshWorkspace(workspace: SshWorkspaceState): Promise<void> {
  await saveIndexedDbValue(SSH_PROFILES_KEY, workspace);
}
