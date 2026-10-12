/**
 * Kerangka CLI - Starter Catalog
 *
 * A starter is data, not code (ADR-0043): `starters/<name>/starter.json` names the files it
 * writes, and adding a starter means adding a folder. `kerangka init` and `kerangka scaffold`
 * read the same catalog, and `starters.test.ts` holds every starter to the examples gate.
 *
 * A starter file may say `${app}` anywhere in a string value, and a target path may also say
 * `${ext}` (json or yaml). Nothing else is substituted: `${input.x}` and `${secret:NAME}` belong
 * to connectors and pass through untouched.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";

export type StarterLayout = "document" | "workspace";
export type StarterFormat = "json" | "yaml";

export interface StarterFile {
  /** Path inside the starter's folder. */
  from: string;
  /** Path inside the new project; may use `${app}` and `${ext}`. */
  to: string;
}

export interface StarterManifest {
  starter: string;
  description: string;
  /** `document`: one model file named after the app. `workspace`: a folder with `kerangka.<ext>`. */
  layout: StarterLayout;
  tags?: string[];
  files: StarterFile[];
  /** Empty folders the starter's structure expects, created so `kerangka add` has a place. */
  directories?: string[];
  /** Commands to suggest once the starter is written; may use `${target}`. */
  next?: string[];
}

/** A manifest together with the folder it was read from. */
export interface Starter extends StarterManifest {
  dir: string;
}

export interface RenderedFile {
  path: string;
  content: string;
}

/**
 * The catalog folder. `src/starters.ts` and `dist/starters.js` both sit one level below the
 * package root, so the same relative path serves the tests and the installed CLI.
 */
export function startersDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "starters");
}

export function loadStarter(name: string): Starter | undefined {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return undefined;
  const dir = join(startersDir(), name);
  const manifestPath = join(dir, "starter.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as StarterManifest;
  return { ...manifest, dir };
}

/** Every starter in the catalog, sorted by name. */
export function listStarters(): Starter[] {
  const root = startersDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadStarter(entry.name))
    .filter((starter): starter is Starter => starter !== undefined)
    .sort((a, b) => a.starter.localeCompare(b.starter));
}

const substituteApp = (value: unknown, app: string): unknown => {
  if (typeof value === "string") return value.replaceAll("${app}", app);
  if (Array.isArray(value)) return value.map((entry) => substituteApp(entry, app));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteApp(v, app)])
    );
  }
  return value;
};

/** The files a starter writes for this app, with their final paths and text. */
export function renderStarter(starter: Starter, app: string, format: StarterFormat): RenderedFile[] {
  return starter.files.map((file) => {
    const to = file.to.replaceAll("${app}", app).replaceAll("${ext}", format);
    const data = substituteApp(JSON.parse(readFileSync(join(starter.dir, file.from), "utf8")), app);
    const content = to.endsWith(".yaml") || to.endsWith(".yml")
      ? stringifyYaml(data)
      : JSON.stringify(data, null, 2) + "\n";
    return { path: to, content };
  });
}

/** Write a rendered starter into `targetDir`, creating the folders it declares. */
export function writeStarter(targetDir: string, starter: Starter, files: RenderedFile[]): void {
  mkdirSync(targetDir, { recursive: true });
  for (const folder of starter.directories ?? []) {
    mkdirSync(join(targetDir, folder), { recursive: true });
  }
  for (const file of files) {
    const out = join(targetDir, file.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file.content, "utf8");
  }
}

/** The model a single-document starter writes, as an object. */
export function starterDocument(name: string, app: string): Record<string, unknown> {
  const starter = loadStarter(name);
  if (!starter) throw new Error(`Unknown starter '${name}'`);
  if (starter.layout !== "document") {
    throw new Error(`Starter '${name}' is a workspace, not a single document`);
  }
  const file = starter.files.find((f) => f.to.startsWith("${app}.kerangka."));
  if (!file) throw new Error(`Starter '${name}' does not declare its model file`);
  return substituteApp(JSON.parse(readFileSync(join(starter.dir, file.from), "utf8")), app) as Record<string, unknown>;
}
