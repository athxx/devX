# DevX

Developer-facing toolbox starter built with SolidJS, UnoCSS, Vite, and Chrome Extension Manifest V3. The main workspace now supports both a normal web entry and a Chrome extension entry.

## Planning docs

- [REST Playground plan](./docs/rest-playground-plan.md): scope, architecture, data model, and phased delivery plan for the API testing module.

## Included foundation

- `index.html`: web app entry
- `app.html`: primary full-page workspace for the extension
- `popup.html`: optional quick launcher page
- `options.html`: persisted settings
- `server/`: Go/Fiber middle layer for HTTP proxying, DB access, and SSH relay
- `src/entries/background.ts`: background service worker
- `src/app/workspace-page.tsx`: shared workspace page used by both web and extension
- `src/app/tool-registry.ts`: central feature registry for current and planned tools
- `src/lib/storage.ts`: typed wrapper around `chrome.storage.sync`

## Tech stack

- SolidJS
- UnoCSS
- Vite
- Shared web app + Chrome extension UI
- Chrome Extension Manifest V3

## Getting started

This machine did not have `node`, `npm`, or `pnpm` available when the scaffold was created, so dependencies were not installed or tested here.

Once Node is available:

```bash
npm install
npm run build
```

## Run the web app

For normal web development:

```bash
npm run dev:web
```

Then open the local Vite URL, which is usually `http://localhost:5173`.

If you want to preview the production web build:

```bash
npm run preview:web
```

## Run the Chrome extension

Then open `chrome://extensions`, enable developer mode, choose `Load unpacked`, and point Chrome at the generated `dist` directory.

For iterative work:

```bash
npm run dev
```

That runs `vite build --watch`, which is a better fit for extension development than a regular dev server because Chrome loads unpacked files from disk.

The extension opens `app.html`, while the web app uses `index.html`. Both entries render the same shared workspace UI.

## Run the Go server

The repository also includes a Go middle layer in `server/` for API proxying, DB relay, and SSH relay.

```bash
cd server
go mod tidy
go run ./cmd/devx-server
```

See [server/README.md](./server/README.md) for the available routes and payload formats.

## Suggested next features

1. Add a request collection model for the API tool.
2. Add editor panels for format conversion and diff views.
3. Add message routing between the full-page app and background worker when modules need shared state or long-running tasks.
