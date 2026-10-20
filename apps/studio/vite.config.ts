import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
    sourcemap: false,
    license: { fileName: "assets/licenses.md" },
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        preview: fileURLToPath(new URL("preview.html", import.meta.url)),
      },
    },
  },
});
