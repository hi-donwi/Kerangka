import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import config from "../vitest.config.js";

/**
 * A workspace import means the source, never the build.
 *
 * Every package's `main` points at `dist` and `node_modules/@kerangka/*` are symlinks
 * into `packages/*`, so a test importing `@kerangka/compiler` silently tests whatever the
 * last build produced. That is not hypothetical: this repository carried a reminder to
 * rebuild after every compiler change, because a test could otherwise pass against a
 * build from before the change.
 *
 * `vitest.config.ts` and `tsconfig.json` are what prevent it, and a config file is
 * exactly the kind of thing that gets tidied away by someone who does not know what it
 * was for. These tests fail if the mapping stops covering the workspace, so removing it
 * has to be a decision rather than an accident.
 *
 * This file lives at the repository root rather than inside a package, because what it
 * checks is a repository-level setting.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = resolve(repoRoot, "packages");

/** `tsconfig.json` is JSONC — it carries comments, which `JSON.parse` rejects. */
const readConfig = (file: string): Record<string, any> => {
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
  if (error) throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
  return config as Record<string, any>;
};

const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(packagesDir, entry.name, "src/index.ts")))
  .map((entry) => entry.name);

describe("a workspace import means the source, not the build", () => {
  it("finds the workspace", () => {
    expect(packages).toContain("compiler");
    expect(packages).toContain("server");
  });

  it("aliases every package to its source for the test runner", () => {
    const aliases = config.resolve?.alias as Array<{ find: RegExp }> | undefined;
    expect(aliases, "vitest.config.ts must export resolve.alias").toBeDefined();
    const missing = packages.filter(
      (name) => !aliases!.some((alias) => alias.find.test(`@kerangka/${name}`))
    );
    expect(missing, `no src alias for: ${missing.join(", ")}`).toEqual([]);
  });

  it("matches a package subpath without the package alias swallowing it", () => {
    // The bug this catches: an alias for `@kerangka/ports` that also matches
    // `@kerangka/ports/test-kits` resolves the subpath to `src/index.ts/test-kits`,
    // which does not exist. The property is behavioural, so it is asserted behaviourally.
    const aliases = config.resolve?.alias as Array<{ find: RegExp }>;
    const matching = aliases.filter((alias) => alias.find.test("@kerangka/ports/test-kits"));
    expect(matching.length).toBeGreaterThan(0);
    const swallowing = matching.filter((alias) => alias.find.test("@kerangka/ports"));
    expect(
      swallowing.map((alias) => alias.find.source),
      "an alias must not match both the package and its subpath"
    ).toEqual([]);
  });

  it("maps every package to its source for the type checker", () => {
    const tsconfig = readConfig(resolve(repoRoot, "tsconfig.json"));
    const paths = tsconfig.compilerOptions?.paths as Record<string, string[]> | undefined;
    expect(paths, "tsconfig.json must map the workspace to source").toBeDefined();
    const wrong = packages.filter(
      (name) => paths![`@kerangka/${name}`]?.[0] !== `packages/${name}/src/index.ts`
    );
    expect(wrong, `not mapped to src: ${wrong.join(", ")}`).toEqual([]);
  });

  it("keeps the build resolving to dist, so the package configs are untouched", () => {
    // `paths` belongs on the root config only. The package configs extend
    // `tsconfig.base.json`, and the build must keep reading `dist` exactly as before.
    const base = readConfig(resolve(repoRoot, "tsconfig.base.json"));
    expect(base.compilerOptions?.paths).toBeUndefined();
  });
});
