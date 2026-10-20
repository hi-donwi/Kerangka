import { compile, CompilerError } from "@kerangka/compiler";
import { StudioError, sourcePath, type DraftRequest, type SourceSnapshot, type SourceText, type StudioDiagnostic } from "./contracts.js";
import { findPath, insertEntry, parseJson, setValue, type JsonNode } from "./json-edit.js";
import { sourceRevision } from "./revision.js";

export interface DraftResult {
  revision: string;
  sources: Record<string, SourceText>;
  applied: string[];
  diagnostics: StudioDiagnostic[];
}

export interface DraftOptions {
  /** Validate an edited source and return diagnostics. Defaults to a compiler check. */
  validate?: (entry: string, text: string) => StudioDiagnostic[];
}

const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Compiler diagnostics for one edited source, shared by the draft and the save path. */
/**
 * Overlay an unsaved source map onto the disk snapshot.
 *
 * Unknown paths and YAML text changes are rejected. Unchanged YAML stays so a JSON
 * edit can still carry the rest of the project. The disk map is not mutated.
 */
export function overlaySources(
  disk: Record<string, SourceText>,
  supplied: Record<string, SourceText> | undefined,
): Record<string, SourceText> {
  if (!supplied) return { ...disk };
  const sources: Record<string, SourceText> = { ...disk };
  for (const [path, source] of Object.entries(supplied)) {
    const existing = disk[path];
    if (!existing || !sourcePath(path)) throw new StudioError("STUDIO_WRITE_UNSUPPORTED");
    if (source.format !== existing.format) throw new StudioError("STUDIO_WRITE_UNSUPPORTED");
    if (existing.format !== "json") {
      if (source.text !== existing.text) throw new StudioError("STUDIO_WRITE_UNSUPPORTED");
      continue;
    }
    sources[path] = { format: "json", text: source.text };
  }
  return sources;
}

export function changedSources(before: Record<string, SourceText>, after: Record<string, SourceText>): string[] {
  return Object.keys(after).filter((path) => after[path]?.text !== before[path]?.text);
}

function stringValue(text: string, node: JsonNode | undefined): string | undefined {
  if (!node || node.kind !== "string") return undefined;
  try {
    const value = JSON.parse(text.slice(node.start, node.end));
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function applyFormSections(
  entry: string,
  source: SourceText,
  view: string,
  sections: string[][],
  sectionTitles: string[],
  diagnostics: StudioDiagnostic[],
): string | undefined {
  const path = `/views/${pointer(view)}`;
  if (source.format !== "json") {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_WRITE_UNSUPPORTED",
      source: entry,
      path,
      message: "Only JSON sources accept visual writes in this version.",
      hint: "YAML stays source-only.",
    });
    return undefined;
  }
  let root: JsonNode;
  try {
    root = parseJson(source.text);
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_DRAFT_PARSE",
      source: entry,
      message: error instanceof Error ? error.message : "The source is not valid JSON.",
    });
    return undefined;
  }
  const viewNode = findPath(root, ["views", view]);
  const formNode = findPath(root, ["views", view, "form"]);
  const entity = stringValue(source.text, formNode);
  if (!viewNode || viewNode.kind !== "object" || !entity) {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_OPERATION_TARGET",
      source: entry,
      path,
      message: `View '${view}' is not a generated form recipe.`,
      hint: "Authored UIDL stays source-only. Configure a view with a form target.",
    });
    return undefined;
  }
  const fields = findPath(root, ["entities", entity, "fields"]);
  const known = new Set(fields?.kind === "object" ? fields.entries.map((entry) => entry.key) : []);
  const missing = sections.flat().filter((name) => !known.has(name));
  if (missing.length) {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_FIELD_MISSING",
      source: entry,
      path: `${path}/sections`,
      message: `Form section refers to a field that is not on '${entity}': ${missing.join(", ")}.`,
    });
    return undefined;
  }
  const sectionsJson = JSON.stringify(sections);
  const titlesJson = JSON.stringify(sectionTitles);
  let text = source.text;
  const sectionsNode = findPath(root, ["views", view, "sections"]);
  text = sectionsNode ? setValue(text, sectionsNode, sectionsJson) : insertEntry(text, viewNode, "sections", sectionsJson);
  const again = parseJson(text);
  const viewAgain = findPath(again, ["views", view]);
  const titlesNode = findPath(again, ["views", view, "sectionTitles"]);
  if (!viewAgain || viewAgain.kind !== "object") return undefined;
  return titlesNode ? setValue(text, titlesNode, titlesJson) : insertEntry(text, viewAgain, "sectionTitles", titlesJson);
}

