import { compile, CompilerError } from "@kerangka/compiler";
import { propertyProblem, type EditorCatalog } from "./editor-catalog.js";
import {
  StudioError,
  sourcePath,
  type DraftOperation,
  type JourneyDraftOperation,
  type DraftRequest,
  type SourceSnapshot,
  type SourceText,
  type StudioDiagnostic,
} from "./contracts.js";
import {
  findPath,
  findTreeNode,
  insertArrayItem,
  insertArrayItemAt,
  insertEntry,
  parseJson,
  removeArrayItem,
  setValue,
  type JsonNode,
} from "./json-edit.js";
import { journeyInternalErrors, parseJourney } from "./journey.js";
import { sourceRevision } from "./revision.js";
import { uidlDocument } from "./uidl-document.js";

export interface DraftResult {
  revision: string;
  sources: Record<string, SourceText>;
  applied: string[];
  diagnostics: StudioDiagnostic[];
}

export interface DraftOptions {
  /** Host-owned catalog generated from the pinned renderer, never request metadata. */
  catalog?: EditorCatalog;
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
    if (!sourcePath(path)) throw new StudioError("STUDIO_WRITE_UNSUPPORTED");
    const existing = disk[path];
    if (!existing) {
      // A new source is a new file. It has to be a JSON document the runtime can
      // render, and the save path checks the rest when it writes it.
      if (source.format !== "json") throw new StudioError("STUDIO_WRITE_UNSUPPORTED");
      if (!uidlDocument(source.text)) throw new StudioError("STUDIO_SAVE_NOT_DOCUMENT");
      sources[path] = { format: "json", text: source.text };
      continue;
    }
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

function transitionJson(from: string[], to: string, roles: string[], when?: string): string {
  const value: Record<string, unknown> = { from: from.length === 1 ? from[0] : from, to, roles };
  if (when) value.when = when;
  return JSON.stringify(value);
}

function applyTransition(
  entry: string,
  source: SourceText,
  entity: string,
  transition: string,
  from: string[],
  to: string,
  roles: string[],
  when: string | undefined,
  diagnostics: StudioDiagnostic[],
): string | undefined {
  const path = `/entities/${pointer(entity)}/workflow/transitions/${pointer(transition)}`;
  if (source.format !== "json") {
    diagnostics.push({ severity: "error", code: "STUDIO_WRITE_UNSUPPORTED", source: entry, path, message: "Only JSON sources accept visual writes in this version." });
    return undefined;
  }
  let root: JsonNode;
  try {
    root = parseJson(source.text);
  } catch (error) {
    diagnostics.push({ severity: "error", code: "STUDIO_DRAFT_PARSE", source: entry, message: error instanceof Error ? error.message : "The source is not valid JSON." });
    return undefined;
  }
  const entityNode = findPath(root, ["entities", entity]);
  const workflowNode = findPath(root, ["entities", entity, "workflow"]);
  const transitionsNode = findPath(root, ["entities", entity, "workflow", "transitions"]);
  const statesNode = findPath(root, ["entities", entity, "workflow", "states"]);
  const states = statesNode?.kind === "array" ? statesNode.items.map((node) => (node.kind === "string" ? JSON.parse(source.text.slice(node.start, node.end)) : "")).filter(Boolean) : [];
  if (!entityNode || entityNode.kind !== "object" || !workflowNode || workflowNode.kind !== "object" || !transitionsNode || transitionsNode.kind !== "object") {
    diagnostics.push({ severity: "error", code: "STUDIO_OPERATION_TARGET", source: entry, path: `/entities/${pointer(entity)}`, message: `Entity '${entity}' has no editable workflow.` });
    return undefined;
  }
  const missingStates = [to, ...from].filter((state) => states.length > 0 && !states.includes(state));
  if (missingStates.length) {
    diagnostics.push({ severity: "error", code: "STUDIO_FIELD_MISSING", source: entry, path, message: `Transition refers to an unknown state: ${missingStates.join(", ")}.` });
    return undefined;
  }
  const value = transitionJson(from, to, roles, when);
  const existing = findPath(root, ["entities", entity, "workflow", "transitions", transition]);
  let text = source.text;
  if (existing) text = setValue(text, existing, value);
  else text = insertEntry(text, transitionsNode, transition, value);
  return text;
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
 * Give a copied subtree identifiers of its own.
 *
 * A copy that keeps the original's identifiers would be a second name for the same
 * node, and every reference to it would become ambiguous. The copy is new content, so
 * its identifiers are remapped; the original is not touched.
 */
function remapIdentifiers(node: unknown, originalId: string): unknown {
  if (Array.isArray(node)) return node.map((item) => remapIdentifiers(item, originalId));
  if (typeof node !== "object" || node === null) return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "id" && typeof value === "string") {
      result[key] = value === originalId ? `${value}-copy` : `${value}-copy`;
      continue;
    }
    result[key] = remapIdentifiers(value, originalId);
  }
  return result;
}

