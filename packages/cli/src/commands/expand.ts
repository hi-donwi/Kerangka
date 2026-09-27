/**
 * Kerangka CLI - Expand Command
 * Expands shorthands and inlines traits, printing formatted JSON.
 */

import { readFileSync } from "node:fs";
import { compile, CompilerError } from "@kerangka/compiler";

export function expandCommand(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });

    // Output formatted expanded entities
    process.stdout.write(JSON.stringify(kir.entities, null, 2) + "\n");
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
