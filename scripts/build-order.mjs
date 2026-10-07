/**
 * Dependency-first build order for the workspace.
 *
 * `npm run --workspaces` builds in workspace-path order, which is alphabetical, and a
 * package's `tsc` build resolves its `@kerangka/*` dependencies through `dist`:
 * `tsconfig.build.json` deliberately carries no `paths` mapping, so the build reads what
 * the previous build produced (ADR-0033). On a clean checkout nothing has been produced
 * yet, so `compiler` built before `k1` fails with
 * `TS2307: Cannot find module '@kerangka/k1'`. A developer's machine, which still holds
 * yesterday's `dist`, does not see that; CI does, on every run.
 *
 * The order is derived from `package.json` dependencies instead of written down, because
 * a hand-maintained list is a list that rots — the defect ADR-0038 records.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Every workspace package declared by the root `package.json`, with its internal
 * dependency names resolved from the manifest rather than from the folder name.
 *
 * Supported workspace patterns are plain directories and a single `dir/*` glob; anything
 * else throws, because silently skipping a workspace would silently mis-order the build.
 */
export function readWorkspacePackages(rootDir) {
  const manifest = readJson(join(rootDir, "package.json"));
  const patterns = manifest.workspaces ?? [];
  const dirs = [];

  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = join(rootDir, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(parent, entry.name, "package.json"))) {
          dirs.push(join(parent, entry.name));
        }
      }
    } else if (existsSync(join(rootDir, pattern, "package.json"))) {
      dirs.push(join(rootDir, pattern));
    } else {
      throw new Error(`Unsupported workspace pattern in package.json: ${pattern}`);
    }
  }

  return dirs.sort().map((dir) => {
    const pkg = readJson(join(dir, "package.json"));
    return {
      path: relative(rootDir, dir),
      dir,
      name: pkg.name,
      dependencies: Object.keys({
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
      }),
      hasBuild: Boolean(pkg.scripts?.build),
    };
  });
}

/**
 * Order packages so every package follows the workspace packages it depends on.
 *
 * Deterministic: the ready set is always sorted, so the same graph gives the same order
 * on every machine. Throws on a cycle rather than building an arbitrary order.
 */
export function orderPackages(packages) {
  const byName = new Map();
  for (const pkg of packages) {
    if (byName.has(pkg.name)) {
      throw new Error(`Duplicate workspace package name: ${pkg.name}`);
    }
    byName.set(pkg.name, pkg);
  }

  const dependents = new Map(packages.map((pkg) => [pkg.name, []]));
  const unbuilt = new Map(packages.map((pkg) => [pkg.name, 0]));

  for (const pkg of packages) {
    for (const dep of pkg.dependencies) {
      if (!byName.has(dep)) continue;
      dependents.get(dep).push(pkg.name);
      unbuilt.set(pkg.name, unbuilt.get(pkg.name) + 1);
    }
  }

  const ready = packages.filter((pkg) => unbuilt.get(pkg.name) === 0).map((pkg) => pkg.name);
  ready.sort();

  const ordered = [];
  while (ready.length > 0) {
    const name = ready.shift();
    ordered.push(byName.get(name));
    for (const dependent of dependents.get(name)) {
      const remaining = unbuilt.get(dependent) - 1;
      unbuilt.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (ordered.length !== packages.length) {
    const stuck = packages.filter((pkg) => !ordered.includes(pkg)).map((pkg) => pkg.name);
    throw new Error(`Dependency cycle among workspace packages: ${stuck.join(", ")}`);
  }

  return ordered;
}