/**
 * Apply one operation to a UIDL document.
 *
 * The document keeps every byte the author wrote, and only the node changes. The
 * result is checked against the runtime's document rules before it is returned, so an
 * edit that would break the document is refused and the file is left as it was.
 */
function applyUidlOperation(
  path: string,
  source: SourceText,
  operation: Extract<DraftOperation, { op: `uidl${string}` }>,
  diagnostics: StudioDiagnostic[],
  catalog?: EditorCatalog,
): string | undefined {
  if (source.format !== "json") {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_WRITE_UNSUPPORTED",
      source: path,
      message: "Only JSON sources accept visual writes in this version.",
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
      source: path,
      message: error instanceof Error ? error.message : "The source is not valid JSON.",
    });
    return undefined;
  }

  // The node tree hangs under the document's `root`.
  const tree = findPath(root, ["root"]) ?? root;

  let text: string;
  let summary: string;
  if (operation.op === "uidlSetTheme" || operation.op === "uidlSetNodeThemeRef") {
    if (root.kind !== "object") return undefined;
    const current = JSON.parse(source.text) as { theme?: string };
    let target: JsonNode = root;
    const key = operation.op === "uidlSetTheme" ? "theme" : "themeRef";
    const value = operation.op === "uidlSetTheme" ? operation.theme : operation.themeRef;
    let valid = Boolean(catalog?.themes.some((theme) => theme.id === value));
    if (operation.op === "uidlSetNodeThemeRef") {
      const found = findTreeNode(source.text, tree, operation.node);
      if (!found || found.node.kind !== "object") return undefined;
      target = found.node;
      const type = stringValue(source.text, findPath(target, ["type"])) ?? "";
      const theme = catalog?.themes.find((entry) => entry.id === (current.theme || "theme-light"));
      valid = value === "" || Boolean(theme?.variants[type.toLowerCase()]?.includes(value));
    }
    if (!valid || target.kind !== "object") {
      diagnostics.push({ severity: "error", code: "STUDIO_UIDL_THEME", source: path, message: "Choose a theme or variant available in the host renderer." });
      return undefined;
    }
    const existing = findPath(target, [key]);
    text = existing ? setValue(source.text, existing, JSON.stringify(value)) : insertEntry(source.text, target, key, JSON.stringify(value));
    summary = operation.op;
  } else if (operation.op === "uidlSetNodeProp") {
    const found = findTreeNode(source.text, tree, operation.node);
    if (!found) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.node}'.`,
      });
      return undefined;
    }
    if (found.node.kind !== "object") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The node '${operation.node}' cannot be changed.`,
      });
      return undefined;
    }
    const props = found.node.entries.find((entry) => entry.key === "props");
    if (props && props.value.kind !== "object") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The node '${operation.node}' has no properties to change.`,
      });
      return undefined;
    }
    const key = operation.prop.key;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `'${key}' is not a property name a node can carry.`,
      });
      return undefined;
    }
    const type = stringValue(source.text, findPath(found.node, ["type"])) ?? "";
    const problem = propertyProblem(catalog, type, key, operation.prop.value);
    if (problem) {
      diagnostics.push({ severity: "error", code: "STUDIO_UIDL_PROPERTY", source: path, message: problem });
      return undefined;
    }
    const existing = props?.value.kind === "object" ? props.value.entries.find((entry) => entry.key === key) : undefined;
    const valueText = JSON.stringify(operation.prop.value, null, 2);
    try {
      text = existing
        ? setValue(source.text, existing.value, valueText)
        : props ? insertEntry(source.text, props.value, key, valueText)
          : insertEntry(source.text, found.node, "props", JSON.stringify({ [key]: operation.prop.value }));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
    summary = `uidlSetNodeProp ${operation.node}.${key}`;
  } else if (operation.op === "uidlMoveNode") {
    const found = findTreeNode(source.text, tree, operation.node);
    if (!found || found.children === undefined || found.index === undefined) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.node}'.`,
      });
      return undefined;
    }
    const parent = findTreeNode(source.text, tree, operation.parent);
    if (!parent) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.parent}'.`,
      });
      return undefined;
    }
    const type = stringValue(source.text, findPath(parent.node, ["type"])) ?? "";
    const widget = catalog?.components[type];
    if ((parent.node.start >= found.node.start && parent.node.end <= found.node.end) ||
        (widget && (operation.slot ? !widget.slots.includes(operation.slot) : !widget.acceptsChildren))) {
      diagnostics.push({ severity: "error", code: "STUDIO_UIDL_MOVE", source: path, message: "A node cannot move into itself, a descendant, or an incompatible container." });
      return undefined;
    }
    const destination = operation.slot ? ["slots", operation.slot] : ["children"];
    const children = findPath(parent.node, destination);
    if (!children || children.kind !== "array") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The node '${operation.parent}' cannot take a child.`,
      });
      return undefined;
    }
    const finalIndex = Math.max(0, Math.min(operation.index, children.items.length - (children.start === found.children.start ? 1 : 0)));
    if (children.start === found.children.start && finalIndex === found.index) return undefined;
    try {
      const without = removeArrayItem(source.text, found.children, found.index);
      const again = parseJson(without);
      const againTree = findPath(again, ["root"]) ?? again;
      const againParent = findTreeNode(without, againTree, operation.parent);
      const againChildren = againParent ? findPath(againParent.node, destination) : undefined;
      if (!againChildren || againChildren.kind !== "array") throw new Error("The target cannot take a child.");
      const index = Math.max(0, Math.min(finalIndex, againChildren.items.length));
      // The node moves as the author wrote it, not as a re-serialized value.
      const nodeText = source.text.slice(found.node.start, found.node.end);
      text = insertArrayItemAt(without, againChildren, index, nodeText);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
    summary = `uidlMoveNode ${operation.node}`;
  } else if (operation.op === "uidlAddDefinition" || operation.op === "uidlUseDefinition") {
    if (operation.op === "uidlAddDefinition") {
      const definitions = findPath(root, ["definitions"]);
      const node = { id: operation.node.id, type: operation.node.type, props: {}, style: {}, children: [] };
      const valueText = JSON.stringify(node, null, 2);
      try {
        if (definitions && definitions.kind === "object") {
          const existing = definitions.entries.find((entry) => entry.key === operation.name);
          text = existing
            ? setValue(source.text, existing.value, valueText)
            : insertEntry(source.text, definitions, operation.name, valueText);
        } else {
          const document = findPath(root, []);
          if (!document || document.kind !== "object") throw new Error("The document cannot be edited.");
          text = insertEntry(source.text, document, "definitions", JSON.stringify({ [operation.name]: node }, null, 2));
        }
      } catch (error) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_DRAFT_PARSE",
          source: path,
          message: error instanceof Error ? error.message : "The document cannot be edited.",
        });
        return undefined;
      }
      summary = `uidlAddDefinition ${operation.name}`;
    } else {
      const found = findTreeNode(source.text, tree, operation.node);
      if (!found) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_OPERATION_TARGET",
          source: path,
          message: `The document has no node called '${operation.node}'.`,
        });
        return undefined;
      }
      const definitions = findPath(root, ["definitions"]);
      const hasDefinition =
        definitions && definitions.kind === "object" && definitions.entries.some((entry) => entry.key === operation.definition);
      if (!hasDefinition) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_OPERATION_TARGET",
          source: path,
          message: `The document has no definition called '${operation.definition}'.`,
        });
        return undefined;
      }
      if (found.node.kind !== "object") {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_OPERATION_TARGET",
          source: path,
          message: `The node '${operation.node}' cannot be changed.`,
        });
        return undefined;
      }
      const existing = found.node.entries.find((entry) => entry.key === "componentId");
      try {
        text = existing
          ? setValue(source.text, existing.value, JSON.stringify(operation.definition))
          : insertEntry(source.text, found.node, "componentId", JSON.stringify(operation.definition));
      } catch (error) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_DRAFT_PARSE",
          source: path,
          message: error instanceof Error ? error.message : "The document cannot be edited.",
        });
        return undefined;
      }
      summary = `uidlUseDefinition ${operation.node}`;
    }
  } else if (operation.op === "uidlSetNodeStyle" || operation.op === "uidlSetNodeResponsive") {
    const found = findTreeNode(source.text, tree, operation.node);
    if (!found || found.node.kind !== "object") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.node}'.`,
      });
      return undefined;
    }
    const field = operation.op === "uidlSetNodeStyle" ? operation.field : operation.field;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `'${field}' is not a field a node can carry.`,
      });
      return undefined;
    }
    const valueText = JSON.stringify(operation.value, null, 2);
    try {
      if (operation.op === "uidlSetNodeStyle") {
        const style = found.node.entries.find((entry) => entry.key === "style");
        const existing = style && style.value.kind === "object" ? style.value.entries.find((entry) => entry.key === field) : undefined;
        if (existing) {
          text = setValue(source.text, existing.value, valueText);
        } else if (style && style.value.kind === "object") {
          text = insertEntry(source.text, style.value, field, valueText);
        } else {
          // A node that carries no style yet gets one. The value is what was asked for,
          // and the rest of the node is untouched.
          text = insertEntry(source.text, found.node, "style", JSON.stringify({ [field]: operation.value }, null, 2));
        }
        summary = `uidlSetNodeStyle ${operation.node}.${field}`;
      } else {
        const responsive = found.node.entries.find((entry) => entry.key === "responsive");
        const fieldEntry =
          responsive && responsive.value.kind === "object"
            ? responsive.value.entries.find((entry) => entry.key === field)
            : undefined;
        if (!fieldEntry) {
          // A node with no responsive value for this field gets one. The values it
          // already has for other fields are kept.
          if (responsive && responsive.value.kind === "object") {
            text = insertEntry(
              source.text,
              responsive.value,
              field,
              JSON.stringify({ [operation.breakpoint]: operation.value }, null, 2),
            );
          } else {
            text = insertEntry(
              source.text,
              found.node,
              "responsive",
              JSON.stringify({ [field]: { [operation.breakpoint]: operation.value } }, null, 2),
            );
          }
          summary = `uidlSetNodeResponsive ${operation.node}.${field}.${operation.breakpoint}`;
          return text;
        }
        if (fieldEntry.value.kind !== "object") {
          diagnostics.push({
            severity: "error",
            code: "STUDIO_OPERATION_TARGET",
            source: path,
            message: `The responsive value for '${field}' is not a set of breakpoints.`,
          });
          return undefined;
        }
        const breakpointEntry = fieldEntry.value.entries.find((entry) => entry.key === operation.breakpoint);
        text = breakpointEntry
          ? setValue(source.text, breakpointEntry.value, valueText)
          : insertEntry(source.text, fieldEntry.value, operation.breakpoint, valueText);
        summary = `uidlSetNodeResponsive ${operation.node}.${field}.${operation.breakpoint}`;
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
  } else if (operation.op === "uidlCopyNode") {
    const found = findTreeNode(source.text, tree, operation.node);
    if (!found) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.node}'.`,
      });
      return undefined;
    }
    const parent = findTreeNode(source.text, tree, operation.parent);
    if (!parent) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.parent}'.`,
      });
      return undefined;
    }
    const children = parent.children ?? findPath(parent.node, ["children"]);
    if (!children || children.kind !== "array") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The node '${operation.parent}' cannot take a child.`,
      });
      return undefined;
    }
    // A copy is new content, so its identifiers are remapped. The original is untouched.
    let copy: unknown;
    try {
      copy = JSON.parse(source.text.slice(found.node.start, found.node.end));
    } catch {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: "The node cannot be copied.",
      });
      return undefined;
    }
    const remapped = remapIdentifiers(copy, operation.node);
    const index = Math.max(0, Math.min(operation.index, children.items.length));
    try {
      text = insertArrayItemAt(source.text, children, index, JSON.stringify(remapped, null, 2));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
    summary = `uidlCopyNode ${operation.node}`;
  } else if (operation.op === "uidlAddNode") {
    if (findTreeNode(source.text, tree, operation.node.id)) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document already has a node called '${operation.node.id}'.`,
      });
      return undefined;
    }
    const parent = findTreeNode(source.text, tree, operation.parent);
    if (!parent) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.parent}'.`,
      });
      return undefined;
    }
    const children = parent.children ?? findPath(parent.node, ["children"]);
    if (!children || children.kind !== "array") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The node '${operation.parent}' cannot take a child.`,
      });
      return undefined;
    }
    const node = { id: operation.node.id, type: operation.node.type, props: {}, style: {}, children: [] };
    try {
      text = insertArrayItem(source.text, children, JSON.stringify(node, null, 2));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
    summary = `uidlAddNode ${operation.node.id}`;
  } else {
    const found = findTreeNode(source.text, tree, operation.node);
    if (!found || found.children === undefined || found.index === undefined) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        message: `The document has no node called '${operation.node}'.`,
      });
      return undefined;
    }
    try {
      text = removeArrayItem(source.text, found.children, found.index);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The document cannot be edited.",
      });
      return undefined;
    }
    summary = `uidlRemoveNode ${operation.node}`;
  }

  // The edited document has to still be a document. The runtime's own rules are checked
  // when the document is inspected; this is the cheap gate that keeps a broken edit
  // from ever reaching the author.
  if (!uidlDocument(text)) {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_UIDL_INVALID",
      source: path,
      message: `${summary} is refused: the edited document is not a UIDL document.`,
    });
    return undefined;
  }
  return text;
}

/**
 * Apply one journey operation to a journey source.
 *
 * The edit is source-preserving: the journey file keeps every byte the author wrote,
 * and only the step or the link changes. The result is checked against the journey
 * contract before it is returned, so an edit that would break the journey is refused
 * and the file is left as it was.
 */
function applyJourneyOperation(
  path: string,
  source: SourceText,
  operation: JourneyDraftOperation,
  diagnostics: StudioDiagnostic[],
): string | undefined {
  if (source.format !== "json") {
    diagnostics.push({
      severity: "error",
      code: "STUDIO_WRITE_UNSUPPORTED",
      source: path,
      message: "Only JSON sources accept visual writes in this version.",
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
      source: path,
      message: error instanceof Error ? error.message : "The source is not valid JSON.",
    });
    return undefined;
  }

  let text: string;
  let summary: string;
  if (operation.op === "journeyAddStep" || operation.op === "journeyAddLink") {
    const key = operation.op === "journeyAddStep" ? "steps" : "links";
    const array = findPath(root, [key]);
    if (!array || array.kind !== "array") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        path: `/${key}`,
        message: `The journey has no '${key}' to change.`,
      });
      return undefined;
    }
    const value = operation.op === "journeyAddStep" ? operation.step : operation.link;
    const id = "id" in value ? value.id : "";
    if (
      array.items.some(
        (item) =>
          item.kind === "object" &&
          item.entries.some((entry) => entry.key === "id" && stringValue(source.text, entry.value) === id),
      )
    ) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        path: `/${key}`,
        message: `The journey already has an entry called '${id}'.`,
      });
      return undefined;
    }
    try {
      text = insertArrayItem(source.text, array, JSON.stringify(value, null, 2));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The journey cannot be edited.",
      });
      return undefined;
    }
    summary = `${operation.op} ${id}`;
  } else {
    const key = operation.op === "journeyRemoveStep" ? "steps" : "links";
    const id = operation.op === "journeyRemoveStep" ? operation.step : operation.link;
    const array = findPath(root, [key]);
    if (!array || array.kind !== "array") {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        path: `/${key}`,
        message: `The journey has no '${key}' to change.`,
      });
      return undefined;
    }
    const index = array.items.findIndex(
      (item) =>
        item.kind === "object" &&
        item.entries.some((entry) => entry.key === "id" && stringValue(source.text, entry.value) === id),
    );
    if (index < 0) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_OPERATION_TARGET",
        source: path,
        path: `/${key}`,
        message: `The journey has no entry called '${id}'.`,
      });
      return undefined;
    }
    try {
      text = removeArrayItem(source.text, array, index);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_DRAFT_PARSE",
        source: path,
        message: error instanceof Error ? error.message : "The journey cannot be edited.",
      });
      return undefined;
    }
    summary = `${operation.op} ${id}`;
  }

  // The edited journey has to still be a journey. An edit that breaks it is refused,
  // and the file keeps the bytes the author wrote.
  const parsed = parseJourney(JSON.parse(text));
  if (!parsed.ok) {
    for (const item of parsed.diagnostics) {
      diagnostics.push({ ...item, source: path, message: `${summary} is refused: ${item.message}` });
    }
    return undefined;
  }
  const internal = journeyInternalErrors(parsed.journey!);
  if (internal.length) {
    for (const message of internal) {
      diagnostics.push({
        severity: "error",
        code: "STUDIO_JOURNEY_INVALID",
        source: path,
        message: `${summary} is refused: ${message}`,
      });
    }
    return undefined;
  }
  return text;
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
  const editedPaths = new Set<string>();

  for (const operation of request.operations) {
    if (operation.op.startsWith("uidl")) {
      const uidlOperation = operation as Extract<DraftOperation, { op: `uidl${string}` }>;
      const target = sources[uidlOperation.source];
      if (!target) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_OPERATION_TARGET",
          source: uidlOperation.source,
          message: `The file '${uidlOperation.source}' is not part of this project.`,
        });
        continue;
      }
      const edited = applyUidlOperation(uidlOperation.source, target, uidlOperation, diagnostics, options.catalog);
      if (edited) {
        sources[uidlOperation.source] = { format: "json", text: edited };
        editedPaths.add(uidlOperation.source);
        applied.push(`${uidlOperation.op} ${uidlOperation.source}`);
      }
      continue;
    }
    if (operation.op.startsWith("journey")) {
      const journeyOperation = operation as JourneyDraftOperation;
      const journey = journeyOperation.journey;
      const journeySource = sources[journey];
      if (!journeySource) {
        diagnostics.push({
          severity: "error",
          code: "STUDIO_OPERATION_TARGET",
          source: journey,
          message: `The journey file '${journey}' is not part of this project.`,
        });
        continue;
      }
      const edited = applyJourneyOperation(journey, journeySource, journeyOperation, diagnostics);
      if (edited) {
        sources[journey] = { format: "json", text: edited };
        editedPaths.add(journey);
        applied.push(`${journeyOperation.op} ${journey}`);
      }
      continue;
    }
    const source = sources[snapshot.entry]!;
    if (operation.op === "setTransition") {
      const editedText = applyTransition(
        snapshot.entry,
        source,
        operation.entity,
        operation.transition,
        operation.from,
        operation.to,
        operation.roles,
        operation.when,
        diagnostics,
      );
      if (editedText) {
        sources[snapshot.entry] = { format: "json", text: editedText };
        edited.add(snapshot.entry);
        applied.push(`setTransition ${operation.entity}.${operation.transition}`);
      }
      continue;
    }
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
