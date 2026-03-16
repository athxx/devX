import UnoCSS from "unocss/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid(), UnoCSS()],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: new URL("index.html", import.meta.url).pathname,
        app: new URL("app.html", import.meta.url).pathname,
        popup: new URL("popup.html", import.meta.url).pathname,
        options: new URL("options.html", import.meta.url).pathname,
        sidepanel: new URL("sidepanel.html", import.meta.url).pathname,
        background: new URL("src/entries/background.ts", import.meta.url).pathname
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunks/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
