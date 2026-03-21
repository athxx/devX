import { readDevxSection, writeDevxSection } from "../../lib/indexed-db";
import type { SshProfile, SshWorkspaceState } from "./models";

export async function loadSshWorkspace(): Promise<SshWorkspaceState | null> {
  const stored = await readDevxSection<SshWorkspaceState | SshProfile[]>(["ssh"]);
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
  await writeDevxSection(["ssh"], workspace);
}
