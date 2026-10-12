/**
 * Template Instances in a Model Document
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * A template from a package (PLAN.md §7.5) stands in a document as an instance:
 *
 *     "workflow": { "use": "std:approval", "with": { "submitter": "employee", "approver": "manager" } }
 *
 * at an entity's `workflow`, at one entry of an entity's `actions`, or at one entry of `views`.
 * The compiler replaces each instance with its expansion before anything reads the document,
 * so the IR never holds a template (ADR-0011) and every later stage sees an ordinary model.
 *
 * Keys written beside `use` are merged into the expansion one level deep: a transition the
 * template does not define can be added, but a key or entry defined by both is an error. A
 * template is never overridden silently, for the same reason a trait is not.
 */

import { expandTemplate, TEMPLATE_KINDS, type StdTemplate, type TemplateKind } from "@kerangka/std";
import { pointer, suggestion } from "./diagnostics.js";
import { TEMPLATE_INSTANCE_KEYS } from "./meta-schema.js";
import type { RawKerangkaDocument } from "./types.js";

export interface TemplateDiagnostic {
  code: string;
  message: string;
  path: string;
  hint?: string;
}

/** Where an instance stood, and which template replaced it. */
export interface ExpandedInstance {
  path: string;
  template: string;
}

export interface DocumentExpansion {
  /** A copy of the document with every instance replaced; the input is never mutated. */
  document: RawKerangkaDocument;
  instances: ExpandedInstance[];
  diagnostics: TemplateDiagnostic[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An object standing where a declaration goes, naming a template with `use`. */
export function isTemplateInstance(value: unknown): value is Record<string, unknown> & { use: unknown } {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, "use");
}

const KIND_POSITIONS: Record<TemplateKind, string> = {
  workflow: "an entity's 'workflow'",
  action: "an entry of an entity's 'actions'",
  view: "an entry of 'views'",
};

/** Replace every template instance in the document with its expansion. */
export function expandDocumentTemplates(
  doc: RawKerangkaDocument,
  templates: Record<string, StdTemplate>
): DocumentExpansion {
  const diagnostics: TemplateDiagnostic[] = [];
  const instances: ExpandedInstance[] = [];

  const expand = (instance: Record<string, unknown>, kind: TemplateKind, at: string) => {
    const result = expandInstance(instance, kind, at, templates, diagnostics);
    if (result) instances.push({ path: at, template: String(instance.use) });
    return result;
  };

  let entities = doc.entities;
  if (isPlainObject(doc.entities)) {
    const copy: Record<string, unknown> = {};
    for (const [entityName, entity] of Object.entries(doc.entities)) {
      copy[entityName] = isPlainObject(entity) ? expandEntity(entityName, entity, expand) : entity;
    }
    entities = copy as RawKerangkaDocument["entities"];
  }

  let views = doc.views;
  if (isPlainObject(doc.views)) {
    const copy: Record<string, unknown> = {};
    for (const [viewName, view] of Object.entries(doc.views)) {
      if (!isTemplateInstance(view)) {
        copy[viewName] = view;
        continue;
      }
      const expanded = expand(view, "view", pointer("views", viewName));
      if (expanded) copy[viewName] = expanded;
    }
    views = copy as RawKerangkaDocument["views"];
  }

  return {
    document: {
      ...doc,
      ...(entities !== undefined ? { entities } : {}),
      ...(views !== undefined ? { views } : {}),
    },
    instances,
    diagnostics,
  };
}

function expandEntity(
  entityName: string,
  entity: Record<string, unknown>,
  expand: (instance: Record<string, unknown>, kind: TemplateKind, at: string) => Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entity };

  if (isTemplateInstance(entity.workflow)) {
    const expanded = expand(entity.workflow, "workflow", pointer("entities", entityName, "workflow"));
    if (expanded) out.workflow = expanded;
    else delete out.workflow;
  }

  if (isPlainObject(entity.actions)) {
    const actions: Record<string, unknown> = {};
    for (const [actionName, action] of Object.entries(entity.actions)) {
      if (!isTemplateInstance(action)) {
        actions[actionName] = action;
        continue;
      }
      const expanded = expand(action, "action", pointer("entities", entityName, "actions", actionName));
      if (expanded) actions[actionName] = expanded;
    }
    out.actions = actions;
  }

