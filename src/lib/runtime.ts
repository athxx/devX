export async function openOptionsPage() {
  await chrome.runtime.openOptionsPage();
}

export async function openAppPage() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("app.html")
  });
}
