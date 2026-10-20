import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import manifest from "../samples/manifest.json";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function check(docsPath: string, basePath = "/docs/preview") {
  const root = mkdtempSync(join(tmpdir(), "sample-docs-"));
  directories.push(root);
  const site = join(root, "docs-site");
  const outDir = `./dist${basePath}`;
  mkdirSync(join(site, "scripts"), { recursive: true });
  mkdirSync(join(root, "samples"));
  mkdirSync(join(site, outDir, "reference/samples"), { recursive: true });
  writeFileSync(join(site, outDir, "index.html"), "<h1>Docs</h1>");
  writeFileSync(join(site, outDir, "reference/samples/index.html"), "<h1>Samples</h1>");
  writeFileSync(join(site, "release.json"), JSON.stringify({ basePath, outDir }));
  writeFileSync(join(root, "samples/manifest.json"), JSON.stringify([{ id: "approval", docsPath }]));
  copyFileSync(new URL("../docs-site/scripts/check-links.mjs", import.meta.url), join(site, "scripts/check-links.mjs"));
  return spawnSync(process.execPath, [join(site, "scripts/check-links.mjs")], { encoding: "utf8" });
}

describe("sample docs destinations", () => {
  it("maps every shipped sample to a real portal source", () => {
    const release = JSON.parse(readFileSync(new URL("../docs-site/release.json", import.meta.url), "utf8"));
    for (const entry of manifest) {
      expect(entry.docsPath.startsWith(`${release.basePath}/`)).toBe(true);
      const route = entry.docsPath.slice(release.basePath.length + 1).replace(/\/$/, "");
      expect(existsSync(new URL(`../docs-site/src/content/docs/${route}.mdx`, import.meta.url)), entry.docsPath).toBe(true);
    }
  });

  it("accepts a built HTML destination", () => {
    expect(check("/docs/preview/reference/samples/").status).toBe(0);
  });

  it("checks the release-configured output instead of a hard-coded preview directory", () => {
    expect(check("/docs/v0.1.1/reference/samples/", "/docs/v0.1.1").status).toBe(0);
  });

  it.each([
    "/docs/preview/missing/",
    "https://example.invalid/docs",
    "//example.invalid/docs",
    "/docs/preview/../../../samples/manifest.json",
    "/docs/preview/reference/samples/?record=private",
    "/docs/preview/reference/samples/#missing",
  ])("rejects an unavailable or invalid manifest destination: %s", (path) => {
    const result = check(path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("approval");
  });
});
