import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileExpression, evaluate } from "@kerangka/k1";
import { compile, parseFieldShorthand } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";

describe("Kerangka Conformance Test Suite", () => {
  const casesDir = resolve(__dirname, "cases");
  const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith(".json"));

  for (const file of caseFiles) {
    const raw = readFileSync(resolve(casesDir, file), "utf8");
    const suite = JSON.parse(raw);

    describe(`Suite: ${suite.suite} (${suite.description})`, () => {
      for (const tc of suite.cases) {
        it(`${tc.id}: ${tc.description}`, () => {
          switch (suite.suite) {
            case "k1-expressions": {
              const ast = compileExpression(tc.input.expr);
              if (tc.expect.ast) {
                expect(ast).toEqual(tc.expect.ast);
              }
              if (tc.expect.value !== undefined) {
                const val = evaluate(ast, tc.input.context ?? {});
                expect(val).toEqual(tc.expect.value);
              }
              break;
            }

            case "shorthand-expansion": {
              const parsed = parseFieldShorthand(tc.input);
              expect(parsed).toEqual(tc.expect);
              break;
            }

            case "workflow-transitions": {
              const kir = compile(tc.input.model);
              const engine = loadEngine(kir);
              const entityName = Object.keys(kir.entities)[0]!;

              const res = engine.transition(
                entityName,
                tc.input.record,
                tc.input.transition,
                tc.input.actor
              );

              expect(res.ok).toBe(tc.expect.ok);
              if (tc.expect.error) {
                expect(res.error).toBe(tc.expect.error);
              }
              if (tc.expect.record) {
                for (const [k, v] of Object.entries(tc.expect.record)) {
                  expect(res.record?.[k]).toEqual(v);
                }
              }
              break;
            }

            case "validation-rules": {
              const kir = compile(tc.input.model);
              const engine = loadEngine(kir);
              const entityName = Object.keys(kir.entities)[0]!;

              const res = engine.validate(entityName, tc.input.record);
              expect(res.valid).toBe(tc.expect.valid);

              if (tc.expect.errorCode) {
                const matched = res.errors.some((e) => e.code === tc.expect.errorCode);
                expect(matched).toBe(true);
              }
              if (tc.expect.errorField) {
                const matched = res.errors.some((e) => e.field === tc.expect.errorField);
                expect(matched).toBe(true);
              }
              break;
            }

            default:
              throw new Error(`Unhandled conformance suite: ${suite.suite}`);
          }
        });
      }
    });
  }
});
