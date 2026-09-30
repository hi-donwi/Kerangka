import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { testCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

describe("kerangka test", () => {
  it("runs the declarative examples of every shipped example document", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    for (const name of [
      "todo.kerangka.json",
      "inventory.kerangka.json",
      "invoicing.kerangka.json",
      "leave-request.kerangka.json",
    ]) {
      expect(testCommand(path.join(examplesDir, name))).toBe(true);
    }

    vi.restoreAllMocks();
  });

  it("accepts a workspace directory and resolves its manifest", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(testCommand(path.join(examplesDir, "commerce"))).toBe(true);
    const out = log.mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");
    expect(out).not.toContain("ERROR");

    vi.restoreAllMocks();
  });

  it("routes a leave request by its decision table", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    expect(testCommand(path.join(examplesDir, "leave-request.kerangka.json"))).toBe(true);

    vi.restoreAllMocks();
  });
});
