import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { editorCatalog } from "./src/editor-catalog";

export default defineConfig({
  plugins: [{
    name: "studio-editor-catalog",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "editor-metadata.json", source: JSON.stringify(editorCatalog()) });
    },
  }],
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
