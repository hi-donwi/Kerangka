import { createHash } from "node:crypto";
import { parseJourney, resolveJourney } from "./journey.js";
import { parseDocument, LineCounter, isAlias, isMap, isSeq, isPair } from "yaml";
import {
  compile,
  CompilerError,
  generateOpenAPI,
  generateDDL,
  type RawKerangkaDocument,
  type FieldDefinition,
} from "@kerangka/compiler";
import { RecipeProjector } from "@kerangka/uidl-projector";
import {
  PROJECT_BYTES,
  SOURCE_BYTES,
  type Inspection,
  type InspectionResult,
  type SourceSnapshot,
  type SourceText,
  type StudioDiagnostic,
  type ScreenInfo,
  type JourneyInfo,
} from "./contracts.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const pageId = (key: string) => `page-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;

function formSections(view: unknown): string[][] {
  if (!record(view) || !Array.isArray(view.sections)) return [];
  return view.sections.filter((section): section is string[] => Array.isArray(section)).map((section) => section.filter((name) => typeof name === "string"));
}

function formSectionTitles(view: unknown): string[] {
  if (!record(view) || !Array.isArray(view.sectionTitles)) return [];
  return view.sectionTitles.filter((title): title is string => typeof title === "string");
}

class SourceFailure extends Error {
  constructor(readonly diagnostic: StudioDiagnostic) {
    super(diagnostic.code);
  }
}

function parseSource(source: SourceText, filename: string): unknown {
  const lines = new LineCounter();
  const document = parseDocument(source.text, { lineCounter: lines, uniqueKeys: true, strict: true });
  const deny = (code: string, offset = 0): never => {
    throw new SourceFailure({
      severity: "error",
      code,
      source: filename,
      message: "Source cannot be safely inspected in read-only Studio.",
      ...lines.linePos(offset),
      hint: "Inspect the highlighted source. Aliases, unsafe keys, and excessive nesting are not enabled.",
    });
  };
  if (document.errors.length) deny("STUDIO_PARSE_ERROR", document.errors[0]?.pos[0]);
  const stack: Array<[unknown, number]> = [[document.contents, 0]];
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (++count > 10000 || depth > 32) deny("STUDIO_JOB_LIMIT");
    if (isAlias(node)) deny("STUDIO_ALIAS_DENIED", node.range?.[0]);
    if (isPair(node)) {
      if (record(node.key) && ["__proto__", "constructor", "prototype"].includes(String(node.key.value)))
        deny("STUDIO_KEY_UNSUPPORTED");
      stack.push([node.key, depth + 1], [node.value, depth + 1]);
    } else if (isMap(node) || isSeq(node)) {
      for (const item of node.items) stack.push([item, depth + 1]);
    }
  }
  if (Buffer.byteLength(source.text) > SOURCE_BYTES) deny("STUDIO_JOB_LIMIT");
  if (source.format === "json") {
    try {
      JSON.parse(source.text);
    } catch {
      deny("STUDIO_PARSE_ERROR");
    }
  }
  return document.toJS({ maxAliasCount: 0 }) as unknown;
}

function syntheticValue(field: FieldDefinition, name: string, index: number): unknown {
  if (name === "title" || name === "name") return `Synthetic Request ${index + 1}`;
  switch (field.type) {
    case "bool":
    case "boolean":
      return false;
    case "int":
    case "integer":
    case "float":
      return field.min ?? index + 1;
    case "decimal":
      return "1.00";
    case "enum":
      return field.values?.[0] ?? "sample";
    case "date":
      return "2026-01-01";
    case "datetime":
      return "2026-01-01T00:00:00Z";
    case "uuid":
    case "ref":
      return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    case "list":
      return [];
    default:
      return `Sample ${name} ${index + 1}`;
  }
}

