import type { SyncProviderType, SyncSettings, WorkspaceSnapshot } from "./types";

type GoogleDriveFileListResponse = {
  files?: Array<{
    id: string;
    name: string;
  }>;
};

function getDropboxPath(settings: SyncSettings) {
  return settings.dropbox.remotePath || "/Apps/DevX/workspace.json";
}

function getOneDrivePath(settings: SyncSettings) {
  const path = settings.onedrive.remotePath || "/Apps/DevX/workspace.json";
  return path.startsWith("/") ? path : `/${path}`;
}

function getGoogleDriveFileName(settings: SyncSettings) {
  return settings.gdrive.fileName.trim() || "devx-workspace.json";
}

function getWebDavUrl(settings: SyncSettings) {
  const endpoint = settings.webdav.endpoint.trim().replace(/\/$/, "");
  const remotePath = settings.webdav.remotePath.trim() || "/devx/workspace.json";
  const normalizedPath = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${endpoint}${normalizedPath}`;
}

function getWebDavHeaders(settings: SyncSettings) {
  const basic = btoa(`${settings.webdav.username}:${settings.webdav.password}`);

  return {
    Authorization: `Basic ${basic}`
  };
}

async function parseJsonResponse(response: Response): Promise<WorkspaceSnapshot | undefined> {
  if (!response.ok) {
    return undefined;
  }

  return (await response.json()) as WorkspaceSnapshot;
}

async function findGoogleDriveSnapshotFile(settings: SyncSettings): Promise<string | undefined> {
  const query = encodeURIComponent(
    `name='${getGoogleDriveFileName(settings).replace(/'/g, "\\'")}' and 'appDataFolder' in parents and trashed=false`
  );
  const fields = encodeURIComponent("files(id,name)");
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=${fields}&pageSize=1`,
    {
      headers: {
        Authorization: `Bearer ${settings.gdrive.accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error("Failed to query Google Drive app data.");
  }

  const payload = (await response.json()) as GoogleDriveFileListResponse;
  return payload.files?.[0]?.id;
}

export async function testProviderConnection(settings: SyncSettings): Promise<void> {
  switch (settings.provider) {
    case "none":
      return;
    case "dropbox": {
      if (!settings.dropbox.accessToken.trim()) {
        throw new Error("Dropbox access token is required.");
      }

      const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.dropbox.accessToken}`,
          "Content-Type": "application/json"
        },
        body: "null"
      });

      if (!response.ok) {
        throw new Error("Dropbox connection failed. Please verify the access token.");
      }

      return;
    }
    case "onedrive": {
      if (!settings.onedrive.accessToken.trim()) {
        throw new Error("OneDrive access token is required.");
      }

      const response = await fetch("https://graph.microsoft.com/v1.0/me/drive", {
        headers: {
          Authorization: `Bearer ${settings.onedrive.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error("OneDrive connection failed. Please verify the access token.");
      }

      return;
    }
    case "gdrive": {
      if (!settings.gdrive.accessToken.trim()) {
        throw new Error("Google Drive access token is required.");
      }

      const response = await fetch(
        "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)&spaces=appDataFolder",
        {
          headers: {
            Authorization: `Bearer ${settings.gdrive.accessToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error("Google Drive connection failed. Please verify the access token and scope.");
      }

      return;
    }
    case "webdav": {
      if (!settings.webdav.endpoint.trim()) {
        throw new Error("WebDAV endpoint is required.");
      }

      const response = await fetch(getWebDavUrl(settings), {
        method: "HEAD",
        headers: getWebDavHeaders(settings)
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("WebDAV credentials were rejected.");
      }

      if (![200, 204, 207, 404].includes(response.status)) {
        throw new Error("WebDAV endpoint could not be reached.");
      }

      return;
    }
  }
}

export async function downloadRemoteSnapshot(
  settings: SyncSettings
): Promise<WorkspaceSnapshot | undefined> {
  switch (settings.provider) {
    case "none":
      return undefined;
    case "dropbox": {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.dropbox.accessToken}`,
          "Dropbox-API-Arg": JSON.stringify({
            path: getDropboxPath(settings)
          })
        }
      });

      if (response.status === 409) {
        return undefined;
      }

      return parseJsonResponse(response);
    }
    case "onedrive": {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/root:${getOneDrivePath(settings)}:/content`,
        {
          headers: {
            Authorization: `Bearer ${settings.onedrive.accessToken}`
          }
        }
      );

      if (response.status === 404) {
        return undefined;
      }

      return parseJsonResponse(response);
    }
    case "gdrive": {
      const fileId = await findGoogleDriveSnapshotFile(settings);

      if (!fileId) {
        return undefined;
      }

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${settings.gdrive.accessToken}`
          }
        }
      );

      return parseJsonResponse(response);
    }
    case "webdav": {
      const response = await fetch(getWebDavUrl(settings), {
        headers: getWebDavHeaders(settings)
      });

      if (response.status === 404) {
        return undefined;
      }

      return parseJsonResponse(response);
    }
  }
}

export async function uploadRemoteSnapshot(
  settings: SyncSettings,
  snapshot: WorkspaceSnapshot
): Promise<void> {
  switch (settings.provider) {
    case "none":
      return;
    case "dropbox": {
      const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.dropbox.accessToken}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: getDropboxPath(settings),
            mode: "overwrite",
            autorename: false,
            mute: true
          })
        },
        body: JSON.stringify(snapshot)
      });

      if (!response.ok) {
        throw new Error("Failed to upload snapshot to Dropbox.");
      }

      return;
    }
    case "onedrive": {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/root:${getOneDrivePath(settings)}:/content`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${settings.onedrive.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(snapshot)
        }
      );

      if (!response.ok) {
        throw new Error("Failed to upload snapshot to OneDrive.");
      }

      return;
    }
    case "gdrive": {
      const existingFileId = await findGoogleDriveSnapshotFile(settings);
      const metadata = {
        name: getGoogleDriveFileName(settings),
        parents: ["appDataFolder"]
      };

      if (existingFileId) {
        const response = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${settings.gdrive.accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(snapshot)
          }
        );

        if (!response.ok) {
          throw new Error("Failed to update snapshot in Google Drive.");
        }

        return;
      }

      const boundary = `devx-sync-${Date.now()}`;
      const multipartBody = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        JSON.stringify(snapshot),
        `--${boundary}--`
      ].join("\r\n");

      const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.gdrive.accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`
          },
          body: multipartBody
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create snapshot in Google Drive.");
      }

      return;
    }
    case "webdav": {
      const response = await fetch(getWebDavUrl(settings), {
        method: "PUT",
        headers: {
          ...getWebDavHeaders(settings),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(snapshot)
      });

      if (!response.ok) {
        throw new Error("Failed to upload snapshot to WebDAV.");
      }
    }
  }
}
