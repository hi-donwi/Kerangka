/**
 * Kerangka CLI - Check Command
 * Validates document syntax, shorthand, references, and expressions.
 */

import { readFileSync } from "node:fs";
import { compile, CompilerDiagnostic, CompilerError, KIRDocument } from "@kerangka/compiler";
import { resolveTargetFile } from "../target.js";

export interface CheckOptions {
  /** `text` (default) for people; `json` for editors, CI, and AI agents. */
  format?: "text" | "json";
}

export function checkCommand(filePath: string, options: CheckOptions = {}): boolean {
  let kir: KIRDocument | undefined;
  let diagnostics: CompilerDiagnostic[] = [];
  const targetFile = resolveTargetFile(filePath);

  try {
    kir = compile(readFileSync(targetFile, "utf8"), { sourcePath: targetFile });
  } catch (err) {
    diagnostics =
      err instanceof CompilerError
        ? err.diagnostics
        : [
            {
              severity: "error",
              code: "LOAD_FAILED",
              message: (err as Error).message,
              hint: "Check that the file exists and is readable.",
            },
          ];
  }

  if (options.format === "json") {
    console.log(JSON.stringify(jsonReport(filePath, kir, diagnostics), null, 2));
  } else if (kir) {
    console.log(`OK: ${filePath} is valid (${summarize(kir)})`);
  } else {
    for (const diag of diagnostics) {
      console.error(formatDiagnostic(filePath, diag));
    }
    const count = diagnostics.length;
    console.error(`\n${count} ${count === 1 ? "error" : "errors"} in ${filePath}`);
  }

  return kir !== undefined;
}

/** `file:line:column: error CODE: message`, the form editors and terminals link to. */
export function formatDiagnostic(filePath: string, diag: CompilerDiagnostic): string {
  const location = diag.line !== undefined ? `${filePath}:${diag.line}:${diag.column ?? 1}` : filePath;
  const lines = [`${location}: ${diag.severity} ${diag.code}: ${diag.message}`];
  if (diag.path) lines.push(`    at ${diag.path}`);
  if (diag.hint) lines.push(`    hint: ${diag.hint}`);
  return lines.join("\n");
}

function summarize(kir: KIRDocument): string {
  const entities = Object.values(kir.entities);
  const rules = entities.reduce((n, e) => n + (e.rules?.length ?? 0) + (e.invariants?.length ?? 0), 0);
  const transitions = entities.reduce((n, e) => n + Object.keys(e.workflow?.transitions ?? {}).length, 0);
  return `App: '${kir.app}', ${entities.length} entities, ${rules} rules/invariants, ${transitions} transitions`;
}

function jsonReport(filePath: string, kir: KIRDocument | undefined, diagnostics: CompilerDiagnostic[]) {
  return {
    file: filePath,
    ok: kir !== undefined,
    ...(kir ? { app: kir.app } : {}),
    diagnostics,
  };
}

