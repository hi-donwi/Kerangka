/**
 * Kerangka CLI - db Command
 * Generates plain SQL migrations from two model versions, a SQLite database,
 * or a SQL schema file (PLAN.md §8.4, R19, ADR-0021, ADR-0032).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CompilerError,
  DBMigrationResult,
  KIRDocument,
  MigrationPhase,
  SQLDialect,
  compile,
  diffDatabaseSchema,
  loadSqlSchemaSource,
  loadSqliteSchema,
} from "@kerangka/compiler";

export interface DBDiffCommandOptions {
  dialect?: string;
  phase?: string;
  allowDestructive?: boolean;
  checkDestructive?: boolean;
  format?: string;
  output?: string;
}

const SQLITE_EXTENSIONS = [".sqlite", ".sqlite3", ".db"];

function isSqlitePath(sourcePath: string): boolean {
  const lower = sourcePath.toLowerCase();
  return SQLITE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isKirDocument(parsed: unknown): parsed is KIRDocument {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "kir" in parsed &&
    typeof (parsed as { kir: unknown }).kir === "string"
  );
}

/**
 * Loads a KIR document from a model source file (.json/.yaml), a compiled KIR
 * build, a SQL schema file (.sql), or a SQLite database file.
 */
export async function loadKirFromSource(sourcePath: string): Promise<KIRDocument> {
  if (isSqlitePath(sourcePath)) {
    return loadSqliteSchema(sourcePath);
  }

  const text = readFileSync(sourcePath, "utf8");

  if (sourcePath.toLowerCase().endsWith(".sql")) {
    return loadSqlSchemaSource(text);
  }

  // A .json/.yaml input is either a raw model or a compiled KIR build output.
  if (sourcePath.toLowerCase().endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isKirDocument(parsed)) return parsed;
    } catch {
      // Not JSON after all; fall through to compile.
    }
  }

  return compile(text, { sourcePath });
}

function printResultSummary(result: DBMigrationResult, oldSource: string, newSource: string): void {
  console.log(`Kerangka Database Migration: ${oldSource} -> ${newSource}`);
  console.log(
    `Dialect: ${result.dialect} · Phase: ${result.phase} · Steps: ${result.steps.length} ` +
      `(destructive: ${result.summary.destructiveCount})`
  );
  console.log(
    `Tables: +${result.summary.tablesCreated}/-${result.summary.tablesDropped} · ` +
      `Columns: +${result.summary.columnsAdded}/~${result.summary.columnsModified}/-${result.summary.columnsDropped} · ` +
      `Renamed: ${result.summary.columnsRenamed} · ` +
      `Indexes: +${result.summary.indexesCreated}/-${result.summary.indexesDropped}\n`
  );

  if (result.hasDestructiveSteps) {
    console.error(`WARNING: ${result.summary.destructiveCount} destructive operation(s) detected:`);
    for (const step of result.destructiveSteps) {
      console.error(`  - [${step.phase}] ${step.description}`);
    }
    console.error(
      "Rerun with --allow-destructive to approve them, or --phase expand|contract to split the migration."
    );
  }
}

export async function dbDiffCommand(
  oldSource: string,
  newSource: string,
  options: DBDiffCommandOptions = {}
): Promise<boolean> {
  const dialect = (options.dialect?.toLowerCase() ?? "postgres") as SQLDialect;
  if (dialect !== "postgres" && dialect !== "sqlite") {
    console.error(`Error: Unsupported SQL dialect '${options.dialect}'. Must be 'postgres' or 'sqlite'.`);
    return false;
  }

  const phase = (options.phase?.toLowerCase() ?? "all") as MigrationPhase;
  if (phase !== "all" && phase !== "expand" && phase !== "contract") {
    console.error(`Error: Unsupported phase '${options.phase}'. Must be 'all', 'expand', or 'contract'.`);
    return false;
  }

  const format = options.format ?? "text";
  if (format !== "text" && format !== "json") {
    console.error(`Error: --format must be 'text' or 'json', got '${format}'.`);
    return false;
  }

  const oldPath = resolve(process.cwd(), oldSource);
  const newPath = resolve(process.cwd(), newSource);
  for (const [label, sourcePath] of [
    ["old", oldPath],
    ["new", newPath],
  ] as const) {
    if (!existsSync(sourcePath)) {
      console.error(`Error: ${label} source not found: ${sourcePath}`);
      return false;
    }
  }

  try {
    const oldKir = await loadKirFromSource(oldPath);
    const newKir = await loadKirFromSource(newPath);

    const result = diffDatabaseSchema(oldKir, newKir, { dialect, phase });

    if (format === "json") {
      const payload = {
        old: oldSource,
        new: newSource,
        dialect: result.dialect,
        phase: result.phase,
        summary: result.summary,
        hasDestructiveSteps: result.hasDestructiveSteps,
        destructiveSteps: result.destructiveSteps,
        steps: result.steps,
        sql: result.sql,
      };
      const json = JSON.stringify(payload, null, 2);
      if (options.output && options.output !== "-") {
        const targetFile = resolve(options.output);
        writeFileSync(targetFile, json, "utf8");
        console.log(`WROTE DB DIFF (json): ${targetFile}`);
      } else {
        process.stdout.write(json + "\n");
      }
    } else {
      printResultSummary(result, oldSource, newSource);
      if (options.output && options.output !== "-") {
        const targetFile = resolve(options.output);
        writeFileSync(targetFile, result.sql, "utf8");
        console.log(`WROTE MIGRATION (${dialect}): ${targetFile}`);
      } else {
        process.stdout.write(result.sql + "\n");
      }
    }

    // Safety gate (R19): --check-destructive fails on unapproved destructive steps.
    if (options.checkDestructive && result.hasDestructiveSteps && !options.allowDestructive) {
      console.error("\nERROR: Destructive operations detected while --check-destructive is enabled.");
      return false;
    }

    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error("ERROR: db diff failed:");
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }
}
