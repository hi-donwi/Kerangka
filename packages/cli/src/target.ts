/**
 * Kerangka CLI - target resolution
 *
 * A command may be given a document path or a workspace directory. A directory is
 * resolved to its workspace manifest, the same way for every command.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const WORKSPACE_MANIFESTS = ["kerangka.json", "kerangka.yaml", "kerangka.yml"];

export function resolveTargetFile(pathStr: string): string {
  const abs = resolve(pathStr);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    for (const name of WORKSPACE_MANIFESTS) {
      const candidate = join(abs, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return abs;
}
