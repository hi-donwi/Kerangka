import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import * as os from "node:os";
import { compileExpression, evaluate } from "@kerangka/k1";
import { compile, parseFieldShorthand, CompilerError } from "@kerangka/compiler";
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
              const ast = tc.input.ast ?? compileExpression(tc.input.expr);
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

            case "modules": {
              let rootPath: string;
              let cleanupDir: string | undefined;

              if (tc.input.sourcePath) {
                rootPath = resolve(__dirname, "..", tc.input.sourcePath);
              } else if (tc.input.virtualWorkspace) {
                cleanupDir = mkdtempSync(join(os.tmpdir(), "kerangka-mod-"));
                rootPath = join(cleanupDir, "kerangka.json");
                writeFileSync(rootPath, JSON.stringify(tc.input.virtualWorkspace.manifest, null, 2));

                const contexts = tc.input.virtualWorkspace.contexts ?? {};
                for (const [ctxName, ctxDef] of Object.entries(contexts)) {
                  const ctxDir = join(cleanupDir, "contexts", ctxName);
                  mkdirSync(ctxDir, { recursive: true });
                  writeFileSync(join(ctxDir, "context.kerangka.json"), JSON.stringify(ctxDef, null, 2));
                }
              } else {
                throw new Error("Invalid module test case input: missing sourcePath or virtualWorkspace");
              }

              try {
                if (tc.expect.valid === false) {
                  expect(() => {
                    const content = readFileSync(rootPath, "utf8");
                    compile(content, { sourcePath: rootPath });
                  }).toThrowError(CompilerError);

                  try {
                    const content = readFileSync(rootPath, "utf8");
                    compile(content, { sourcePath: rootPath });
                  } catch (err) {
                    expect(err).toBeInstanceOf(CompilerError);
                    if (tc.expect.errorCode) {
                      const diags = (err as CompilerError).diagnostics;
                      const matched = diags.some((d) => d.code === tc.expect.errorCode);
                      expect(matched).toBe(true);
                    }
                  }
                } else {
                  const content = readFileSync(rootPath, "utf8");
                  const kir = compile(content, { sourcePath: rootPath });
                  if (tc.expect.entities) {
                    expect(Object.keys(kir.entities).sort()).toEqual(tc.expect.entities.sort());
                  }
                  if (tc.expect.events) {
                    expect(Object.keys(kir.events ?? {}).sort()).toEqual(tc.expect.events.sort());
                  }
                  if (tc.expect.policies) {
                    expect(Object.keys(kir.policies ?? {}).sort()).toEqual(tc.expect.policies.sort());
                  }
                }
              } finally {
                if (cleanupDir) {
                  rmSync(cleanupDir, { recursive: true, force: true });
                }
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