function inspect(input: SourceSnapshot): InspectionResult {
  const diagnostics: StudioDiagnostic[] = [];
  const source = input.sources[input.entry];
  if (!source || !process.permission || process.permission.has("fs.write") || process.permission.has("child"))
    throw new Error("Job policy unavailable");
  try {
    const raw = parseSource(source, input.entry);
    if (!record(raw))
      throw new SourceFailure({
        severity: "error",
        code: "STUDIO_PARSE_ERROR",
        source: input.entry,
        message: "The model root must be an object.",
      });
    const unsupported = (code: string, path: string, message: string): InspectionResult => ({
      inspection: null,
      diagnostics: [
        {
          severity: "error",
          code,
          source: input.entry,
          path,
          message,
          hint: "Source remains inspectable. External/context resolution is not enabled in this read-only profile.",
        },
      ],
    });
    if (raw.contexts !== undefined)
      return unsupported(
        "STUDIO_CONTEXTS_UNSUPPORTED",
        "/contexts",
        "Multi-document context compilation is not enabled in P1.",
      );
    if (
      raw.packages !== undefined &&
      (!record(raw.packages) ||
        Object.entries(raw.packages).some(
          ([name, version]) =>
            !["std", "@kerangka/std", "@kerangka/identity", "@kerangka/admin"].includes(name) ||
            typeof version !== "string" ||
            !/^[0-9^~*<>= .|+-]{1,64}$/.test(version),
        ))
    ) {
      return unsupported("STUDIO_PACKAGE_UNSUPPORTED", "/packages", "Only shipped official packs are available in P1.");
    }
    const kir = compile(source.text, { sourceFile: input.entry });
    const entities = Object.entries(kir.entities);
    if (entities.length > 50 || entities.reduce((n, [, entity]) => n + Object.keys(entity.fields).length, 0) > 500)
      return unsupported("STUDIO_JOB_LIMIT", "/entities", "The model exceeds the P1 inspection budget.");
    const synthetic: Inspection["synthetic"] = Object.create(null) as Inspection["synthetic"];
    for (const [name, entity] of entities) {
      synthetic[name] = Array.from({ length: 3 }, (_, index) => {
        const row: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const [key, field] of Object.entries(entity.fields)) row[key] = syntheticValue(field, key, index);
        row[entity.key] =
          entity.fields[entity.key]?.type === "uuid"
            ? syntheticValue(entity.fields[entity.key]!, entity.key, index)
            : `preview-${index + 1}`;
        return row;
      });
    }
    const projector = new RecipeProjector(kir);
    for (const [viewId, definition] of Object.entries(kir.views ?? {})) {
      if (!record(definition)) continue;
      const target = definition.list ?? definition.form;
      if (typeof target === "string" && !kir.entities[target])
        return unsupported(
          "STUDIO_VIEW_TARGET",
          `/views/${pointer(viewId)}`,
          "A view refers to an entity that is not present in this model.",
        );
    }
    const views = projector.views();
    if (views.length > 100) return unsupported("STUDIO_JOB_LIMIT", "/views", "The model exceeds the P1 screen budget.");
    const screens: ScreenInfo[] = views.map((view) => ({
      id: pageId(`view:${view.id}`),
      label: view.id,
      kind: view.kind,
      route: view.route,
      source: input.entry,
      ...(view.kind === "form"
        ? {
            entity: view.entity,
            sections: formSections(kir.views?.[view.id]),
            sectionTitles: formSectionTitles(kir.views?.[view.id]),
          }
        : {}),
      pointer: kir.views?.[view.id]
        ? `/views/${pointer(view.id)}`
        : `/entities/${pointer(view.kind === "dashboard" ? "" : view.entity)}`,
      document:
        view.kind === "list"
          ? projector.list(view.id)
          : view.kind === "form"
            ? projector.form(view.id, {
                id: String(synthetic[view.entity]?.[0]?.[kir.entities[view.entity]!.key] ?? "preview-1"),
                data: synthetic[view.entity]?.[0] ?? {},
                version: 1,
              })
            : projector.dashboard(
                view.id,
                projector.kpis(view.id).map(() => ({ error: "No live aggregates in synthetic preview" })),
              ),
    }));
    for (const [path, authored] of Object.entries(input.sources)) {
      if (!path.endsWith(".uidl.json")) continue;
      try {
        screens.push({
          id: pageId(`authored:${path}`),
          label: path,
          kind: "authored",
          route: "",
          source: path,
          pointer: "/root",
          document: parseSource(authored, path),
        });
      } catch (error) {
        if (error instanceof SourceFailure) diagnostics.push(error.diagnostic);
        else
          diagnostics.push({
            severity: "error",
            code: "STUDIO_PARSE_ERROR",
            source: path,
            message: "The authored document cannot be inspected.",
          });
      }
    }
    // Journeys are read from the project and resolved against the pages and the
    // operations that exist. A journey owns no behavior, so a broken one is reported,
    // never repaired.
    const journeys: JourneyInfo[] = [];
    for (const [path, source] of Object.entries(input.sources)) {
      if (!path.endsWith(".journey.json")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(source.text);
      } catch {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_JOURNEY_PARSE",
          source: path,
          message: "The journey is not valid JSON.",
        });
        continue;
      }
      const result = parseJourney(parsed);
      for (const item of result.diagnostics) {
        diagnostics.push({ ...item, source: path });
      }
      if (!result.journey) continue;
      const journey = result.journey;
      // An operation is named by the entity and the operation, the way the model names
      // it. The entity's key is a field key, not its name.
      const operationNames = new Set<string>();
      for (const [entityName, entity] of Object.entries(kir.entities)) {
        for (const name of Object.keys(entity.workflow?.transitions ?? {})) {
          operationNames.add(`${entityName}.${name}`);
        }
        for (const name of Object.keys(entity.actions ?? {})) operationNames.add(`${entityName}.${name}`);
      }
      // A journey names a page the way the project names it: a view name for a
      // generated page, a file path for an authored one.
      const pageContext = screens.flatMap((screen) => [
        { id: screen.label, document: screen.document },
        { id: screen.id, document: screen.document },
        // An authored page is also known by the name of its file, without the suffix.
        ...(screen.source
          ? [{ id: screen.source.replace(/\.uidl\.json$/, ""), document: screen.document }]
          : []),
      ]);
      const resolved = resolveJourney(journey, { pages: pageContext, operations: [...operationNames] });
      for (const item of resolved) {
        diagnostics.push({ ...item, source: path });
      }
      journeys.push({
        id: journey.id,
        name: journey.name,
        source: path,
        entry: journey.entry,
        steps: journey.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          ...(step.page ? { page: step.page } : {}),
          ...(step.operation ? { operation: step.operation } : {}),
          ...(step.label ? { label: step.label } : {}),
        })),
        links: journey.links.map((link) => ({
          id: link.id,
          from: link.from,
          to: link.to,
          kind: link.kind,
          ...(link.pointer ? { pointer: link.pointer } : {}),
          ...(link.label ? { label: link.label } : {}),
        })),
        diagnostics: [
          ...result.diagnostics.map((item) => ({ code: item.code, message: item.message, ...(item.path ? { path: item.path } : {}) })),
          ...resolved.map((item) => ({ code: item.code, message: item.message, ...(item.path ? { path: item.path } : {}) })),
        ],
      });
    }
    if (screens.length > 100)
      return unsupported("STUDIO_JOB_LIMIT", "/views", "The model and authored documents exceed the P1 screen budget.");
    return {
      diagnostics,
      inspection: {
        app: kir.app,
        title: String(kir.meta.title),
        roles: kir.roles ?? [],
        synthetic,
        screens,
        journeys,
        sandbox: {
          filesystemWrites: process.permission.has("fs.write"),
          childProcesses: process.permission.has("child"),
        },
        entities: entities.map(([name, entity]) => ({
          name,
          pointer: `/entities/${pointer(name)}`,
          fields: Object.entries(entity.fields).map(([key, field]) => ({
            name: key,
            type: field.type,
            required: field.required,
            computed: field.compute !== undefined,
          })),
          workflow: entity.workflow
            ? {
                states: entity.workflow.states ?? [],
                initial: entity.workflow.initial,
                terminal: entity.workflow.terminal ?? [],
              }
            : undefined,
          operations: [
            ...Object.entries(entity.workflow?.transitions ?? {}).map(([key, transition]) => ({
              name: key,
              kind: "transition" as const,
              roles: transition.roles ?? [],
              from: typeof transition.from === "string" ? [transition.from] : transition.from,
              to: transition.to,
              guarded: transition.when !== undefined,
            })),
            ...Object.entries(entity.actions ?? {}).map(([key, action]) => ({
              name: key,
              kind: "action" as const,
              roles: action.roles ?? [],
              guarded: action.when !== undefined,
            })),
          ],
          permissions: entity.permissions,
        })),
        outputs: {
          openapi: JSON.stringify(generateOpenAPI(kir), null, 2),
          postgres: generateDDL(kir, { dialect: "postgres" }),
          sqlite: generateDDL(kir, { dialect: "sqlite" }),
        },
      },
    };
  } catch (error) {
    if (error instanceof SourceFailure) return { inspection: null, diagnostics: [error.diagnostic] };
    if (error instanceof CompilerError)
      return {
        inspection: null,
        diagnostics: error.diagnostics.slice(0, 100).map((item) => ({
          severity: item.severity,
          code: item.code,
          source: input.entry,
          message: "Model validation failed. Inspect the highlighted declaration.",
          path: item.path?.slice(0, 512),
          line: item.line,
          column: item.column,
          hint: "Edit the source externally and refresh. Studio did not write the file.",
        })),
      };
    return {
      inspection: null,
      diagnostics: [
        {
          severity: "error",
          code: "STUDIO_JOB_FAILED",
          source: input.entry,
          message: "Model inspection failed without changing source.",
        },
      ],
    };
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > PROJECT_BYTES) process.exit(1);
});
process.stdin.on("end", () => {
  try {
    process.stdout.write(JSON.stringify(inspect(JSON.parse(input) as SourceSnapshot)));
  } catch {
    process.exitCode = 1;
  }
});
