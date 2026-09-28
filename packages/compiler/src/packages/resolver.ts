/**
 * Kerangka Package Resolver
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  STD_PACKAGE,
  StdLintPreset,
  StdPackageManifest,
  StdTemplate,
  StdTraitDefinition,
  StdTypeDefinition,
} from "@kerangka/std";
import { parse as parseYaml } from "yaml";
import { pointer } from "../diagnostics.js";
import { CompilerDiagnostic, RawKerangkaDocument } from "../types.js";

export interface ResolvedPackage {
  name: string;
  version: string;
  source: string;
  integrity: string;
  manifest: StdPackageManifest;
  types: Record<string, StdTypeDefinition>;
  traits: Record<string, StdTraitDefinition>;
  templates: Record<string, StdTemplate>;
  presets: Record<string, StdLintPreset>;
}

export interface PackageResolutionResult {
  packages: Record<string, ResolvedPackage>;
  diagnostics: CompilerDiagnostic[];
  types: Record<string, StdTypeDefinition>;
  traits: Record<string, StdTraitDefinition>;
  templates: Record<string, StdTemplate>;
  presets: Record<string, StdLintPreset>;
}

export function computePackageIntegrity(manifest: StdPackageManifest): string {
  const serialized = JSON.stringify(manifest, Object.keys(manifest).sort());
  const hash = createHash("sha256").update(serialized).digest("hex");
  return `sha256-${hash}`;
}

function parseManifestFile(filePath: string): StdPackageManifest {
  const content = fs.readFileSync(filePath, "utf8");
  return (content.trim().startsWith("{") ? JSON.parse(content) : parseYaml(content)) as StdPackageManifest;
}

export class PackageResolver {
  private readonly diagnostics: CompilerDiagnostic[] = [];

  constructor(
    private readonly rootDoc: RawKerangkaDocument,
    private readonly basePath?: string
  ) {}

  resolve(): PackageResolutionResult {
    const packages: Record<string, ResolvedPackage> = {};
    const types: Record<string, StdTypeDefinition> = {};
    const traits: Record<string, StdTraitDefinition> = {};
    const templates: Record<string, StdTemplate> = {};
    const presets: Record<string, StdLintPreset> = {};

    // 1. Always make standard library (@kerangka/std) available
    const stdResolved: ResolvedPackage = {
      name: STD_PACKAGE.package,
      version: STD_PACKAGE.version,
      source: `builtin:${STD_PACKAGE.package}@${STD_PACKAGE.version}`,
      integrity: computePackageIntegrity(STD_PACKAGE),
      manifest: STD_PACKAGE,
      types: STD_PACKAGE.types ?? {},
      traits: STD_PACKAGE.traits ?? {},
      templates: STD_PACKAGE.templates ?? {},
      presets: STD_PACKAGE.presets ?? {},
    };
    packages[STD_PACKAGE.package] = stdResolved;

    this.registerPackageExports(stdResolved, "std", types, traits, templates, presets);

    // 2. Resolve packages declared in root document
    const declaredPackages = this.rootDoc.packages ?? {};
    for (const [pkgName, versionRange] of Object.entries(declaredPackages)) {
      if (pkgName === "@kerangka/std" || pkgName === "std") {
        // Built-in @kerangka/std already registered
        continue;
      }

      const resolved = this.resolvePackage(pkgName, versionRange);
      if (resolved) {
        packages[pkgName] = resolved;
        const prefix = pkgName.startsWith("@") ? pkgName.split("/")[1]! : pkgName;
        this.registerPackageExports(resolved, prefix, types, traits, templates, presets);
      }
    }

    return {
      packages,
      diagnostics: this.diagnostics,
      types,
      traits,
      templates,
      presets,
    };
  }

  private resolvePackage(pkgName: string, versionRange: string): ResolvedPackage | undefined {
    const base = this.basePath ?? process.cwd();

    // Check if local file / folder path
    if (pkgName.startsWith(".") || pkgName.startsWith("/") || versionRange.startsWith("file:")) {
      const targetDir = versionRange.startsWith("file:")
        ? path.resolve(base, versionRange.replace(/^file:/, ""))
        : path.resolve(base, pkgName);

      const candidateFiles = [
        path.join(targetDir, "kerangka.json"),
        path.join(targetDir, "kerangka.yaml"),
        path.join(targetDir, "kerangka.yml"),
      ];

      for (const cand of candidateFiles) {
        if (fs.existsSync(cand)) {
          try {
            const manifest = parseManifestFile(cand);
            return {
              name: manifest.package ?? pkgName,
              version: manifest.version ?? "0.1.0",
              source: `file:${path.relative(base, targetDir)}`,
              integrity: computePackageIntegrity(manifest),
              manifest,
              types: manifest.types ?? {},
              traits: manifest.traits ?? {},
              templates: manifest.templates ?? {},
              presets: manifest.presets ?? {},
            };
          } catch (err) {
            this.diagnostics.push({
              severity: "error",
              code: "PACKAGE_PARSE_ERROR",
              message: `Failed to parse package manifest at '${cand}': ${(err as Error).message}`,
              path: pointer("packages", pkgName),
              hint: "Ensure the package manifest is valid JSON or YAML.",
            });
            return undefined;
          }
        }
      }

      this.diagnostics.push({
        severity: "error",
        code: "PACKAGE_NOT_FOUND",
        message: `Package manifest not found for '${pkgName}' at '${targetDir}'`,
        path: pointer("packages", pkgName),
        hint: "Create a kerangka.json manifest in the target package folder.",
      });
      return undefined;
    }

    // Check node_modules
    const nodeModulesCandidate = path.resolve(base, "node_modules", pkgName, "kerangka.json");
    if (fs.existsSync(nodeModulesCandidate)) {
      try {
        const manifest = parseManifestFile(nodeModulesCandidate);
        return {
          name: pkgName,
          version: manifest.version ?? versionRange,
          source: `npm:${pkgName}@${manifest.version ?? versionRange}`,
          integrity: computePackageIntegrity(manifest),
          manifest,
          types: manifest.types ?? {},
          traits: manifest.traits ?? {},
          templates: manifest.templates ?? {},
          presets: manifest.presets ?? {},
        };
      } catch (err) {
        this.diagnostics.push({
          severity: "error",
          code: "PACKAGE_PARSE_ERROR",
          message: `Failed to parse package manifest for '${pkgName}': ${(err as Error).message}`,
          path: pointer("packages", pkgName),
          hint: "Check package manifest syntax.",
        });
        return undefined;
      }
    }

    this.diagnostics.push({
      severity: "error",
      code: "PACKAGE_NOT_FOUND",
      message: `Cannot resolve package '${pkgName}' with range '${versionRange}'`,
      path: pointer("packages", pkgName),
      hint: `Install '${pkgName}' or verify package name and version range.`,
    });
    return undefined;
  }

  private registerPackageExports(
    pkg: ResolvedPackage,
    prefix: string,
    types: Record<string, StdTypeDefinition>,
    traits: Record<string, StdTraitDefinition>,
    templates: Record<string, StdTemplate>,
    presets: Record<string, StdLintPreset>
  ): void {
    // Types
    for (const [name, def] of Object.entries(pkg.types)) {
      types[`${prefix}:${name}`] = def;
      types[`${pkg.name}:${name}`] = def;
      if (!types[name]) {
        types[name] = def;
      }
    }

    // Traits
    for (const [name, def] of Object.entries(pkg.traits)) {
      traits[`${prefix}:${name}`] = def;
      traits[`${pkg.name}:${name}`] = def;
      if (!traits[name]) {
        traits[name] = def;
      }
    }

    // Templates
    for (const [name, def] of Object.entries(pkg.templates)) {
      templates[`${prefix}:${name}`] = def;
      templates[`${pkg.name}:${name}`] = def;
      if (!templates[name]) {
        templates[name] = def;
      }
    }

    // Presets
    for (const [name, def] of Object.entries(pkg.presets)) {
      presets[name] = def;
      presets[`${prefix}:${name}`] = def;
    }
  }
}
