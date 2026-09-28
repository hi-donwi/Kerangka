import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { Engine } from "@kerangka/engine-ts";
import { decisionsExportCommand, decisionsImportCommand } from "../src/commands/decisions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, "../.tmp-decisions-test");

describe("Kerangka CLI Decisions Command (CSV Import & Export)", () => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const sampleModel = {
    kerangka: "0.1",
    app: "pricing-service",
    decisions: {
      calculateDiscount: {
        hitPolicy: "first",
        inputs: [
          { name: "amount", type: "number" },
          { name: "customerTier", type: "string" },
        ],
        outputs: [{ name: "discount", type: "number" }],
        rules: [
          { inputs: [">= 1000", "platinum"], outputs: { discount: 0.25 } },
          { inputs: [">= 500", "gold"], outputs: { discount: 0.15 } },
          { inputs: [">= 100", "-"], outputs: { discount: 0.05 } },
          { inputs: ["-", "-"], outputs: { discount: 0.0 } },
        ],
      },
    },
  };

  it("exports decision table to CSV format", () => {
    const docPath = path.resolve(tmpDir, "pricing.kerangka.json");
    const csvPath = path.resolve(tmpDir, "exported-discount.csv");
    fs.writeFileSync(docPath, JSON.stringify(sampleModel, null, 2));

    const ok = decisionsExportCommand("calculateDiscount", {
      from: docPath,
      output: csvPath,
    });

    expect(ok).toBe(true);
    expect(fs.existsSync(csvPath)).toBe(true);

    const csvContent = fs.readFileSync(csvPath, "utf8");
    const lines = csvContent.trim().split("\n");

    expect(lines[0]).toBe("in:amount,in:customerTier,out:discount");
    expect(lines[1]).toBe(">= 1000,platinum,0.25");
    expect(lines[2]).toBe(">= 500,gold,0.15");
    expect(lines[3]).toBe(">= 100,-,0.05");
    expect(lines[4]).toBe("-,-,0");
  });

  it("imports decision table from CSV and executes correctly in Engine", () => {
    const docPath = path.resolve(tmpDir, "imported-app.kerangka.json");
    fs.writeFileSync(
      docPath,
      JSON.stringify(
        {
          kerangka: "0.1",
          app: "custom-approval",
          entities: {},
        },
        null,
        2
      )
    );

    const csvPath = path.resolve(tmpDir, "approval-rules.csv");
    const csvData = [
      "in:department,in:amount,out:approverRole,out:autoApprove",
      "engineering,<= 500,tech_lead,true",
      "engineering,> 500,director,false",
      "finance,-,cfo,false",
      "-,-,manager,false",
    ].join("\n");
    fs.writeFileSync(csvPath, csvData);

    const ok = decisionsImportCommand("approvalMatrix", csvPath, {
      into: docPath,
      hitPolicy: "first",
    });

    expect(ok).toBe(true);

    // Verify document on disk
    const updatedDoc = JSON.parse(fs.readFileSync(docPath, "utf8"));
    expect(updatedDoc.decisions?.approvalMatrix).toBeDefined();
    expect(updatedDoc.decisions.approvalMatrix.rules).toHaveLength(4);

    // Compile and run against Engine
    const kir = compile(fs.readFileSync(docPath, "utf8"));
    const engine = new Engine(kir);

    const res1 = engine.decide("approvalMatrix", {
      department: "engineering",
      amount: 250,
    });
    expect(res1.matched).toBe(true);
    expect(res1.outputs).toEqual({
      approverRole: "tech_lead",
      autoApprove: true,
    });

    const res2 = engine.decide("approvalMatrix", {
      department: "engineering",
      amount: 1500,
    });
    expect(res2.matched).toBe(true);
    expect(res2.outputs).toEqual({
      approverRole: "director",
      autoApprove: false,
    });

    const res3 = engine.decide("approvalMatrix", {
      department: "marketing",
      amount: 100,
    });
    expect(res3.matched).toBe(true);
    expect(res3.outputs).toEqual({
      approverRole: "manager",
      autoApprove: false,
    });
  });
});
