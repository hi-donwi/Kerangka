/**
 * Kerangka CLI - Switch Command
 * Instant polyglot stack switcher for existing projects.
 * Specification Version: 0.1
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile } from "@kerangka/compiler";
import {
  scaffoldBackend,
  scaffoldFrontend,
  type BackendStack,
  type FrontendStack,
  type DatabaseDialect,
} from "./scaffold.js";

export type SwitchType = "backend" | "frontend";

export interface SwitchOptions {
  model?: string;
  database?: string;
  cwd?: string;
}

export function switchCommand(
  type: string,
  target: string,
  options: SwitchOptions = {}
): boolean {
  try {
    const baseDir = path.resolve(options.cwd || process.cwd());
    const modelPath = resolveModelFile(baseDir, options.model);

    if (!modelPath) {
      console.error(
        "Error: No .kerangka.json model found. Run this command inside a Kerangka project or provide --model <path>."
      );
      return false;
    }

    const source = fs.readFileSync(modelPath, "utf-8");
    const kir = compile(source, { sourceFile: modelPath });
    const normType = type.toLowerCase();
    const db: DatabaseDialect = (options.database || "sqlite").toLowerCase() === "postgres" ? "postgres" : "sqlite";

    if (normType === "backend") {
      const backend = normalizeBackendStack(target);
      if (!backend) {
        console.error(
          `Error: Unsupported backend stack '${target}'. Supported: go, python, rust, node`
        );
        return false;
      }

      scaffoldBackend(baseDir, kir, backend, db);
      console.log(`Successfully switched backend stack to ${backend.toUpperCase()}`);
      console.log(`Updated directory: ${path.join(baseDir, "backend")}`);
      return true;

    } else if (normType === "frontend") {
      const frontend = normalizeFrontendStack(target);
      if (!frontend) {
        console.error(
          `Error: Unsupported frontend stack '${target}'. Supported: react, flutter`
        );
        return false;
      }

      scaffoldFrontend(baseDir, kir, frontend);
      console.log(`Successfully switched frontend stack to ${frontend.toUpperCase()}`);
      console.log(`Updated directory: ${path.join(baseDir, "frontend")}`);
      return true;

    } else {
      console.error(
        `Error: Invalid switch target type '${type}'. Must be 'backend' or 'frontend'.`
      );
      console.log("Usage: kerangka switch backend <go|python|rust|node>");
      console.log("       kerangka switch frontend <react|flutter>");
      return false;
    }
  } catch (err: any) {
    console.error(`Error switching stack: ${err.message}`);
    return false;
  }
}

function resolveModelFile(baseDir: string, explicitModel?: string): string | null {
  if (explicitModel) {
    const fullPath = path.resolve(baseDir, explicitModel);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  // Scan current directory for *.kerangka.json
  const files = fs.readdirSync(baseDir);
  const candidates = files.filter(
    (f) => f.endsWith(".kerangka.json") || f === "model.json"
  );

  if (candidates.length > 0 && candidates[0]) {
    return path.join(baseDir, candidates[0]);
  }

  return null;
}

function normalizeBackendStack(target: string): BackendStack | null {
  const norm = target.toLowerCase();
  switch (norm) {
    case "go":
    case "golang":
      return "go";
    case "python":
    case "py":
      return "python";
    case "rust":
    case "rs":
      return "rust";
    case "node":
    case "ts":
    case "typescript":
      return "node";
    default:
      return null;
  }
}

function normalizeFrontendStack(target: string): FrontendStack | null {
  const norm = target.toLowerCase();
  switch (norm) {
    case "react":
      return "react";
    case "flutter":
      return "flutter";
    default:
      return null;
  }
}
