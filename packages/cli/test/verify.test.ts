import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCommand } from "../src/commands/verify.js";
import { verifyDocument } from "@kerangka/compiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");
const tmpDir = path.resolve(__dirname, "../.tmp-verify-test");

describe("Kerangka CLI Verify Command (Static Analysis)", () => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  it("passes verification on valid example models", () => {
    const todoFile = path.resolve(examplesDir, "todo.kerangka.json");
    expect(verifyCommand(todoFile)).toBe(true);

    const invoicingFile = path.resolve(examplesDir, "invoicing.kerangka.json");
    expect(verifyCommand(invoicingFile)).toBe(true);

    const inventoryFile = path.resolve(examplesDir, "inventory.kerangka.json");
    expect(verifyCommand(inventoryFile)).toBe(true);
  });

  it("detects a planted dead-end workflow state", () => {
    const deadEndModel = {
      kerangka: "0.1",
      app: "test-dead-end",
      entities: {
        Order: {
          fields: {
            id: "string! unique",
            status: "enum(draft, submitted, stuck, completed) = draft",
          },
          workflow: {
            field: "status",
            states: ["draft", "submitted", "stuck", "completed"],
            initial: "draft",
            terminal: ["completed"],
            transitions: {
              submit: { from: "draft", to: "submitted" },
              stall: { from: "submitted", to: "stuck" },
              complete: { from: "submitted", to: "completed" },
            },
          },
        },
      },
    };

    const filePath = path.resolve(tmpDir, "dead-end.kerangka.json");
    fs.writeFileSync(filePath, JSON.stringify(deadEndModel, null, 2));

    const result = verifyDocument(deadEndModel);
    expect(result.ok).toBe(false);
    const deadEndErr = result.errors.find((e) => e.code === "WORKFLOW_DEAD_END_STATE");
    expect(deadEndErr).toBeDefined();
    expect(deadEndErr?.message).toContain("stuck");
    expect(deadEndErr?.hint).toContain("terminal");

    // Also run CLI command
    const cliOk = verifyCommand(filePath);
    expect(cliOk).toBe(false);
  });

  it("detects a planted unreachable workflow state", () => {
    const unreachableModel = {
      kerangka: "0.1",
      app: "test-unreachable",
      entities: {
        Ticket: {
          fields: {
            id: "string! unique",
            status: "enum(open, in_progress, closed, orphaned) = open",
          },
          workflow: {
            field: "status",
            states: ["open", "in_progress", "closed", "orphaned"],
            initial: "open",
            terminal: ["closed"],
            transitions: {
              start: { from: "open", to: "in_progress" },
              finish: { from: "in_progress", to: "closed" },
            },
          },
        },
      },
    };

    const result = verifyDocument(unreachableModel);
    expect(result.ok).toBe(false);
    const unreachableErr = result.errors.find((e) => e.code === "WORKFLOW_UNREACHABLE_STATE");
    expect(unreachableErr).toBeDefined();
    expect(unreachableErr?.message).toContain("orphaned");
  });

  it("detects a planted decision-table gap", () => {
    const gapModel = {
      kerangka: "0.1",
      app: "test-decision-gap",
      decisions: {
        discountTier: {
          hitPolicy: "first",
          inputs: [{ name: "amount", type: "number" }],
          outputs: [{ name: "rate", type: "number" }],
          rules: [
            { inputs: ["<= 100"], outputs: { rate: 0.05 } },
            // Missing (100..500) range!
            { inputs: ["> 500"], outputs: { rate: 0.15 } },
          ],
        },
      },
    };

    const filePath = path.resolve(tmpDir, "decision-gap.kerangka.json");
    fs.writeFileSync(filePath, JSON.stringify(gapModel, null, 2));

    const result = verifyDocument(gapModel);
    expect(result.ok).toBe(false);
    const gapErr = result.errors.find((e) => e.code === "DECISION_TABLE_GAP");
    expect(gapErr).toBeDefined();
    expect(gapErr?.message).toContain("gap between 100 and 500");

    const cliOk = verifyCommand(filePath);
    expect(cliOk).toBe(false);
  });

  it("detects overlapping rules in unique hit policy", () => {
    const overlapModel = {
      kerangka: "0.1",
      app: "test-decision-overlap",
      decisions: {
        feeCalculation: {
          hitPolicy: "unique",
          inputs: [{ name: "amount", type: "number" }],
          outputs: [{ name: "fee", type: "number" }],
          rules: [
            { inputs: ["<= 1000"], outputs: { fee: 10 } },
            { inputs: [">= 500"], outputs: { fee: 20 } },
          ],
        },
      },
    };

    const result = verifyDocument(overlapModel);
    expect(result.ok).toBe(false);
    const overlapErr = result.errors.find((e) => e.code === "DECISION_OVERLAPPING_ROWS");
    expect(overlapErr).toBeDefined();
    expect(overlapErr?.message).toContain("overlapping rules");
  });
});
