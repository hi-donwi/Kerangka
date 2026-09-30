import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const script = path.join(repoRoot, "scripts/sidecar-smoke.py");

const python = (() => {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return { command: candidate, version: probe.stdout.trim() };
  }
  return null;
})();

/**
 * PLAN.md §19, Phase 2 exit gate: "a non-JavaScript client drives the invoicing
 * workflow". The client is Python; the sidecar is the TypeScript engine. If this passes,
 * the L1 claim in §11 holds for a language that embeds no Kerangka engine.
 */
describe.skipIf(!python)("a non-JavaScript client drives invoicing over the sidecar", () => {
  it("completes the invoicing workflow through the stdio JSON-RPC sidecar", () => {
    const result = spawnSync(python!.command, [script], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(result.status, output).toBe(0);
    expect(output).toContain("all checks passed");
    expect(output).toContain("[ok  ] send succeeds");
    expect(output).toContain("[ok  ] status is paid");
  }, 130_000);

  it("fails loudly when the sidecar is not built", () => {
    // The script fails rather than hanging when the CLI is missing, so a broken build
    // cannot pass this gate silently.
    expect(fs.existsSync(script)).toBe(true);
    const result = spawnSync(python!.command, [script, "examples/absent.kerangka.json"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toMatch(/Document not found|not found/i);
  }, 70_000);
});

if (!python) {
  // A skipped test must say why, never disappear.
  describe("a non-JavaScript client drives invoicing over the sidecar", () => {
    it.skip("needs python3 on PATH; not found in this environment", () => {});
  });
}
