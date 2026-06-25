export async function openAppPage(tab?: string) {
  const url = tab
    ? chrome.runtime.getURL(`app.html?tab=${encodeURIComponent(tab)}`)
    : chrome.runtime.getURL("app.html");
  await chrome.tabs.create({ url });
}
