/**
 * Kerangka CLI - Test Command
 * Executes declarative examples in the document against the reference engine.
 */

import { readFileSync } from "node:fs";
import { compile, CompilerError } from "@kerangka/compiler";
import { DeclarativeExample, loadEngine } from "@kerangka/engine-ts";

export function testCommand(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });

    const examples = (kir.examples ?? []) as DeclarativeExample[];
    if (examples.length === 0) {
      console.log(`No declarative examples found in ${filePath}`);
      return true;
    }

    const engine = loadEngine(kir);
    console.log(`\nRunning ${examples.length} declarative example(s) for ${filePath}:`);

    let passedCount = 0;
    for (const [idx, example] of examples.entries()) {
      const result = engine.runExample(example);
      if (result.passed) {
        passedCount++;
        console.log(`  [PASS] #${idx + 1}: ${example.name}`);
      } else {
        console.error(`  [FAIL] #${idx + 1}: ${example.name}`);
        console.error(`         Reason: ${result.error}`);
      }
    }

    const allPassed = passedCount === examples.length;
    console.log(`\nResult: ${passedCount}/${examples.length} passed\n`);
    return allPassed;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: Test run failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
