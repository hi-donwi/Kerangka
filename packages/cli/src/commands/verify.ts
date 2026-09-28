/**
 * Kerangka CLI - Verify Command
 * Static analysis of workflows, permissions, decision tables, and events (PLAN.md §1731–1740 & §21).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { compile, CompilerDiagnostic, CompilerError, verifyDocument } from "@kerangka/compiler";
import { formatDiagnostic } from "./check.js";

export interface VerifyOptions {
  /** `text` (default) for people; `json` for editors, CI, and AI agents. */
  format?: "text" | "json";
}

export function verifyCommand(filePath: string, options: VerifyOptions = {}): boolean {
  const targetFile = resolveTargetFile(filePath);
  if (!existsSync(targetFile)) {
    console.error(`Error: File '${targetFile}' does not exist.`);
    return false;
  }

  const sourceText = readFileSync(targetFile, "utf8");
  let kir;
  try {
    kir = compile(sourceText, { sourcePath: targetFile });
  } catch (err) {
    const diagnostics =
      err instanceof CompilerError
        ? err.diagnostics
        : [
            {
              severity: "error" as const,
              code: "COMPILE_FAILED",
              message: (err as Error).message,
              hint: "Check model syntax before running static verification.",
            },
          ];

    if (options.format === "json") {
      console.log(JSON.stringify({ valid: false, file: filePath, findings: diagnostics }, null, 2));
    } else {
      for (const diag of diagnostics) {
        console.error(formatDiagnostic(filePath, diag));
      }
    }
    return false;
  }

  const result = verifyDocument(kir, sourceText);

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          valid: result.ok,
          file: filePath,
          errors: result.errors.length,
          warnings: result.warnings.length,
          findings: result.findings,
        },
        null,
        2
      )
    );
  } else if (result.ok && result.findings.length === 0) {
    console.log(`OK: ${filePath} passes verification (0 errors, 0 warnings).`);
  } else {
    for (const finding of result.findings) {
      if (finding.severity === "error") {
        console.error(formatDiagnostic(filePath, finding));
      } else {
        console.warn(formatDiagnostic(filePath, finding));
      }
    }

    const errCount = result.errors.length;
    const warnCount = result.warnings.length;
    console.error(
      `\n${result.findings.length} finding(s) in ${filePath}: ${errCount} error(s), ${warnCount} warning(s).`
    );
  }

  return result.ok;
}

function resolveTargetFile(pathArg: string): string {
  const resolved = resolve(process.cwd(), pathArg);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    const candidates = ["kerangka.json", "app.kerangka.json"];
    for (const c of candidates) {
      const p = join(resolved, c);
      if (existsSync(p)) return p;
    }
  }
  return resolved;
}
