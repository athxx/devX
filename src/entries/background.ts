import { ensureDefaultSettings } from "../lib/storage";
import { executeRestRequestDirect } from "../features/rest/service";
import type { Environment, RequestDraft } from "../features/rest/models";

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaultSettings();
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("app.html")
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "devox:rest-execute") {
    return undefined;
  }

  const payload = message.payload as {
    request?: RequestDraft;
    environment?: Environment;
  };

  if (!payload?.request) {
    sendResponse({
      ok: false,
      error: "Missing request payload."
    });
    return undefined;
  }

  void executeRestRequestDirect(payload.request, payload.environment)
    .then((result) => {
      sendResponse({
        ok: true,
        result
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Request failed."
      });
    });

  return true;
});
