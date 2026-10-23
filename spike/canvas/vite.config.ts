import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * One candidate per build, so the size of a bundle belongs to one candidate.
 *
 * A build with both candidates in it produces shared chunks, and a shared chunk makes
 * the number meaningless: part of the graph library would be attributed to the native
 * canvas, or the other way round. Each candidate is therefore built on its own, and
 * measured on its own.
 *
 * The `outDir` also keeps the two builds apart, which is what a lazy-loaded designer
 * chunk in Studio would look like.
 */
const entry = process.env.SPIKE_ENTRY ?? "index.html";
const outDir = process.env.SPIKE_OUT ?? "dist";

export default defineConfig({
  build: {
    target: "es2022",
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: { [entry.replace(".html", "")]: resolve(import.meta.dirname, entry) },
    },
  },
});
