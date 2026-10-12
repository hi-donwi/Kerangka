/**
 * Kerangka CLI - Expand Command
 * Prints the model as the compiler sees it: shorthands expanded, traits inlined, and template
 * instances replaced by their expansion (PLAN.md §7.5: "nothing is magic").
 */

import { readFileSync } from "node:fs";
import { compile, CompilerError } from "@kerangka/compiler";

export function expandCommand(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });

    // Entities, and views when the model declares any: a view template expands into `views`,
    // so printing the entities alone would hide exactly what a template did.
    const expanded = { entities: kir.entities, ...(kir.views ? { views: kir.views } : {}) };
    process.stdout.write(JSON.stringify(expanded, null, 2) + "\n");
    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: Expand failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
