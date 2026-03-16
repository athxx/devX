import { ensureDefaultSettings } from "../lib/storage";

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaultSettings();
});

