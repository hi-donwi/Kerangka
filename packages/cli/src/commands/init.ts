/**
 * Kerangka CLI - Init Command
 * Writes a starter from the catalog into a new project (PLAN.md §13, §7.3; ADR-0043).
 */

import { join, relative, resolve } from "node:path";
import { suggestion } from "@kerangka/compiler";
import { listStarters, loadStarter, renderStarter, writeStarter } from "../starters.js";

export interface InitOptions {
  /** Target output directory (default: the app name for a workspace, otherwise the current directory). */
  output?: string;
  /** Application id / name (kebab-case). */
  name?: string;
  /** Authoring format: 'json' (default) or 'yaml'. */
  format?: "json" | "yaml";
  /** Overwrite existing files if present. */
  force?: boolean;
}

export function initCommand(templateName = "workspace", options: InitOptions = {}): boolean {
  const name = (templateName || "workspace").toLowerCase();
  const starter = loadStarter(name);
  if (!starter) {
    const available = listStarters().map((s) => s.starter);
    console.error(`Error: Unknown starter '${name}'. ${suggestion(name, available, "starters")}`);
    console.error("Run 'kerangka init --list' to see every starter.");
    return false;
  }

  const format = options.format ?? "json";
  const appName = options.name ?? (name === "workspace" ? "my-app" : name);
  const targetDir = resolve(options.output ?? (starter.layout === "workspace" ? appName : "."));

  try {
    writeStarter(targetDir, starter, renderStarter(starter, appName, format));

    // Where the next commands should point, relative to where the user is standing.
    const where = relative(process.cwd(), targetDir) || ".";
    const target = starter.layout === "document" ? join(where, `${appName}.kerangka.${format}`) : where;
    console.log(`\nSuccessfully initialized Kerangka project '${appName}' from starter '${name}' at: ${targetDir}`);
    console.log(`\nNext steps:`);
    const next = starter.next ?? ["kerangka check ${target}", "kerangka verify ${target}", "kerangka dev ${target}"];
    for (const command of next) {
      console.log(`  npx ${command.replaceAll("${target}", target)}`);
    }
    console.log("");
    return true;
  } catch (err) {
    console.error(`Error: Failed to initialize project at '${targetDir}': ${(err as Error).message}`);
    return false;
  }
}

/** `kerangka init --list`: every starter, with what it gives you. */
export function listStartersCommand(): boolean {
  const starters = listStarters();
  const width = Math.max(...starters.map((s) => s.starter.length));
  console.log("\nStarters (kerangka init <starter> --name <app>):\n");
  for (const starter of starters) {
    const layout = starter.layout === "workspace" ? "[workspace]" : "[document] ";
    console.log(`  ${starter.starter.padEnd(width)}  ${layout}  ${starter.description}`);
  }
  console.log("");
  return true;
}
