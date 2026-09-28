/**
 * Kerangka Lockfile Generator and Verifier (kerangka.lock)
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import { CompilerDiagnostic } from "../types.js";
import { PackageResolutionResult } from "./resolver.js";

export interface LockedPackage {
  version: string;
  integrity: string;
  resolved: string;
  types?: string[];
  traits?: string[];
  templates?: string[];
}

export interface KerangkaLockfile {
  lockfileVersion: 1;
  packages: Record<string, LockedPackage>;
}

export const LOCKFILE_NAME = "kerangka.lock";

export function generateLockfile(resolution: PackageResolutionResult): KerangkaLockfile {
  const packages: Record<string, LockedPackage> = {};

  for (const [name, pkg] of Object.entries(resolution.packages)) {
    packages[name] = {
      version: pkg.version,
      integrity: pkg.integrity,
      resolved: pkg.source,
      types: Object.keys(pkg.types).sort(),
      traits: Object.keys(pkg.traits).sort(),
      templates: Object.keys(pkg.templates).sort(),
    };
  }

  return {
    lockfileVersion: 1,
    packages,
  };
}

export function writeLockfile(filePath: string, lockfile: KerangkaLockfile): void {
  const content = JSON.stringify(lockfile, null, 2) + "\n";
  fs.writeFileSync(filePath, content, "utf8");
}

export function readLockfile(filePath: string): KerangkaLockfile | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as KerangkaLockfile;
  } catch {
    return undefined;
  }
}

export function verifyLockfile(
  lockfile: KerangkaLockfile,
  resolution: PackageResolutionResult
): { valid: boolean; diagnostics: CompilerDiagnostic[] } {
  const diagnostics: CompilerDiagnostic[] = [];

  if (lockfile.lockfileVersion !== 1) {
    diagnostics.push({
      severity: "error",
      code: "LOCKFILE_VERSION_MISMATCH",
      message: `Unsupported lockfileVersion ${lockfile.lockfileVersion}. Expected 1.`,
      path: "/lockfileVersion",
      hint: "Regenerate kerangka.lock using 'kerangka pkg lock'.",
    });
  }

  for (const [name, resolvedPkg] of Object.entries(resolution.packages)) {
    const locked = lockfile.packages[name];
    if (!locked) {
      diagnostics.push({
        severity: "error",
        code: "LOCKFILE_MISSING_PACKAGE",
        message: `Package '${name}' is resolved but missing from kerangka.lock`,
        path: `/packages/${name}`,
        hint: "Update kerangka.lock with 'kerangka pkg lock'.",
      });
      continue;
    }

    if (locked.version !== resolvedPkg.version) {
      diagnostics.push({
        severity: "error",
        code: "LOCKFILE_VERSION_MISMATCH",
        message: `Package '${name}' resolved version ${resolvedPkg.version} does not match locked version ${locked.version}`,
        path: `/packages/${name}/version`,
        hint: "Run 'kerangka pkg lock' to update the lockfile.",
      });
    }

    if (locked.integrity && locked.integrity !== resolvedPkg.integrity) {
      diagnostics.push({
        severity: "error",
        code: "LOCKFILE_INTEGRITY_MISMATCH",
        message: `Package '${name}' integrity hash mismatch. Expected ${locked.integrity}, computed ${resolvedPkg.integrity}`,
        path: `/packages/${name}/integrity`,
        hint: "Package contents have changed. Verify authenticity or regenerate lockfile.",
      });
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
