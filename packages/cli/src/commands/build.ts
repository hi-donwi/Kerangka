/**
 * Kerangka CLI - Build Command
 * Compiles a Kerangka document into canonical KIR JSON.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, CompilerError } from "@kerangka/compiler";

export function buildCommand(filePath: string, outputPath?: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf8");
    const kir = compile(raw, { sourcePath: filePath });
    const jsonOutput = JSON.stringify(kir, null, 2);

    if (outputPath === "-") {
      process.stdout.write(jsonOutput + "\n");
      return true;
    }

    const targetFile = outputPath
      ? resolve(outputPath)
      : filePath.replace(/\.(json|yaml|yml)$/, "") + ".kir.json";

    writeFileSync(targetFile, jsonOutput, "utf8");
    console.log(`WROTE: ${targetFile}`);
    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: Build failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
