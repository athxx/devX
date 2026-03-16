import { defineConfig, presetUno } from "unocss";

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      ink: {
        950: "#0a0f1c",
        900: "#121a2b",
        800: "#1b2742",
        700: "#314266",
        200: "#d7e1ff"
      },
      accent: {
        500: "#5fc9b8",
        400: "#77e4cf"
      },
      signal: {
        500: "#f0b35a",
        400: "#ffd38b"
      }
    },
    fontFamily: {
      sans: "\"IBM Plex Sans\", \"Segoe UI\", sans-serif",
      mono: "\"IBM Plex Mono\", \"SFMono-Regular\", monospace"
    },
    boxShadow: {
      panel: "0 18px 60px rgba(7, 11, 21, 0.22)"
    }
  }
});