export function sourceDiagnostics(entry: string, text: string): StudioDiagnostic[] {
  try {
    compile(text, { sourceFile: entry });
    return [];
  } catch (error) {
    if (error instanceof CompilerError) {
      return error.diagnostics.slice(0, 100).map((item) => ({
        severity: item.severity,
        code: item.code,
        source: entry,
        message: item.message,
        path: item.path?.slice(0, 512),
        line: item.line,
        column: item.column,
        hint: item.hint,
      }));
    }
    return [
      {
        severity: "error",
        code: "STUDIO_DRAFT_INVALID",
        source: entry,
        message: "The edited source could not be validated.",
      },
    ];
  }
}

/**
 * Apply authored operations to the raw entry source at an expected revision.
 *
 * The returned sources are new values; the input snapshot is never mutated. A stale
 * expected revision is a recoverable conflict that changes nothing. An edit the compiler
 * rejects is still returned (a recoverable invalid draft) with its diagnostics. KIR is
 * derived inside validation only and is never returned or edited.
 */
export function applyDraftOperations(
  snapshot: SourceSnapshot,
  request: DraftRequest,
  options: DraftOptions = {},
): DraftResult {
  const diagnostics: StudioDiagnostic[] = [];
  const applied: string[] = [];
  if (request.expectedRevision !== snapshot.revision) {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_REVISION_CONFLICT",
      source: snapshot.entry,
      message: "The draft changed since it was opened. Reload before applying edits.",
      hint: "Refresh the source snapshot and reapply the operations.",
    });
    return { revision: snapshot.revision, sources: snapshot.sources, applied, diagnostics };
  }

  const validate = options.validate ?? sourceDiagnostics;
  const sources: Record<string, SourceText> = { ...snapshot.sources };
  const edited = new Set<string>();

  for (const operation of request.operations) {
    const source = sources[snapshot.entry]!;
    if (operation.op === "setFormSections") {
      const editedText = applyFormSections(
        snapshot.entry,
        source,
        operation.view,
        operation.sections,
        operation.sectionTitles,
        diagnostics,
      );
      if (editedText) {
        sources[snapshot.entry] = { format: "json", text: editedText };
        edited.add(snapshot.entry);
        applied.push(`setFormSections ${operation.view}`);
      }
      continue;
    }
    if (operation.op !== "addEntityField" && operation.op !== "setEntityField") {
      const kind = (operation as { op?: string }).op ?? "unknown";
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_UNSUPPORTED",
        source: snapshot.entry,
        message: `Unsupported draft operation '${kind}'. Source is unchanged.`,
      });
      continue;
    }
    const { entity, field } = operation;
    const entityPath = `/entities/${pointer(entity)}`;
    if (source.format !== "json") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_WRITE_UNSUPPORTED",
        source: snapshot.entry,
        path: entityPath,
        message: "Only JSON sources accept visual writes in this version.",
        hint: "Edit this source in its own editor; YAML stays source-only.",
      });
      continue;
    }
    let root: JsonNode;
    try {
      root = parseJson(source.text);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: snapshot.entry,
        message: error instanceof Error ? error.message : "The source is not valid JSON.",
      });
      continue;
    }
    const fields = findPath(root, ["entities", entity, "fields"]);
    if (!fields || fields.kind !== "object") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: snapshot.entry,
        path: entityPath,
        message: `Entity '${entity}' has no editable fields container.`,
      });
      continue;
    }
    const member = `${entityPath}/fields/${pointer(field)}`;
    const existing = findPath(root, ["entities", entity, "fields", field]);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || ["__proto__", "constructor", "prototype"].includes(field)) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_FIELD_NAME",
        source: snapshot.entry,
        path: member,
        message: `'${field}' is not a supported field name.`,
      });
      continue;
    }
    if (operation.op === "addEntityField" && existing) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_FIELD_EXISTS",
        source: snapshot.entry,
        path: member,
        message: `Field '${field}' already exists on '${entity}'.`,
      });
      continue;
    }
    if (operation.op === "setEntityField" && !existing) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_FIELD_MISSING",
        source: snapshot.entry,
        path: member,
        message: `Field '${field}' does not exist on '${entity}'.`,
      });
      continue;
    }
    let text: string;
    try {
      text =
        operation.op === "addEntityField" && !existing
          ? insertEntry(source.text, fields, field, JSON.stringify(operation.definition))
          : setValue(source.text, existing!, JSON.stringify(operation.definition));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_FAILED",
        source: snapshot.entry,
        path: member,
        message: error instanceof Error ? error.message : "The operation could not be applied.",
      });
      continue;
    }
    sources[snapshot.entry] = { format: "json", text };
    edited.add(snapshot.entry);
    applied.push(`${operation.op} ${entity}.${field}`);
  }

  for (const path of edited) diagnostics.push(...validate(path, sources[path]!.text));
  return { revision: sourceRevision(sources), sources, applied, diagnostics };
}
