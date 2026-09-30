import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const packagesDir = fileURLToPath(new URL("packages/", import.meta.url));

/**
 * A workspace import means the source, never the build.
 *
 * Every package's `main` points at `dist`, and `node_modules/@kerangka/*` are symlinks
 * into `packages/*`. So without this, a test importing `@kerangka/compiler` silently
 * tests whatever the last `npm run build` produced — and after editing the compiler and
 * not rebuilding, the suite is green and wrong. That is not a theoretical hazard: it is
 * why this repository has carried the reminder to rebuild after every compiler change.
 *
 * Aliasing to `src` closes it, and it is also what makes `npm test` work on a clean
 * checkout, where no `dist` exists yet.
 *
 * Two tests still need a real build, and neither is aliased away:
 *   - `packages/cli/test/sidecar-smoke.test.ts` runs `scripts/sidecar-smoke.py`, which
 *     spawns the built CLI as a separate process. A Python client cannot import TypeScript.
 *   - the cross-process session tests in `packages/server` spawn a child that opens the
 *     built store, because the point is a second process.
 * Both need `npm run build` first, and CI runs it after the tests; that ordering is a
 * known gap recorded in the run that introduced this file.
 */
const workspacePackages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(`${packagesDir}${entry.name}/src/index.ts`))
  .map((entry) => entry.name);

// Most specific first: a prefix match on `@kerangka/ports` would swallow
// `@kerangka/ports/test-kits`, so the subpath is listed ahead of its package.
const alias = [
  {
    find: /^@kerangka\/([^/]+)\/(.+)$/,
    replacement: `${packagesDir}$1/src/$2/index.ts`
  },
  ...workspacePackages.map((name) => ({
    find: new RegExp(`^@kerangka/${name}$`),
    replacement: `${packagesDir}${name}/src/index.ts`
  }))
];

export default defineConfig({
  resolve: { alias },
  test: {
    // The examples and the conformance suite are read from the repo root, so a test's
    // own directory is the wrong place to resolve them from.
    root: repoRoot
  }
});
