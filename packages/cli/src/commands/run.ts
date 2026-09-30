/**
 * Kerangka CLI - run command
 * Executes one action against a document and prints the result.
 *
 * PLAN.md §13: `kerangka run <doc> <action> --record r.json --input i.json`.
 * The result is JSON on stdout so a shell or an agent can read it; the human
 * summary goes to stderr. Effects are returned, never applied (§10).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { compile, CompilerError } from "@kerangka/compiler";
import { Engine, loadEngine } from "@kerangka/engine-ts";
import { resolveTargetFile } from "../target.js";

export interface RunOptions {
  /** Path to the record JSON, or the record itself as a JSON string. */
  record?: string;
  input?: string;
  actor?: string;
  now?: string;
  trace?: boolean;
}

function loadJsonArgument(
  value: string | undefined,
  label: string,
): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;

  const candidate = resolve(value);
  const raw = existsSync(candidate) && statSync(candidate).isFile() ? readFileSync(candidate, "utf8") : value;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`Error: ${label} must be a JSON object`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    console.error(`Error: ${label} is not valid JSON: ${(err as Error).message}`);
    return null;
  }
}

export function runCommand(filePath: string, action: string, options: RunOptions = {}): boolean {
  const targetFile = resolveTargetFile(filePath);
  if (!existsSync(targetFile)) {
    console.error(`Error: Document not found: ${filePath}`);
    return false;
  }
  if (!action) {
    console.error("Error: An action is required, for example Invoice.send");
    return false;
  }

  let engine: Engine;
  try {
    const kir = compile(readFileSync(targetFile, "utf8"), { sourcePath: targetFile });
    engine = loadEngine(kir);
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`ERROR: ${filePath} does not compile:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`ERROR: ${(err as Error).message}`);
    }
    return false;
  }

  const record = loadJsonArgument(options.record, "--record");
  const input = loadJsonArgument(options.input, "--input");
  const actor = loadJsonArgument(options.actor, "--actor");
  if (record === null || input === null || actor === null) {
    return false;
  }

  const runOptions: Record<string, unknown> = {};
  if (options.now) runOptions.now = options.now;
  if (options.trace) runOptions.trace = true;

  let result: Record<string, unknown>;
  try {
    result = engine.run(action, record ?? {}, input ?? {}, actor, runOptions) as unknown as Record<
      string,
      unknown
    >;
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    return false;
  }

  console.log(JSON.stringify(result, null, 2));

  const ok = result.ok === true;
  if (!ok) {
    console.error(`Not executed: ${String(result.code ?? result.error ?? "UNKNOWN")}`);
  } else {
    const effects = Array.isArray(result.effects) ? result.effects.length : 0;
    console.error(
      `Ran ${action}: ${String((result.record as Record<string, unknown>)?.status ?? "ok")} (${effects} effect(s) returned, not applied)`,
    );
  }

  return ok;
}
