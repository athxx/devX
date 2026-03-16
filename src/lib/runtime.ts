export async function openOptionsPage() {
  await chrome.runtime.openOptionsPage();
}

export async function openSidePanel() {
  const currentWindow = await chrome.windows.getCurrent();

  if (!currentWindow.id) {
    return;
  }

  await chrome.sidePanel.open({ windowId: currentWindow.id });
}

