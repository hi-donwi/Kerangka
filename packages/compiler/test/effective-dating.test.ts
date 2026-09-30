import { describe, expect, it } from "vitest";
import { compile, verifyDocument } from "@kerangka/compiler";

/**
 * Effective-dated rules (PLAN.md §5.12). A rate or fee changes over time, and a
 * record from 2026 must keep the rule that was valid in 2026 — so the periods are
 * part of the IR, and a period that overlaps, leaves a gap, or is written out of
 * order is a finding rather than a different answer per deployment.
 */
const model = (decisions?: unknown, rules?: unknown) =>
  compile(
    JSON.stringify({
      kerangka: "0.1",
      app: "rates",
      roles: ["admin"],
      entities: {
        Invoice: {
          fields: { issuedOn: "date!", tier: "string!", amount: "decimal(12,2)!" },
          ...(rules ? { rules } : {}),
        },
      },
      ...(decisions ? { decisions } : {}),
    })
  );

const feeTable = (versions: unknown[]) => ({
  serviceFeeRate: {
    effectiveDate: "issuedOn",
    inputs: [{ name: "tier", type: "string" }],
    outputs: [{ name: "result", type: "decimal" }],
    versions,
  },
});

const versionedRule = (versions: unknown, extra: Record<string, unknown> = {}) => [
  {
    id: "feeFloor",
    field: "amount",
    message: "Amount is below the floor for its period",
    check: "amount > 0",
    effectiveDate: "issuedOn",
    versions,
    ...extra,
  },
];

const codes = (source: unknown) =>
  verifyDocument(source as never).findings.map((finding) => finding.code);

describe("versions in the IR", () => {
  it("keeps every period of a rule instead of the first", () => {
    const kir = model(undefined, versionedRule([
      { validFrom: "2026-01-01", check: "amount > 10" },
      { validFrom: "2027-01-01", check: "amount > 100" },
    ]));

    const rule = kir.entities.Invoice!.rules![0]!;
    expect(rule.versions).toHaveLength(2);
    // The checks are expressions in the IR, not the strings they were written as.
    expect(JSON.stringify(rule.versions![0]!.check)).toContain("$bind");
    expect(rule.effectiveDate).toBe("issuedOn");
  });

  it("keeps the periods of a decision table as written", () => {
    const kir = model(
      feeTable([
        { validFrom: "2026-01-01", rows: [{ tier: "-", result: "0.020" }] },
        { validFrom: "2027-01-01", rows: [{ tier: "gold", result: "0.015" }] },
      ])
    );

    expect((kir.decisions!.serviceFeeRate as { versions: unknown[] }).versions).toHaveLength(2);
  });

  it("reports an unparsable check inside a version, and does not drop the period", () => {
    let thrown: unknown;
    try {
      model(undefined, versionedRule([{ validFrom: "2026-01-01", check: "amount >" }]));
    } catch (err) {
      thrown = err;
    }
    const diagnostics = (thrown as { diagnostics?: Array<{ code: string; path?: string }> })
      ?.diagnostics;

    expect(diagnostics?.[0]?.code).toBe("EXPRESSION_ERROR");
    expect(diagnostics?.[0]?.path).toBe("/entities/Invoice/rules/0/versions/0/check");
  });
});

describe("periods of a decision table", () => {
  it("accepts the shape §5.12 itself uses: a list of validFrom alone", () => {
    const findings = verifyDocument(
      model(
        feeTable([
          { validFrom: "2026-01-01", rows: [{ tier: "-", result: "0.020" }] },
          {
            validFrom: "2027-01-01",
            rows: [
              { tier: "gold", result: "0.015" },
              { tier: "-", result: "0.020" },
            ],
          },
        ])
      )
    );

    expect(findings.errors).toEqual([]);
  });

  it("does not call a specific row an overlap with a catch-all", () => {
    // Under 'first' the specific row shadowing the catch-all is how a table says
    // "this tier gets a different answer", so it is not a finding.
    const findings = verifyDocument(
      model(
        feeTable([
          {
            validFrom: "2027-01-01",
            rows: [
              { tier: "gold", result: "0.015" },
              { tier: "-", result: "0.020" },
            ],
          },
        ])
      )
    );

    expect(findings.findings).toEqual([]);
  });

  it("still calls two competing rows an overlap", () => {
    const findings = verifyDocument(
      model(
        feeTable([
          {
            validFrom: "2026-01-01",
            rows: [
              { tier: "gold", result: "0.015" },
              { tier: "gold", result: "0.020" },
            ],
          },
        ])
      )
    );

    expect(findings.findings.map((e) => e.code)).toContain("DECISION_OVERLAPPING_ROWS");
  });

  it("rejects a table that declares both rows and versions", () => {
    const table = feeTable([{ validFrom: "2026-01-01", rows: [{ tier: "-", result: "0.02" }] }]);
    (table.serviceFeeRate as unknown as { rows: unknown }).rows = [{ tier: "-", result: "0.02" }];

    expect(codes(model(table))).toContain("EFFECTIVE_AMBIGUOUS_ROWS");
  });

  it("analyses the rows of each period, not the union of them", () => {
    // A catch-all in one period and a specific row in the next are not an overlap.
    const clean = verifyDocument(
      model(
        feeTable([
          { validFrom: "2026-01-01", rows: [{ tier: "-", result: "0.02" }] },
          { validFrom: "2027-01-01", rows: [{ tier: "gold", result: "0.015" }] },
        ])
      )
    );
    expect(clean.errors).toEqual([]);

    // Two rows that can both match inside one period still are an overlap.
    const overlapping = verifyDocument(
      model(
        feeTable([
          {
            validFrom: "2026-01-01",
            rows: [
              { tier: "gold", result: "0.01" },
              { tier: "gold", result: "0.02" },
            ],
          },
        ])
      )
    );
    // 'first' hit policy makes an overlap a warning: it shadows, it does not fail.
    expect(overlapping.findings.map((e) => e.code)).toContain("DECISION_OVERLAPPING_ROWS");
  });
});