  return out;
}

/**
 * Expand one instance, or report why it cannot be expanded and return nothing.
 * A failed instance is dropped rather than left in place, so nothing downstream reads it.
 */
function expandInstance(
  instance: Record<string, unknown>,
  kind: TemplateKind,
  at: string,
  templates: Record<string, StdTemplate>,
  diagnostics: TemplateDiagnostic[]
): Record<string, unknown> | undefined {
  const name = instance.use;
  if (typeof name !== "string" || name.length === 0) {
    diagnostics.push({
      code: "TEMPLATE_INVALID",
      message: `'use' must name a template, not ${JSON.stringify(name)}.`,
      path: `${at}/use`,
      hint: 'Write "use": "std:approval".',
    });
    return undefined;
  }

  const args = instance.with ?? {};
  if (!isPlainObject(args)) {
    diagnostics.push({
      code: "SCHEMA_INVALID",
      message: `'with' must be an object of template arguments, not ${JSON.stringify(args)?.slice(0, 40)}.`,
      path: `${at}/with`,
      hint: 'Write "with": { "parameter": "value" }.',
    });
    return undefined;
  }

  const template = templates[name] as Record<string, unknown> | undefined;
  if (!template) {
    diagnostics.push({
      code: "TEMPLATE_UNKNOWN",
      message: `Template '${name}' is not defined by any package this document uses.`,
      path: `${at}/use`,
      hint: suggestion(name, Object.keys(templates).filter((key) => key.includes(":")), "templates"),
    });
    return undefined;
  }

  const templateKind = template.type;
  if (!(TEMPLATE_KINDS as readonly unknown[]).includes(templateKind)) {
    diagnostics.push({
      code: "TEMPLATE_INVALID",
      message: `Template '${name}' declares type ${JSON.stringify(templateKind)}; a template is a ${TEMPLATE_KINDS.join(", a ")}.`,
      path: `${at}/use`,
      hint: "Fix the template's 'type' in its package.",
    });
    return undefined;
  }
  if (templateKind !== kind) {
    diagnostics.push({
      code: "TEMPLATE_KIND_MISMATCH",
      message: `Template '${name}' is a ${String(templateKind)} template and cannot stand at ${KIND_POSITIONS[kind]}.`,
      path: `${at}/use`,
      hint: `Use it at ${KIND_POSITIONS[templateKind as TemplateKind]}.`,
    });
    return undefined;
  }

  const expansion = expandTemplate(template, args, name);
  for (const problem of expansion.problems) {
    diagnostics.push({
      code: problem.code,
      message: problem.message,
      path: `${at}${problem.path}`,
      ...(problem.hint ? { hint: problem.hint } : {}),
    });
  }
  if (!expansion.value) return undefined;

  return mergeLocalKeys(expansion.value, instance, name, at, diagnostics);
}

/** Merge the keys written beside `use` into the expansion; a collision is an error. */
function mergeLocalKeys(
  expanded: Record<string, unknown>,
  instance: Record<string, unknown>,
  name: string,
  at: string,
  diagnostics: TemplateDiagnostic[]
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...expanded };
  let conflicted = false;
  const conflict = (path: string, label: string) => {
    conflicted = true;
    diagnostics.push({
      code: "TEMPLATE_KEY_CONFLICT",
      message: `'${label}' is defined by template '${name}' and again beside 'use'; a template is never overridden silently.`,
      path,
      hint: "Remove or rename the local definition, or write the declaration out in full ('kerangka expand' prints the expansion).",
    });
  };

  for (const [key, value] of Object.entries(instance)) {
    if ((TEMPLATE_INSTANCE_KEYS as readonly string[]).includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = value;
      continue;
    }
    const base = out[key];
    if (!isPlainObject(base) || !isPlainObject(value)) {
      conflict(`${at}${pointer(key)}`, key);
      continue;
    }
    const merged: Record<string, unknown> = { ...base };
    for (const [entry, entryValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(merged, entry)) {
        conflict(`${at}${pointer(key, entry)}`, `${key}.${entry}`);
        continue;
      }
      merged[entry] = entryValue;
    }
    out[key] = merged;
  }

  return conflicted ? undefined : out;
}
