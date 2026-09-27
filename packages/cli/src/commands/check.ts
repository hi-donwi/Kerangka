/**
 * Kerangka CLI - Check Command
 * Validates document syntax, shorthand, references, and expressions.
 */

import { readFileSync } from "node:fs";
import { compile, CompilerError } from "@kerangka/compiler";

export function checkCommand(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });

    const entityCount = Object.keys(kir.entities).length;
    let ruleCount = 0;
    let transitionCount = 0;

    for (const ent of Object.values(kir.entities)) {
      ruleCount += (ent.rules?.length ?? 0) + (ent.invariants?.length ?? 0);
      transitionCount += Object.keys(ent.workflow?.transitions ?? {}).length;
    }

    console.log(
      `OK: ${filePath} is valid (App: '${kir.app}', ${entityCount} entities, ${ruleCount} rules/invariants, ${transitionCount} transitions)`
    );
    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: Verification failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
