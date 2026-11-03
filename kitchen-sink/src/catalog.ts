import { OFFICIAL_PACKS } from "../../packages/std/src/packs";
import { STD_PACKAGE } from "../../packages/std/src/std-package";

export interface StarterFile {
  from: string;
  to: string;
}

export interface StarterManifest {
  starter: string;
  description: string;
  layout: "document" | "workspace";
  tags?: string[];
  files: StarterFile[];
  directories?: string[];
  next?: string[];
}

export interface LogicPreset {
  id: string;
  name: string;
  packageName: string;
  kind: "type" | "trait" | "template" | "lint preset";
  description: string;
  sourcePath: string;
  definition: Record<string, unknown>;
}

export interface StarterPreviewFile {
  path: string;
  content: string;
}

const starterManifests = import.meta.glob<StarterManifest>("../../packages/cli/starters/*/starter.json", {
  eager: true,
  import: "default",
});

export const starterCatalog: StarterManifest[] = Object.values(starterManifests)
  .sort((a, b) => a.starter.localeCompare(b.starter));

const starterTemplateSources = import.meta.glob<string>("../../packages/cli/starters/**/*.{json,yaml,yml}", {
  eager: true,
  query: "?raw",
  import: "default",
});

function substituteApp(value: unknown, app: string): unknown {
  if (typeof value === "string") return value.replaceAll("${app}", app);
  if (Array.isArray(value)) return value.map((entry) => substituteApp(entry, app));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substituteApp(entry, app)]));
  }
  return value;
}

/** Render starter templates from their real source files, using the CLI's JSON output format. */
export function previewStarterFiles(starter: StarterManifest, app = "my-app"): StarterPreviewFile[] {
  return starter.files.map((file) => {
    const sourcePath = `../../packages/cli/starters/${starter.starter}/${file.from}`;
    const source = starterTemplateSources[sourcePath];
    if (source === undefined) throw new Error(`Starter preview source is missing: ${sourcePath}`);
    const content = JSON.stringify(substituteApp(JSON.parse(source), app), null, 2) + "\n";
    return {
      path: file.to.replaceAll("${app}", app).replaceAll("${ext}", "json"),
      content,
    };
  });
}

function presetEntries<T extends object>(
  kind: LogicPreset["kind"],
  definitions: Record<string, T> | undefined,
  packageName: string,
  sourcePath: string,
  idPrefix: string,
): LogicPreset[] {
  return Object.entries(definitions ?? {}).map(([name, definition]) => {
    const detail = definition as { description?: unknown };
    return {
      id: `${idPrefix}${name}`,
      name,
      packageName,
      kind,
      description: typeof detail.description === "string" ? detail.description : `${kind} provided by ${packageName}`,
      sourcePath,
      definition: definition as Record<string, unknown>,
    };
  });
}

const standardSource = "packages/std/src/std-package.ts";
const standardPresets = [
  ...presetEntries("type", STD_PACKAGE.types, STD_PACKAGE.package, standardSource, "std:"),
  ...presetEntries("trait", STD_PACKAGE.traits, STD_PACKAGE.package, standardSource, "std:"),
  ...presetEntries("template", STD_PACKAGE.templates, STD_PACKAGE.package, standardSource, "std:"),
  ...presetEntries("lint preset", STD_PACKAGE.presets, STD_PACKAGE.package, standardSource, ""),
];
const officialPresets = Object.values(OFFICIAL_PACKS).flatMap((pack) =>
  Object.entries(pack.templates ?? {}).map(([name, definition]) => ({
    id: `${pack.package.slice("@kerangka/".length)}:${name}`,
    name,
    packageName: pack.package,
    kind: "template" as const,
    description: definition.description ?? `Entity template provided by ${pack.package}`,
    sourcePath: "packages/std/src/packs.ts",
    definition: definition as unknown as Record<string, unknown>,
  }))
);

export const logicPresetCatalog: LogicPreset[] = [...standardPresets, ...officialPresets];

/** A valid Kerangka usage example for each current logic preset; it is displayed, never executed. */
export function logicPresetUsage(preset: LogicPreset): string {
  const document = (value: Record<string, unknown>) => JSON.stringify(value, null, 2);
  const base = { kerangka: "0.1", app: "preset-preview" };

  if (preset.kind === "type") {
    const fieldType = preset.id === "std:Money" ? "std:Money!" : preset.name;
    const fieldName = preset.name === "Money" ? "balance" : preset.name === "Address" ? "mailingAddress" : "period";
    return document({
      ...base,
      entities: { Account: { fields: { [fieldName]: fieldType } } },
    });
  }

  if (preset.kind === "trait") {
    return document({
      ...base,
      entities: { Record: { traits: [preset.id] } },
    });
  }

  switch (preset.id) {
    case "std:approval":
      return document({
        ...base,
        roles: ["employee", "manager"],
        entities: {
          Request: {
            fields: { status: "enum(draft, submitted, approved, rejected) = draft" },
            workflow: { use: preset.id, with: { submitter: "employee", approver: "manager" } },
          },
        },
      });
    case "std:masterDetail":
      return document({
        ...base,
        entities: { Invoice: { fields: { number: "string!", status: "string!" } } },
        views: {
          invoices: { use: preset.id, with: { entity: "Invoice", columns: ["number", "status"] } },
        },
      });
    case "identity:organization":
      return document({
        ...base,
        packages: { "@kerangka/identity": "^0.1" },
        roles: ["owner", "admin", "member"],
        entities: { Organization: { use: preset.id } },
      });
    case "identity:member":
      return document({
        ...base,
        packages: { "@kerangka/identity": "^0.1" },
        roles: ["owner", "admin", "member"],
        entities: {
          Organization: { use: "identity:organization" },
          Member: { use: preset.id, with: { organization: "Organization" } },
        },
      });
    case "admin:auditEntry":
      return document({
        ...base,
        packages: { "@kerangka/admin": "^0.1" },
        roles: ["admin", "system"],
        entities: { AuditEntry: { use: preset.id } },
      });
    default:
      if (preset.kind === "lint preset") {
        return document({ lint: { extends: [preset.id] } });
      }
      throw new Error(`No model usage preview is defined for ${preset.id}`);
  }
}

export function filterStarterCatalog(query: string): StarterManifest[] {
  return starterCatalog.filter((starter) => matchesCatalogSearch(query, [
    starter.starter,
    starter.description,
    starter.layout,
    ...(starter.tags ?? []),
    ...starter.files.flatMap((file) => [file.from, file.to]),
    ...(starter.directories ?? []),
    ...(starter.next ?? []),
  ]));
}

export function filterLogicPresetCatalog(query: string): LogicPreset[] {
  return logicPresetCatalog.filter((preset) => matchesCatalogSearch(query, [
    preset.id,
    preset.name,
    preset.packageName,
    preset.kind,
    preset.description,
    preset.sourcePath,
  ]));
}

export function matchesCatalogSearch(query: string, values: readonly string[]): boolean {
  const terms = query.trim().toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = values.join(" ").toLocaleLowerCase("en");
  return terms.every((term) => searchable.includes(term));
}
