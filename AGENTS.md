# DevX Agent Guidelines

## Project Overview

DevX is a developer-facing toolbox built with SolidJS, UnoCSS, Vite, and Chrome Extension Manifest V3. It supports both a web app and Chrome extension entry points.

## Build Commands

```bash
npm install          # Install dependencies
npm run build       # TypeScript check + Vite build
npm run typecheck   # TypeScript type checking only (tsc -b)
npm run dev         # Watch mode for Chrome extension (vite build --watch)
npm run dev:web     # Vite dev server for web development
npm run preview:web # Preview production web build
```

**Single file typecheck:**
```bash
npx tsc --noEmit src/path/to/file.ts
```

**Build output:** The `dist/` directory contains the production build.

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** (`strict: true` in tsconfig.app.json)
- **ES2022 target** with ESNext modules
- Use `type` for all custom types and interfaces
- Prefer discriminated unions for state variants
- Use explicit return types for exported functions
- Use `?.` and `??` operators to avoid null checks where appropriate
- No semicolons at line endings
- Single quotes for strings
- Two-space indentation
- Trailing commas in multiline declarations
- Column limit: ~100 characters (soft)

### Imports

Order imports as follows:

```typescript
import type { SomeType } from "external-package";     // Type-only imports first
import { specificFn } from "external-package";        // Named imports from deps
import solid from "solid-js";                         // Framework default imports
import { For, Show, createSignal } from "solid-js";   // Framework named imports
import { AppShell } from "../components/app-shell";   // Relative to same level
import { someFn } from "../../lib/utils";             // Deeper relative paths
import type { LocalModel } from "./models";           // Local type imports
import { localFn } from "./service";                  // Local named imports
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `DbPanel`, `RestPlayground` |
| Types/Interfaces | PascalCase | `DbConnection`, `RestWorkspaceState` |
| Functions | camelCase | `createDbTab`, `loadDbWorkspace` |
| Variables | camelCase | `activeTabId`, `isExpanded` |
| Constants | PascalCase | `DefaultSettings`, `DatabaseKinds` |
| CSS classes | kebab-case | `theme-panel`, `h-9` |
| Files | kebab-case | `db-panel.tsx`, `tool-registry.ts` |

### Component Patterns

```typescript
type ComponentProps = {
  propA: string;
  propB?: boolean;
  onAction: (value: string) => void;
};

export function Component(props: ComponentProps) {
  const [localState, setLocalState] = createSignal("");

  onMount(() => {
    // Initialization
  });

  onCleanup(() => {
    // Cleanup
  });

  const computed = createMemo(() => {
    return localState().toUpperCase();
  });

  return (
    <div class="theme-panel">
      <Show when={props.propB}>
        <span>{computed()}</span>
      </Show>
      <For each={items}>
        {(item) => <div>{item}</div>}
      </For>
    </div>
  );
}
```

### Error Handling

1. **Component errors:** Wrap with `ErrorBoundary` from solid-js
2. **Async operations:** Use try/catch with typed errors
3. **User feedback:** Display errors inline with themed styles

```typescript
// Async with typed error
try {
  await someAsyncOperation();
} catch (error) {
  if (error instanceof SpecificError) {
    handleSpecificError(error);
  } else {
    throw new Error(error instanceof Error ? error.message : "Unknown error");
  }
}

// Silent failures where retry is possible
try {
  await loadLazyData();
} catch {
  // User can retry by collapsing/expanding
}
```

### Type Patterns

```typescript
// Discriminated unions for state
type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

// Variant types
type RequestBody =
  | { type: "none" }
  | { type: "json"; value: string }
  | { type: "form-data"; entries: KeyValueEntry[] };

// Optional props with defaults
function createEntry(partial: Partial<Entry> = {}): Entry {
  return {
    id: partial.id ?? makeId("kv"),
    key: partial.key ?? "",
    enabled: partial.enabled ?? true,
  };
}
```

### CSS/Styling

- **UnoCSS** with Tailwind-like utilities
- CSS custom properties for theming (prefixed with `var(--app-*)`)
- Dark mode support via `theme-*` classes and CSS variables
- Use `class` attribute, not `className`

```typescript
// Theming
style={{ "border-color": "var(--app-border)" }}

// Conditional classes
class={`inline-flex h-9 items-center gap-1.5 ${
  activeTab() === tab.id
    ? "theme-tab-active"
    : "theme-tab border-transparent"
}`}
```

### SolidJS Specific

- Use `createSignal`, `createMemo`, `createEffect` for reactivity
- Use `onMount` and `onCleanup` for lifecycle
- Prefer `Show` and `For` over ternaries and map for rendering
- Store updates: use functional updates `setValue((prev) => newValue)`
- For store objects, use `createStore` from solid-js/store

### File Organization

```
src/
├── app/                    # App-level components and logic
│   ├── workspace-page.tsx
│   └── tool-registry.ts
├── components/             # Shared UI primitives
│   ├── app-shell.tsx
│   └── tabs-bar.tsx
├── entries/                # Entry points
│   ├── app.tsx            # Extension main entry
│   ├── web.tsx            # Web app entry
│   ├── background.ts      # Service worker
│   └── popup.tsx          # Extension popup
├── features/              # Feature modules
│   ├── db/
│   │   ├── components/     # Feature UI components
│   │   ├── models.ts      # Feature types
│   │   ├── service.ts     # Business logic
│   │   └── local-db.ts    # IndexedDB operations
│   ├── rest/
│   └── ssh/
└── lib/                   # Shared utilities
    ├── storage.ts
    └── utils.ts
```

### Chrome Extension Considerations

- Check `typeof chrome !== "undefined"` before using extension APIs
- Use `chrome.runtime?.id` to detect extension context
- Background script handles cross-origin requests
- Messages between content and background use `chrome.runtime.sendMessage`

## Key Technical Details

- **No test suite** currently (verify with `npm run typecheck`)
- **Go server** available in `server/` directory (separate `go.mod`)
- **IndexedDB** used for persistence via custom `indexed-db.ts` helpers
- **Local storage** for UI preferences (theme, locale, sidebar width)
