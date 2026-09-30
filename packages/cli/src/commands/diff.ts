/**
 * Kerangka CLI - diff command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, diffModels } from "@kerangka/compiler";
import { resolveTargetFile } from "../target.js";

export interface DiffCommandOptions {
  checkBreaking?: boolean;
}

export function diffCommand(oldPath: string, newPath: string, options: DiffCommandOptions = {}): boolean {
  try {
    // A workspace directory resolves to its manifest, the same as every other command.
    const fullOld = resolveTargetFile(oldPath);
    const fullNew = resolveTargetFile(newPath);

    if (!fs.existsSync(fullOld)) {
      console.error(`Error: Base file not found: ${oldPath}`);
      return false;
    }
    if (!fs.existsSync(fullNew)) {
      console.error(`Error: Target file not found: ${newPath}`);
      return false;
    }

    const oldSource = fs.readFileSync(fullOld, "utf-8");
    const newSource = fs.readFileSync(fullNew, "utf-8");

    const oldKir = compile(oldSource, { sourcePath: fullOld });
    const newKir = compile(newSource, { sourcePath: fullNew });

    const result = diffModels(oldKir, newKir);

    console.log(`Kerangka Model Diff: ${oldPath} -> ${newPath}`);
    console.log(`Changes: ${result.summary.breaking} breaking, ${result.summary.additive} additive, ${result.summary.compatible} compatible\n`);

    if (result.changes.length === 0) {
      console.log("No structural differences found.");
      return true;
    }

    for (const change of result.changes) {
      const tag = change.classification.toUpperCase().padEnd(10);
      console.log(`[${tag}] ${change.path}: ${change.message}`);
      // A breaking change with a two-phase path says so here, where the developer is.
      if (options.checkBreaking && change.hint) {
        console.log(`           → ${change.hint}`);
      }
    }

    if (options.checkBreaking && result.hasBreakingChanges) {
      console.error("\nERROR: Breaking changes detected while --check-breaking is enabled.");
      return false;
    }

    return true;
  } catch (err: any) {
    console.error(`Error executing model diff: ${err.message}`);
    return false;
  }
}
