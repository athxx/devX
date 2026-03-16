# DevOX

Chrome extension starter for a developer-facing toolbox built with SolidJS, UnoCSS, Vite, and Manifest V3.

## Included foundation

- `popup.html`: quick launcher for the extension
- `sidepanel.html`: primary workspace shell
- `options.html`: persisted settings
- `src/entries/background.ts`: background service worker
- `src/app/tool-registry.ts`: central feature registry for current and planned tools
- `src/lib/storage.ts`: typed wrapper around `chrome.storage.sync`

## Tech stack

- SolidJS
- UnoCSS
- Vite
- Chrome Extension Manifest V3

## Getting started

This machine did not have `node`, `npm`, or `pnpm` available when the scaffold was created, so dependencies were not installed or tested here.

Once Node is available:

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable developer mode, choose `Load unpacked`, and point Chrome at the generated `dist` directory.

For iterative work:

```bash
npm run dev
```

That runs `vite build --watch`, which is a better fit for extension development than a regular dev server because Chrome loads unpacked files from disk.

## Suggested next features

1. Add a request collection model for the API tool.
2. Add editor panels for format conversion and diff views.
3. Add message routing between the side panel and background worker when modules need shared state or long-running tasks.
