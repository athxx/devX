import UnoCSS from "unocss/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid(), UnoCSS()],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: new URL("index.html", import.meta.url).pathname,
        app: new URL("app.html", import.meta.url).pathname,
        popup: new URL("popup.html", import.meta.url).pathname,
        sidepanel: new URL("sidepanel.html", import.meta.url).pathname,
        background: new URL("src/entries/background.ts", import.meta.url)
          .pathname,
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
        // Rolldown's native chunking. `manualChunks` is a rollup-compat shim
        // whose result is then collapsed by rolldown's small-chunk merge pass —
        // that merge folded `lib/storage` into the `feature-db` chunk, so the
        // background service worker (which has NO `window`/`document`) ended up
        // importing feature-db, which evaluates DOM-touching libs (uPlot,
        // CodeMirror) at module load and threw "window is not defined",
        // failing SW registration (Status code 15).
        //
        // `advancedChunks` groups are NOT subject to that merge. We pin the
        // worker-reachable libs (`storage` → `indexed-db`) to their own group
        // with `minSize: 0` so they always stay a standalone, DOM-free chunk.
        advancedChunks: {
          groups: [
            {
              name: "worker-safe-lib",
              test: /\/src\/(lib\/(storage|indexed-db|utils|shortcuts)|features\/proxy\/(service|local-db)|features\/rest\/(service|local-db|models))/,
              minSize: 0,
              priority: 100,
            },
            { name: "vendor-codemirror", test: /node_modules\/(@codemirror|@lezer)/ },
            { name: "vendor-xterm", test: /node_modules\/(@xterm|xterm)/ },
            { name: "vendor-solid", test: /node_modules\/solid-js/ },
            { name: "shared-lib", test: /\/src\/lib\// },
            { name: "feature-db", test: /\/src\/features\/db\// },
            { name: "feature-ssh", test: /\/src\/features\/ssh\// },
            { name: "feature-rest", test: /\/src\/features\/rest\// },
          ],
        },
      },
    },
  },
});
