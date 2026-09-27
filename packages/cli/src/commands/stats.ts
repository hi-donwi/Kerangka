/**
 * Kerangka CLI - Stats Command
 * Inspects model complexity, metrics, and declaration density.
 */

import { readFileSync } from "node:fs";
import { compile, CompilerError } from "@kerangka/compiler";

export function statsCommand(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });

    const entityNames = Object.keys(kir.entities);
    let fieldCount = 0;
    let ruleCount = 0;
    let invariantCount = 0;
    let transitionCount = 0;
    let actionCount = 0;

    for (const ent of Object.values(kir.entities)) {
      fieldCount += Object.keys(ent.fields ?? {}).length;
      ruleCount += ent.rules?.length ?? 0;
      invariantCount += ent.invariants?.length ?? 0;
      transitionCount += Object.keys(ent.workflow?.transitions ?? {}).length;
      actionCount += Object.keys(ent.actions ?? {}).length;
    }

    const rawLines = raw.split("\n").length;
    const compiledLines = JSON.stringify(kir, null, 2).split("\n").length;

    console.log(`\nModel Metrics for: ${filePath}`);
    console.log(`----------------------------------------`);
    console.log(`App Name:             ${kir.app}`);
    console.log(`Declared Roles:       ${(kir.roles ?? []).join(", ") || "(none)"}`);
    console.log(`Multitenancy:         ${kir.multitenancy ? kir.multitenancy.strategy : "(none)"}`);
    console.log(`Entities:             ${entityNames.length} (${entityNames.join(", ")})`);
    console.log(`Total Fields:         ${fieldCount}`);
    console.log(`Business Rules:       ${ruleCount}`);
    console.log(`Domain Invariants:    ${invariantCount}`);
    console.log(`Workflow Transitions: ${transitionCount}`);
    console.log(`Domain Actions:       ${actionCount}`);
    console.log(`Source Lines:         ${rawLines}`);
    console.log(`Compiled IR Lines:    ${compiledLines}`);
    console.log(`Density Ratio:        ${(compiledLines / rawLines).toFixed(2)}x expansion`);
    console.log(`----------------------------------------\n`);

    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: Stats failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
