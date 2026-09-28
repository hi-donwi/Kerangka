import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kerangka-check-"));
const badPath = path.join(tmpDir, "bad.kerangka.json");

fs.writeFileSync(
  badPath,
  [
    "{",
    '  "kerangka": "0.1",',
    '  "app": "bad",',
    '  "entities": {',
    '    "Item": {',
    '      "fields": { "qty": "integr!", "twice": { "type": "int", "compute": "qyt * 2" } }',
    "    }",
    "  }",
    "}",
  ].join("\n")
);

function captured(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
}

describe("kerangka check", () => {
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("prints file:line:column, code, pointer, and hint for each error", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(checkCommand(badPath)).toBe(false);
    const out = captured(stderr);
    expect(out).toContain(`${badPath}:6:26: error UNKNOWN_TYPE: Unknown type 'integr'`);
    expect(out).toContain("at /entities/Item/fields/qty");
    expect(out).toContain("hint: Did you mean 'integer'?");
    expect(out).toContain("UNKNOWN_FIELD");
    expect(out).toContain("2 errors");
  });

  it("prints machine-readable diagnostics with --format=json", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(checkCommand(badPath, { format: "json" })).toBe(false);
    const report = JSON.parse(captured(stdout));
    expect(report).toMatchObject({ file: badPath, ok: false });
    expect(report.diagnostics).toHaveLength(2);
    expect(report.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "UNKNOWN_TYPE",
      path: "/entities/Item/fields/qty",
      line: 6,
      column: 26,
    });
    expect(report.diagnostics[0].hint).toBeTruthy();
  });

  it("reports ok with an empty diagnostics list for a valid model in JSON", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(checkCommand(examplePath, { format: "json" })).toBe(true);
    const report = JSON.parse(captured(stdout));
    expect(report).toMatchObject({ file: examplePath, ok: true, app: "invoicing", diagnostics: [] });
  });

  it("reports a missing file as a diagnostic in JSON", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const missing = path.join(tmpDir, "missing.kerangka.json");
    expect(checkCommand(missing, { format: "json" })).toBe(false);
    const report = JSON.parse(captured(stdout));
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0].code).toBe("LOAD_FAILED");
  });
});
