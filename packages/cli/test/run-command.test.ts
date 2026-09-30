import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kerangka-run-"));

const recordPath = path.join(tmpDir, "record.json");
fs.writeFileSync(
  recordPath,
  JSON.stringify({
    id: "inv-cli-1",
    number: "INV-CLI-1",
    customer: "cust-1",
    issuedOn: "2026-09-01",
    dueDate: "2026-10-01",
    status: "draft",
    lines: [{ description: "Consulting", qty: 2, unitPrice: 150 }],
  }),
);

const actorPath = path.join(tmpDir, "actor.json");
fs.writeFileSync(actorPath, JSON.stringify({ id: "u-1", roles: ["billing"] }));

describe("kerangka run", () => {
  it("executes one action and prints the result as JSON on stdout", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      runCommand(invoicingPath, "Invoice.send", {
        record: recordPath,
        actor: actorPath,
        now: "2026-09-30T00:00:00.000Z",
      }),
    ).toBe(true);

    const printed = log.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
    const result = JSON.parse(printed);
    expect(result.ok).toBe(true);
    expect(result.record.status).toBe("sent");

    vi.restoreAllMocks();
  });

  it("exits non-zero when the engine refuses the action", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      runCommand(invoicingPath, "Invoice.send", {
        record: recordPath,
        actor: JSON.stringify({ id: "u-2", roles: ["viewer"] }),
      }),
    ).toBe(false);

    vi.restoreAllMocks();
  });

  it("reports a missing document instead of throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(runCommand(path.join(tmpDir, "absent.kerangka.json"), "Invoice.send")).toBe(false);
    expect(error.mock.calls.map((a: unknown[]) => a.join(" ")).join("\n")).toContain("not found");

    vi.restoreAllMocks();
  });
});