describe("periods of a rule", () => {
  it("accepts a period that ends the day before the next one starts", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "2026-01-01", validTo: "2026-12-31", check: "amount > 10" },
          { validFrom: "2027-01-01", check: "amount > 100" },
        ])
      )
    );

    expect(findings.errors).toEqual([]);
  });

  it("reports a gap between periods", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "2026-01-01", validTo: "2026-06-01", check: "amount > 10" },
          { validFrom: "2027-01-01", check: "amount > 100" },
        ])
      )
    );

    const gap = findings.errors.find((e) => e.code === "EFFECTIVE_VERSIONS_GAP");
    expect(gap?.message).toContain("2026-06-01");
    expect(gap?.message).toContain("2027-01-01");
  });

  it("reports two periods that cover the same day", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "2026-01-01", validTo: "2026-06-01", check: "amount > 10" },
          { validFrom: "2026-03-01", check: "amount > 100" },
        ])
      )
    );

    expect(findings.errors.map((e) => e.code)).toContain("EFFECTIVE_VERSIONS_OVERLAP");
  });

  it("reports periods that are not oldest first", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "2027-01-01", check: "amount > 100" },
          { validFrom: "2026-01-01", check: "amount > 10" },
        ])
      )
    );

    expect(findings.errors.map((e) => e.code)).toContain("EFFECTIVE_VERSIONS_UNSORTED");
  });

  it("reports two periods that start on the same day", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "2026-01-01", validTo: "2026-06-01", check: "amount > 10" },
          { validFrom: "2026-01-01", check: "amount > 100" },
        ])
      )
    );

    expect(findings.errors.map((e) => e.code)).toContain("EFFECTIVE_VERSIONS_DUPLICATE_START");
  });

  it("rejects a boundary that is not a date, and one that ends before it starts", () => {
    const findings = verifyDocument(
      model(
        undefined,
        versionedRule([
          { validFrom: "yesterday", check: "amount > 10" },
          { validFrom: "2027-01-01", validTo: "2026-01-01", check: "amount > 100" },
        ])
      )
    );

    const codesFound = findings.errors.map((e) => e.code);
    expect(codesFound).toContain("EFFECTIVE_VERSION_INVALID_DATE");
    expect(codesFound).toContain("EFFECTIVE_VERSION_INVALID_RANGE");
    // The date a reader has to fix is named, and the epoch it was parsed as is not.
    expect(findings.errors[0]!.message).toContain("'yesterday'");
    expect(findings.errors[0]!.message).not.toMatch(/\d{10,}/);
  });

  it("rejects an effective date the entity does not declare", () => {
    const findings = verifyDocument(
      model(undefined, versionedRule([{ validFrom: "2026-01-01", check: "amount > 10" }], {
        effectiveDate: "issuedOnn",
      }))
    );

    const finding = findings.errors.find((e) => e.code === "EFFECTIVE_DATE_UNKNOWN_FIELD");
    expect(finding?.message).toContain("'issuedOnn'");
    expect(finding?.path).toBe("/entities/Invoice/rules/0/effectiveDate");
  });

  it("rejects an empty or malformed period list rather than applying nothing", () => {
    // An empty list is dropped by the compiler, so the empty case has to be caught
    // where it is still visible: the diagnostic.
    let empty: { diagnostics?: Array<{ code: string }> } | undefined;
    try {
      model(undefined, versionedRule([]));
    } catch (err) {
      empty = err as typeof empty;
    }
    expect(empty?.diagnostics?.[0]?.code).toBe("EFFECTIVE_VERSIONS_EMPTY");

    // A period list that is not a list is structural, so the compiler refuses it
    // rather than handing a string to something that expects periods.
    let malformed: { diagnostics?: Array<{ code: string }> } | undefined;
    try {
      model(undefined, versionedRule("nope" as unknown));
    } catch (err) {
      malformed = err as typeof malformed;
    }
    expect(malformed?.diagnostics?.[0]?.code).toBe("EFFECTIVE_VERSIONS_MALFORMED");
  });
});
