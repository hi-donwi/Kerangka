import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  // A single entry and an inline worker do not need the fetch-based preload polyfill.
  build: { modulePreload: false },
  plugins: [react(), {
    name: "production-no-io-policy",
    apply: "build",
    transformIndexHtml() {
      return [{ tag: "meta", injectTo: "head-prepend", attrs: {
        "http-equiv": "Content-Security-Policy",
        content: "default-src 'none'; script-src 'self' blob:; worker-src blob:; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'",
      } }];
    },
  }],
  server: { port: 4173 },
});
