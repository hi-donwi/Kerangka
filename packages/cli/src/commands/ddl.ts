/**
 * Kerangka CLI - DDL Command
 * Generates SQL DDL schema statements from a Kerangka model.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, CompilerError, generateDDL, SQLDialect } from "@kerangka/compiler";
import { resolveTargetFile } from "../target.js";

export interface DDLCommandOptions {
  dialect?: string;
  output?: string;
  audit?: boolean;
  drop?: boolean;
}

export function ddlCommand(filePath: string, options: DDLCommandOptions = {}): boolean {
  try {
    // A workspace directory resolves to its manifest, the same as every other command.
    const target = resolveTargetFile(filePath);
    const raw = readFileSync(target, "utf8");
    const kir = compile(raw, { sourcePath: target });

    const dialect = (options.dialect?.toLowerCase() ?? "postgres") as SQLDialect;
    if (dialect !== "postgres" && dialect !== "sqlite") {
      console.error(`Error: Unsupported SQL dialect '${options.dialect}'. Must be 'postgres' or 'sqlite'.`);
      return false;
    }

    const ddl = generateDDL(kir, {
      dialect,
      includeAuditColumns: options.audit ?? true,
      includeDrop: options.drop ?? false,
    });

    if (!options.output || options.output === "-") {
      process.stdout.write(ddl + "\n");
      return true;
    }

    const targetFile = resolve(options.output);
    writeFileSync(targetFile, ddl, "utf8");
    console.log(`WROTE DDL (${dialect}): ${targetFile}`);
    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: DDL generation failed for ${filePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
