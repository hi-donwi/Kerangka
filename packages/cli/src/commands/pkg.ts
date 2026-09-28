/**
 * Kerangka CLI - Package Command (kerangka pkg lock | install | list)
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateLockfile,
  LOCKFILE_NAME,
  PackageResolver,
  RawKerangkaDocument,
  writeLockfile,
} from "@kerangka/compiler";
import { parse as parseYaml } from "yaml";

export interface PkgCommandOptions {
  output?: string;
}

function resolveModelFile(targetPath?: string): { filePath: string; baseDir: string } | undefined {
  const candidate = targetPath ?? "kerangka.json";
  const resolved = path.resolve(candidate);

  if (fs.existsSync(resolved)) {
    if (fs.statSync(resolved).isDirectory()) {
      const jsonFile = path.join(resolved, "kerangka.json");
      const yamlFile = path.join(resolved, "kerangka.yaml");
      if (fs.existsSync(jsonFile)) return { filePath: jsonFile, baseDir: resolved };
      if (fs.existsSync(yamlFile)) return { filePath: yamlFile, baseDir: resolved };
    } else {
      return { filePath: resolved, baseDir: path.dirname(resolved) };
    }
  }

  // If running from directory without argument, check for any *.kerangka.json
  if (!targetPath) {
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd);
    const kFile = files.find((f) => f.endsWith(".kerangka.json") || f.endsWith(".kerangka.yaml"));
    if (kFile) {
      return { filePath: path.join(cwd, kFile), baseDir: cwd };
    }
  }

  return undefined;
}

function loadRawDocument(filePath: string): RawKerangkaDocument {
  const content = fs.readFileSync(filePath, "utf8");
  return (content.trim().startsWith("{") ? JSON.parse(content) : parseYaml(content)) as RawKerangkaDocument;
}

export function pkgCommand(
  subcommand: string,
  targetFile?: string,
  options: PkgCommandOptions = {}
): boolean {
  const modelInfo = resolveModelFile(targetFile);

  // If no model file exists, fallback to minimal document for current workspace
  const doc: RawKerangkaDocument = modelInfo
    ? loadRawDocument(modelInfo.filePath)
    : { kerangka: "0.1", app: path.basename(process.cwd()) };

  const baseDir = modelInfo ? modelInfo.baseDir : process.cwd();
  const resolver = new PackageResolver(doc, baseDir);
  const resolution = resolver.resolve();

  if (resolution.diagnostics.length > 0) {
    console.error("ERROR: Package resolution failed with diagnostics:");
    for (const diag of resolution.diagnostics) {
      console.error(`  - [${diag.code}] ${diag.message}`);
    }
    return false;
  }

  switch (subcommand) {
    case "lock":
    case "install": {
      const lock = generateLockfile(resolution);
      const lockPath = options.output ?? path.join(baseDir, LOCKFILE_NAME);
      writeLockfile(lockPath, lock);

      const pkgCount = Object.keys(lock.packages).length;
      console.log(`✓ Wrote ${LOCKFILE_NAME} with ${pkgCount} package(s) to ${lockPath}`);
      for (const [name, locked] of Object.entries(lock.packages)) {
        console.log(`  - ${name}@${locked.version} (${locked.resolved})`);
      }
      return true;
    }

    case "list": {
      console.log(`Resolved packages (${Object.keys(resolution.packages).length}):`);
      for (const [name, pkg] of Object.entries(resolution.packages)) {
        console.log(`\n• ${name}@${pkg.version} [${pkg.source}]`);
        const typeNames = Object.keys(pkg.types);
        const traitNames = Object.keys(pkg.traits);
        const templateNames = Object.keys(pkg.templates);
        if (typeNames.length > 0) console.log(`  Types: ${typeNames.join(", ")}`);
        if (traitNames.length > 0) console.log(`  Traits: ${traitNames.join(", ")}`);
        if (templateNames.length > 0) console.log(`  Templates: ${templateNames.join(", ")}`);
      }
      return true;
    }

    default:
      console.error(`ERROR: Unknown pkg subcommand '${subcommand}'. Valid: lock, install, list`);
      return false;
  }
}
