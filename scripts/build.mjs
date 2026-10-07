/**
 * Build every workspace package in dependency order.
 *
 * `npm run build` used to be `npm run --workspaces --if-present build`, which walks the
 * packages in path order; `compiler` came before `k1` and the first build of a clean
 * checkout failed. This runner derives the order from the manifests instead
 * (see `scripts/build-order.mjs`), so adding a package does not mean remembering a list.
 *
 * Usage: node scripts/build.mjs
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { orderPackages, readWorkspacePackages } from "./build-order.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const packages = readWorkspacePackages(rootDir).filter((pkg) => pkg.hasBuild);
const ordered = orderPackages(packages);

console.log(`build order: ${ordered.map((pkg) => pkg.name).join(" -> ")}`);

for (const pkg of ordered) {
  const result = spawnSync("npm", ["run", "build", "-w", pkg.path], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`build failed: ${pkg.name}`);
    process.exit(result.status ?? 1);
  }
}
