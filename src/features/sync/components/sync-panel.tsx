import type { JSX } from "solid-js";
import { Match, Show, Switch, createSignal, onMount } from "solid-js";
import { FieldLabel } from "../../../components/ui-primitives";
import {
  connectSyncProvider,
  disconnectSyncProvider,
  exportLocalSnapshot,
  getLocalSnapshotMeta,
  importLocalSnapshot,
  loadSyncSettings,
  runSyncCycle,
  saveSyncSettings,
} from "../service";
import {
  defaultSyncSettings,
  type SyncProviderType,
  type SyncSettings,
} from "../types";

function formatTime(value?: string) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

export function SyncPanel() {
  const [settings, setSettings] =
    createSignal<SyncSettings>(defaultSyncSettings);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<string>();
  const [localUpdatedAt, setLocalUpdatedAt] = createSignal<string>();
  let importInputRef: HTMLInputElement | undefined;

  const refreshPanel = async () => {
    const [loadedSettings, localMeta] = await Promise.all([
      loadSyncSettings(),
      getLocalSnapshotMeta(),
    ]);

    setSettings(loadedSettings);
    setLocalUpdatedAt(localMeta?.updatedAt);
  };

  onMount(() => {
    void refreshPanel();
  });

  const updateSettings = (updater: (current: SyncSettings) => SyncSettings) => {
    setSettings((current) => updater(current));
  };

  const handleSave = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const saved = await saveSyncSettings(settings());
      setSettings(saved);
      setNotice("Sync configuration saved locally.");
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const nextSettings = await connectSyncProvider(settings());
      setSettings(nextSettings);
      await refreshPanel();
      setNotice(
        nextSettings.status === "connected"
          ? "Connection established. Remote data has been merged into IndexedDB."
          : (nextSettings.lastError ?? "Connection failed."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const nextSettings = await runSyncCycle(true);
      setSettings(nextSettings);
      await refreshPanel();
      setNotice(
        nextSettings.status === "connected"
          ? "Sync completed."
          : (nextSettings.lastError ?? "Sync did not finish."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const nextSettings = await disconnectSyncProvider();
      setSettings(nextSettings);
      setNotice("Sync provider disconnected. Local IndexedDB data was kept.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    setNotice(undefined);

    try {
      const snapshot = await exportLocalSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);

      anchor.href = url;
      anchor.download = `devx-workspace-${dateStamp}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);

      await refreshPanel();
      setNotice("Workspace snapshot exported from IndexedDB.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportClick = () => {
    importInputRef?.click();
  };

  const handleImportChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    setBusy(true);
    setNotice(undefined);

    try {
      const content = await file.text();
      const payload = JSON.parse(content) as unknown;
      await importLocalSnapshot(payload);
      await refreshPanel();
      setNotice("Workspace snapshot imported into IndexedDB.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed.");
    } finally {
      input.value = "";
      setBusy(false);
    }
  };

  return (
    <div class="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_320px]">
      <div class="grid gap-4">
        <div class="grid gap-4 md:grid-cols-3">
          <FieldLabel
            label="Storage Provider"
            hint="Choose where workspace data should sync."
          >
            <select
              class="theme-input rounded-2xl px-3 py-3"
              value={settings().provider}
              onInput={(event) =>
                updateSettings((current) => ({
                  ...current,
                  provider: event.currentTarget.value as SyncProviderType,
                }))
              }
            >
              <option value="none">None (IndexedDB only)</option>
              <option value="dropbox">Dropbox</option>
              <option value="onedrive">OneDrive</option>
              <option value="gdrive">Google Drive</option>
              <option value="webdav">WebDAV</option>
            </select>
          </FieldLabel>

          <FieldLabel
            label="Auto Sync Interval"
            hint="Background sync cadence in seconds."
          >
            <input
              class="theme-input rounded-2xl px-3 py-3"
              min="15"
              step="5"
              type="number"
              value={String(
                Math.max(15, Math.round(settings().syncIntervalMs / 1000)),
              )}
              onInput={(event) =>
                updateSettings((current) => ({
                  ...current,
                  syncIntervalMs:
                    Math.max(15, Number(event.currentTarget.value) || 30) *
                    1000,
                }))
              }
            />
          </FieldLabel>

          <label class="theme-control flex items-center justify-between rounded-2xl px-4 py-3">
            <div>
              <p class="theme-text text-sm font-medium">Auto Sync</p>
              <p class="theme-text-soft mt-1 text-xs">
                Connected providers sync on a timer.
              </p>
            </div>
            <button
              class={`inline-flex h-7 w-11 items-center rounded-full px-1 transition ${
                settings().autoSync
                  ? "bg-[var(--app-accent)]"
                  : "bg-[var(--app-panel-strong)]"
              }`}
              type="button"
              onClick={() =>
                updateSettings((current) => ({
                  ...current,
                  autoSync: !current.autoSync,
                }))
              }
            >
              <span
                class={`h-5 w-5 rounded-full bg-white transition ${
                  settings().autoSync ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </label>
        </div>

        <Switch>
          <Match when={settings().provider === "dropbox"}>
            <div class="grid gap-4 md:grid-cols-2">
              <FieldLabel
                label="Dropbox Access Token"
                hint="Temporary token login for the first sync version."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  placeholder="sl.B..."
                  type="password"
                  value={settings().dropbox.accessToken}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      dropbox: {
                        ...current.dropbox,
                        accessToken: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel
                label="Remote Path"
                hint="Dropbox path used to save the snapshot JSON."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  value={settings().dropbox.remotePath}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      dropbox: {
                        ...current.dropbox,
                        remotePath: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>
            </div>
          </Match>

          <Match when={settings().provider === "onedrive"}>
            <div class="grid gap-4 md:grid-cols-2">
              <FieldLabel
                label="OneDrive Access Token"
                hint="Microsoft Graph token for reading and writing snapshots."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  placeholder="EwB..."
                  type="password"
                  value={settings().onedrive.accessToken}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      onedrive: {
                        ...current.onedrive,
                        accessToken: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel
                label="Remote Path"
                hint="Path inside the app folder or drive root."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  value={settings().onedrive.remotePath}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      onedrive: {
                        ...current.onedrive,
                        remotePath: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>
            </div>
          </Match>

          <Match when={settings().provider === "webdav"}>
            <div class="grid gap-4 md:grid-cols-2">
              <FieldLabel
                label="WebDAV Endpoint"
                hint="Base endpoint without the final file path."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  placeholder="https://dav.example.com/remote.php/dav/files/you"
                  value={settings().webdav.endpoint}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      webdav: {
                        ...current.webdav,
                        endpoint: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel
                label="Remote Path"
                hint="JSON snapshot file path in WebDAV."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  value={settings().webdav.remotePath}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      webdav: {
                        ...current.webdav,
                        remotePath: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel label="Username">
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  value={settings().webdav.username}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      webdav: {
                        ...current.webdav,
                        username: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel label="Password">
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  type="password"
                  value={settings().webdav.password}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      webdav: {
                        ...current.webdav,
                        password: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>
            </div>
          </Match>

          <Match when={settings().provider === "gdrive"}>
            <div class="grid gap-4 md:grid-cols-2">
              <FieldLabel
                label="Google Drive Access Token"
                hint="Use an OAuth 2.0 access token that already includes Drive access."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  placeholder="ya29..."
                  type="password"
                  value={settings().gdrive.accessToken}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      gdrive: {
                        ...current.gdrive,
                        accessToken: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel
                label="Snapshot File Name"
                hint="Stored inside the hidden appDataFolder in Google Drive."
              >
                <input
                  class="theme-input rounded-2xl px-3 py-3"
                  value={settings().gdrive.fileName}
                  onInput={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      gdrive: {
                        ...current.gdrive,
                        fileName: event.currentTarget.value,
                      },
                    }))
                  }
                />
              </FieldLabel>
            </div>
          </Match>

          <Match when={settings().provider === "none"}>
            <div class="theme-control rounded-3xl p-4">
              <p class="theme-text text-sm font-semibold">Local-only mode</p>
              <p class="theme-text-muted mt-2 text-sm leading-6">
                Workspace data stays in IndexedDB. This is the safest option
                while the rest of the product is still being built out.
              </p>
            </div>
          </Match>
        </Switch>

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition"
            disabled={busy()}
            onClick={handleSave}
          >
            Save Config
          </button>
          <button
            class="theme-button-primary rounded-2xl px-4 py-3 text-sm font-semibold transition"
            disabled={busy()}
            onClick={handleConnect}
          >
            Connect & Pull Remote
          </button>
          <button
            class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition"
            disabled={busy()}
            onClick={handleSyncNow}
          >
            Sync Now
          </button>
          <button
            class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition"
            disabled={busy()}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>

        <div class="theme-control rounded-3xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="theme-text text-sm font-semibold">Import / Export</p>
              <p class="theme-text-soft mt-1 text-xs leading-5">
                Backup the local IndexedDB snapshot as JSON, or restore it from
                a previous export.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button
                class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition"
                disabled={busy()}
                onClick={handleImportClick}
              >
                Import JSON
              </button>
              <button
                class="theme-control rounded-2xl px-4 py-3 text-sm font-medium transition"
                disabled={busy()}
                onClick={handleExport}
              >
                Export JSON
              </button>
            </div>
          </div>
          <input
            ref={importInputRef}
            accept="application/json"
            class="hidden"
            type="file"
            onChange={handleImportChange}
          />
        </div>

        <Show when={notice()}>
          <p class="theme-text-soft text-sm">{notice()}</p>
        </Show>
      </div>

      <div class="grid gap-3">
        <div class="theme-control rounded-3xl p-4">
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">
            Status
          </p>
          <p class="theme-text mt-2 text-lg font-semibold">
            {settings().status}
          </p>
        </div>
        <div class="theme-control rounded-3xl p-4">
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">
            Provider
          </p>
          <p class="theme-text mt-2 text-lg font-semibold capitalize">
            {settings().provider}
          </p>
        </div>
        <div class="theme-control rounded-3xl p-4">
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">
            Last Sync
          </p>
          <p class="theme-text mt-2 text-sm font-medium">
            {formatTime(settings().lastSyncedAt)}
          </p>
        </div>
        <div class="theme-control rounded-3xl p-4">
          <p class="theme-text-soft text-xs uppercase tracking-[0.18em]">
            IndexedDB Snapshot
          </p>
          <p class="theme-text mt-2 text-sm font-medium">
            {formatTime(localUpdatedAt())}
          </p>
        </div>
        <Show when={settings().lastError}>
          <div class="theme-warn rounded-3xl px-4 py-3 text-sm">
            {settings().lastError}
          </div>
        </Show>
      </div>
    </div>
  );
}
