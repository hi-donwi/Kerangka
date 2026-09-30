import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "../src/index.js";

/**
 * A record keeps the rules that were valid when it happened (PLAN.md §5.12). The
 * engine resolves the period from the effective date the model names, and a date
 * that no period covers is an error rather than a silent fall-through — a fallback
 * would answer differently per deployment and nobody would know which.
 */
const model = compile(
  JSON.stringify({
    kerangka: "0.1",
    app: "rates",
    roles: ["admin"],
    entities: {
      Invoice: {
        fields: { issuedOn: "date!", tier: "string!", amount: "decimal(12,2)!" },
        rules: [
          {
            id: "feeFloor",
            field: "amount",
            message: "Amount is below the floor for its period",
            check: "amount > 0",
            effectiveDate: "issuedOn",
            versions: [
              { validFrom: "2026-01-01", check: "amount > 10" },
              { validFrom: "2027-01-01", check: "amount > 100", message: "Above the 2027 floor" },
            ],
          },
        ],
      },
    },
    decisions: {
      serviceFeeRate: {
        name: "serviceFeeRate",
        effectiveDate: "issuedOn",
        inputs: [{ name: "tier", type: "string" }],
        outputs: [{ name: "result", type: "decimal" }],
        versions: [
          { validFrom: "2026-01-01", rows: [{ tier: "-", result: "0.020" }] },
          {
            validFrom: "2027-01-01",
            rows: [
              { tier: "gold", result: "0.015" },
              { tier: "-", result: "0.030" },
            ],
          },
        ],
      },
    },
  })
);

const engine = new Engine(model);
const record = (issuedOn: string | undefined, amount: number) => ({
  ...(issuedOn === undefined ? {} : { issuedOn }),
  tier: "gold",
  amount,
});
const codes = (issuedOn: string, amount: number) =>
  engine.validate("Invoice", record(issuedOn, amount)).errors.map((error) => error.code);

describe("an effective-dated rule", () => {
  it("uses the period the record falls in, not the newest one", () => {
    // 2026 floor is 10: 50 passes.
    expect(codes("2026-06-01", 50)).toEqual([]);
    // 2027 floor is 100: the same 50 does not.
    expect(codes("2027-06-01", 50)).toEqual(["RULE_FAILED"]);
  });

  it("reads a full timestamp as the day it falls on", () => {
    expect(codes("2027-01-01T23:59:59Z", 50)).toEqual(["RULE_FAILED"]);
    expect(codes("2026-12-31T23:59:59Z", 50)).toEqual([]);
  });

  it("takes the message from the period, so the reader is told which rule failed", () => {
    const errors = engine.validate("Invoice", record("2027-06-01", 50)).errors;
    expect(errors[0]!.message).toBe("Above the 2027 floor");
  });

  it("uses the date of the call when the rule names no field", () => {
    const byCall = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "rates",
        roles: ["admin"],
        entities: {
          Invoice: {
            fields: { amount: "decimal(12,2)!" },
            rules: [
              {
                id: "floor",
                message: "below the floor",
                check: "amount > 0",
                versions: [
                  { validFrom: "2020-01-01", check: "amount > 10" },
                  { validFrom: "2020-07-01", check: "amount > 100" },
                ],
              },
            ],
          },
        },
      })
    );
    const timed = new Engine(byCall);

    expect(timed.validate("Invoice", { amount: 50 }, "2020-03-01").valid).toBe(true);
    expect(timed.validate("Invoice", { amount: 50 }, "2020-09-01").valid).toBe(false);
    expect(
      timed.validate("Invoice", { amount: 50 }, "2020-09-01").errors[0]!.message
    ).toBe("below the floor");
  });

  it("fails rather than passing a date no period covers", () => {
    const errors = engine.validate("Invoice", record("2019-06-01", 50)).errors;

    expect(errors[0]!.code).toBe("EFFECTIVE_VERSION_BEFORE_ORIGIN");
    expect(errors[0]!.message).toContain("2019-06-01");
    expect(errors[0]!.message).toContain("2026-01-01");
  });

  it("fails rather than passing a date a gap leaves uncovered", () => {
    // `keranga verify` rejects a gap, so this IR is one a hand-built model or a
    // broken deployment can still produce. The engine must not answer it anyway.
    const gapped = new Engine({
      app: "rates",
      entities: {
        Invoice: {
          fields: { issuedOn: { type: "date", required: true }, amount: { type: "decimal", required: true } },
          rules: [
            {
              id: "floor",
              field: "amount",
              message: "below the floor",
              effectiveDate: "issuedOn",
              check: { literal: true },
              versions: [
                { validFrom: "2026-01-01", validTo: "2026-06-01", check: { literal: true } },
                { validFrom: "2027-01-01", check: { literal: true } },
              ],
            },
          ],
        },
      },
    });

    const inGap = gapped.validate("Invoice", { issuedOn: "2026-09-01", amount: 500 });
    expect(inGap.errors[0]!.code).toBe("EFFECTIVE_VERSION_GAP");
    expect(inGap.errors[0]!.message).toContain("2026-06-01");

    // A date inside a period still answers.
    expect(gapped.validate("Invoice", { issuedOn: "2026-03-01", amount: 500 }).valid).toBe(true);
  });

  it("says so when the record has no value for the field that picks the period", () => {
    const errors = engine.validate("Invoice", record(undefined, 50)).errors;

    // The missing required field is reported too; the period is what must not pass.
    expect(errors.map((error) => error.code)).toContain("EFFECTIVE_DATE_MISSING");
    expect(errors.map((error) => error.code)).toContain("REQUIRED_FIELD");
  });
});

describe("an effective-dated decision table", () => {
  const decide = (issuedOn: string, tier: string) =>
    engine.decide("serviceFeeRate", { issuedOn, tier });

  it("decides with the rows of the period", () => {
    expect(decide("2026-06-01", "gold").outputs).toEqual({ result: 0.02 });
    expect(decide("2027-06-01", "gold").outputs).toEqual({ result: 0.015 });
  });

  it("keeps the later period's extra rows to itself", () => {
    // A row added in 2027 must not decide a 2026 record.
    expect(decide("2026-06-01", "silver").outputs).toEqual({ result: 0.02 });
    expect(decide("2027-06-01", "silver").outputs).toEqual({ result: 0.03 });
  });

  it("fails rather than deciding with no period", () => {
    const result = decide("2019-06-01", "gold");

    expect(result.matched).toBe(false);
    expect(result.code).toBe("EFFECTIVE_VERSION_BEFORE_ORIGIN");
  });

  it("leaves a table without periods exactly as it was", () => {
    const plain = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "rates",
        decisions: {
          flat: {
            name: "flat",
            inputs: [{ name: "tier", type: "string" }],
            outputs: [{ name: "result", type: "string" }],
            rows: [{ tier: "gold", result: "yes" }],
          },
        },
      })
    );

    expect(new Engine(plain).decide("flat", { tier: "gold" }).outputs).toEqual({ result: "yes" });
  });
});
