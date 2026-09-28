/**
 * Kerangka CLI - Lint Command
 * Boundaries, naming rules, and complexity budgets (PLAN.md §7.7).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  compile,
  CompilerError,
  DeploymentTopology,
  KerangkaLinter,
  kerangkaRecommendedPreset,
  LintPreset,
  LintResult,
  resolvePreset,
  WorkspaceLoader,
} from "@kerangka/compiler";

export interface LintOptions {
  /** `text` (default) for people; `json` for editors, CI, and AI agents. */
  format?: "text" | "json";
  /** Built-in preset name. The document's own `lint` block still applies. */
  preset?: string;
  /** Topology name from `deploy.kerangka.json`; turns on the service-boundary findings. */
  topology?: string;
  /** Lowest severity that makes the command fail. */
  failOn?: "error" | "warning";
}

/** A workspace root holds a manifest; anything else is a single-file document. */
const MANIFEST_NAMES = ["kerangka.json", "kerangka.yaml", "kerangka.yml"];

const SEVERITY_RANK: Record<string, number> = { error: 2, warning: 1, info: 0 };

export function lintCommand(path: string, options: LintOptions = {}): boolean {
  const manifest = resolveManifest(path);
  if (!manifest) {
    console.error(`Error: No Kerangka document at '${path}' (looked for ${MANIFEST_NAMES.join(", ")}).`);
    return false;
  }

  const text = readFileSync(manifest, "utf8");
  const sourcePath = manifest;

  let result: LintResult;
  try {
    const raw = (text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text)) as Record<
      string,
      unknown
    >;
    const kir = compile(text, { sourcePath });

    const preset = resolvePreset(options.preset ?? kerangkaRecommendedPreset.name);
    if (!preset) {
      console.error(`Error: Unknown lint preset '${options.preset}'.`);
      return false;
    }

    // A workspace is linted per context, so the loaded contexts are handed to the linter.
    const contexts = Array.isArray(raw.contexts)
      ? new WorkspaceLoader(raw as never, sourcePath).load().contexts
      : undefined;

    result = new KerangkaLinter({
      preset: preset as LintPreset,
      sourcePath,
      sourceText: text,
      rootDoc: raw as never,
      ...(contexts ? { contexts } : {}),
      ...(options.topology ? { topology: readTopology(manifest), topologyName: options.topology } : {}),
    }).lint(kir);
  } catch (err) {
    const diagnostics =
      err instanceof CompilerError
        ? err.diagnostics
        : [
            {
              severity: "error" as const,
              code: "LOAD_FAILED",
              message: (err as Error).message,
              hint: "Check that the file exists and is readable.",
            },
          ];
    if (options.format === "json") {
      console.log(
        JSON.stringify(
          { file: sourcePath, ok: false, preset: options.preset ?? "kerangka:recommended", diagnostics },
          null,
          2
        )
      );
    } else {
      for (const diag of diagnostics) console.error(formatLintDiagnostic(sourcePath, diag));
      console.error(`\n${diagnostics.length} error(s) in ${sourcePath}. Fix these before linting.`);
    }
    return false;
  }

  if (options.format === "json") {
    console.log(JSON.stringify({ file: sourcePath, ...result }, null, 2));
  } else {
    printTextReport(sourcePath, result, options.topology);
  }

  const failOn = SEVERITY_RANK[options.failOn ?? "error"] ?? 2;
  return !result.diagnostics.some((d) => (SEVERITY_RANK[d.severity] ?? 0) >= failOn);
}

/** `file:line:column: severity CODE: message`, the form editors and terminals link to. */
export function formatLintDiagnostic(filePath: string, diag: {
  message: string;
  code: string;
  severity: string;
  path?: string;
  line?: number;
  column?: number;
  hint?: string;
  file?: string;
}): string {
  // A context finding belongs to the context's own file, not to the workspace manifest.
  const target = diag.file ?? filePath;
  const location = diag.line !== undefined ? `${target}:${diag.line}:${diag.column ?? 1}` : target;
  const lines = [`${location}: ${diag.severity} ${diag.code}: ${diag.message}`];
  if (diag.path) lines.push(`    at ${diag.path}`);
  if (diag.hint) lines.push(`    hint: ${diag.hint}`);
  return lines.join("\n");
}

function printTextReport(filePath: string, result: LintResult, topology?: string): void {
  if (result.diagnostics.length === 0) {
    console.log(`OK: ${filePath} passes ${result.preset} (${summarize(result)}).`);
    return;
  }
  for (const diag of result.diagnostics) console.error(formatLintDiagnostic(filePath, diag));
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = result.diagnostics.length - errors;
  console.error(
    `\n${result.diagnostics.length} finding(s) in ${filePath} against ${result.preset}` +
      `${topology ? ` (topology '${topology}')` : ""}: ${errors} error(s), ${warnings} warning(s).`
  );
  console.error(`(${summarize(result)})`);
}

function summarize(result: LintResult): string {
  const c = result.counts;
  const parts = [
    `${c.entities} aggregate(s)`,
    `${c.fields} field(s)`,
    `${c.actions} action(s)`,
    `${c.events} event(s)`,
    c.lines ? `${c.lines} line(s)` : undefined,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Resolves a file, or the manifest inside a workspace directory. */
function resolveManifest(path: string): string | undefined {
  const target = resolve(path);
  if (existsSync(target) && statSync(target).isFile()) return target;
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const name of MANIFEST_NAMES) {
      const candidate = join(target, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Reads the deployment file beside a document or workspace manifest. */
function readTopology(sourcePath: string): DeploymentTopology | undefined {
  for (const dir of [dirname(sourcePath), join(dirname(sourcePath), basename(dirname(sourcePath)))]) {
    const candidate = join(dir, "deploy.kerangka.json");
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, "utf8")) as DeploymentTopology;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
