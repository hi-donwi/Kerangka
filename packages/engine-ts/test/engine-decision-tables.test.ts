import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "../src/index.js";

const routingDoc = JSON.stringify({
  kerangka: "0.1",
  app: "routing",
  decisions: {
    approverRouting: {
      hitPolicy: "first",
      inputs: [{ name: "days", type: "int" }],
      outputs: [{ name: "approverRole", type: "string" }],
      rows: [
        { days: "<= 2", approverRole: "team-lead" },
        { days: "<= 5", approverRole: "department-manager" },
        { days: "> 5", approverRole: "hr-director" },
      ],
    },
  },
  entities: {
    Request: {
      fields: {
        days: "int! >= 1",
        approverRole: { type: "string", compute: "approverRouting(days)" },
      },
    },
  },
});

describe("Decision tables in the canonical rows form", () => {
  it("decide() reads rows from a compiled document", () => {
    const engine = loadEngine(compile(routingDoc));

    const short = engine.decide("approverRouting", { days: 2 });
    expect(short.matched).toBe(true);
    expect(short.outputs).toEqual({ approverRole: "team-lead" });

    const medium = engine.decide("approverRouting", { days: 4 });
    expect(medium.outputs).toEqual({ approverRole: "department-manager" });

    const long = engine.decide("approverRouting", { days: 9 });
    expect(long.outputs).toEqual({ approverRole: "hr-director" });
  });

  it("still supports programmatically supplied rules", () => {
    const engine = loadEngine({
      decisions: {
        discountPolicy: {
          name: "discountPolicy",
          hitPolicy: "first",
          inputs: [{ name: "tier", type: "string" }],
          outputs: [{ name: "discountPct", type: "number" }],
          rules: [
            { inputs: ["platinum"], outputs: { discountPct: 25 } },
            { inputs: ["-"], outputs: { discountPct: 0 } },
          ],
        },
      },
    });

    const res = engine.decide("discountPolicy", { tier: "platinum" });
    expect(res.matched).toBe(true);
    expect(res.outputs).toEqual({ discountPct: 25 });
  });

  it("resolves a decision table called from a computed field", () => {
    const engine = loadEngine(compile(routingDoc));

    expect(engine.compute("Request", { days: 2 }).approverRole).toBe("team-lead");
    expect(engine.compute("Request", { days: 4 }).approverRole).toBe("department-manager");
    expect(engine.compute("Request", { days: 9 }).approverRole).toBe("hr-director");
  });

  it("passes computed decision-table arguments in declared input order", () => {
    const engine = loadEngine(
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "multi-output",
          decisions: {
            grade: {
              hitPolicy: "first",
              inputs: [{ name: "score", type: "int" }],
              outputs: [
                { name: "letter", type: "string" },
                { name: "passed", type: "boolean" },
              ],
              rows: [{ score: ">= 60", letter: "B", passed: true }],
            },
          },
          entities: {
            Student: {
              fields: {
                score: "int!",
                outcome: { type: "string", compute: "grade(score)" },
              },
            },
          },
        }),
      ),
    );

    const computed = engine.compute("Student", { score: 70 });
    expect(computed.outcome).toEqual({ letter: "B", passed: true });
  });

  it("routes the leave-request example by decision table", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../../examples/leave-request.kerangka.json"),
      "utf8",
    );
    const engine = loadEngine(compile(raw));

    expect(engine.compute("LeaveRequest", { days: 2 }).assignedApproverRole).toBe("team-lead");
    expect(engine.compute("LeaveRequest", { days: 6 }).assignedApproverRole).toBe("hr-director");
  });

  it("fails closed when no row matches", () => {
    const engine = loadEngine(
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "no-match",
          decisions: {
            tier: {
              hitPolicy: "unique",
              inputs: [{ name: "amount", type: "int" }],
              outputs: [{ name: "label", type: "string" }],
              rows: [{ amount: "> 1000", label: "high" }],
            },
          },
          entities: {
            Order: {
              fields: {
                amount: "int!",
                label: { type: "string", compute: "tier(amount)" },
              },
            },
          },
        }),
      ),
    );

    const res = engine.decide("tier", { amount: 10 });
    expect(res.matched).toBe(false);
    expect(res.code).toBe("DECISION_NO_MATCH");
    expect(() => engine.compute("Order", { amount: 10 })).toThrow(/DECISION_NO_MATCH/);
  });
});
