/**
 * Structural mirror of the UIDL-Runtime 1.x contract (uidl.dev).
 *
 * The compiler cannot depend on ajv or reach a network, and CI runs without the UIDL-Runtime
 * checkout, so these checks re-assert the schema invariants the projection promises in
 * `src/projections/uidl.ts`: a document that satisfies them wraps cleanly around the UIDL-Runtime
 * validator without modification.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, generateUIDL } from "../src/index.js";
import type { UIDLDocument, UIDLNode } from "../src/projections/uidl.js";

const kir = compile(readFileSync("examples/invoicing.kerangka.json", "utf-8"));

// Canonical component type list, mirrored from UIDL-Runtime packages/core/src/registry/defaults.ts.
const REFERENCE_REGISTRY_TYPES = new Set([
  "Container",
  "Row",
  "Column",
  "Stack",
  "Spacer",
  "Divider",
  "Text",
  "Icon",
  "Image",
  "Button",
  "Badge",
  "TextField",
  "Checkbox",
  "Switch",
  "Slider",
  "Select",
  "Textarea",
  "RadioGroup",
  "Form",
  "ListView",
  "GridView",
  "DataTable",
  "PageBar",
  "Chart",
  "KanbanBoard",
  "TreeView",
  "Sidebar",
  "Navbar",
  "Toolbar",
  "Drawer",
  "Panel",
  "Popover",
  "Dialog",
  "Snackbar",
  "QRCode",
  "Barcode",
  "DataMatrix",
]);

// discriminators /action.schema.json under spec/schema.
const ACTION_DISCRIMINATORS = new Set([
  "navigate",
  "setPath",
  "setState",
  "mutate",
  "query",
  "api",
  "command",
  "download",
  "showSnackbar",
  "showDialog",
  "validate",
  "sequence",
  "if",
]);

const QUERY_OPS = new Set(["eq", "ne", "in", "gt", "gte", "lt", "lte", "like", "between"]);

// binding.schema.json: a `$bind` path opens with a render scope (or `event.` in action payloads)
// and carries at least one segment after the scope.
const RENDER_BIND = /^(local|state|session|route|data)(\.[^.]+)+$/;
// Action payloads resolve against both the action event and the render scopes (e.g. the
// documented `mutate.id: { $bind: "state.params.id" }` form pattern).
const ACTION_BIND = /^(local|state|session|route|data|event)(\.[^.]+)+$/;

function walkNode(node: UIDLNode, problems: string[], where: string): void {
  if (!REFERENCE_REGISTRY_TYPES.has(node.type)) {
    problems.push(`${where} invents component type "${node.type}" not in the reference registry`);
  }

  for (const [prop, value] of Object.entries(node.props ?? {})) {
    walkValue(value, problems, `${where}/${node.id}.props.${prop}`, RENDER_BIND);
  }

  for (const [event, actions] of Object.entries(node.events ?? {})) {
    if (!Array.isArray(actions)) {
      problems.push(`${where}/${node.id}.events.${event} is not an array of actions (runtime skips it)`);
      continue;
    }
    for (const action of actions) {
      walkAction(action, problems, `${where}/${node.id}.events.${event}`);
    }
  }

  for (const child of node.children ?? []) {
    walkNode(child, problems, where);
  }
}

function walkValue(value: unknown, problems: string[], where: string, bind: RegExp): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkValue(value[i], problems, `${where}[${i}]`, bind);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if ("$bind" in value) {
    const path = (value as { $bind: unknown }).$bind;
    if (typeof path !== "string" || !bind.test(path)) {
      problems.push(`${where} binds "${String(path)}", which is not a valid ${bind} path`);
    }
    return;
  }
  if ("$expr" in value) {
    walkValue((value as { $expr: unknown }).$expr, problems, where, bind);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    walkValue(v, problems, `${where}.${k}`, bind);
  }
}

function walkAction(action: unknown, problems: string[], where: string): void {
  if (action === null || typeof action !== "object" || Array.isArray(action)) {
    problems.push(`${where} action is not an object`);
    return;
  }
  const keys = Object.keys(action as Record<string, unknown>);
  if (keys.length === 0 || keys.some((k) => !ACTION_DISCRIMINATORS.has(k))) {
    problems.push(`${where} action uses unknown discriminator(s): ${keys.join(", ")}`);
  }
  walkValue(action, problems, where, ACTION_BIND);
}

function checkQuery(ds: unknown, problems: string[], where: string): void {
  if (ds === null || typeof ds !== "object") {
    problems.push(`${where} is not an object`);
    return;
  }
  const q = (ds as Record<string, unknown>)["$query"];
  if (q === null || typeof q !== "object") {
    problems.push(`${where} has no $query descriptor`);
    return;
  }
  const query = q as Record<string, unknown>;
  if ("id" in query) problems.push(`${where}.$query carries a forbidden "id" key`);

  const allowed = new Set(["collection", "fields", "filters", "sort", "page", "search"]);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) problems.push(`${where}.$query invents key "${key}"`);
  }
  if (typeof query.collection !== "string") problems.push(`${where}.$query.collection must be a string`);

  if ("filters" in query && !Array.isArray(query.filters)) {
    problems.push(`${where}.$query.filters must be an array`);
  }
  for (const f of Array.isArray(query.filters) ? query.filters : []) {
    const filter = f as Record<string, unknown>;
    if (typeof filter.field !== "string") problems.push(`${where}.$query filter lacks a string field`);
    if (typeof filter.op !== "string" || !QUERY_OPS.has(filter.op)) {
      problems.push(`${where}.$query filter op "${String(filter.op)}" is not in the query op set`);
    }
  }
  if ("sort" in query && !Array.isArray(query.sort)) {
    problems.push(`${where}.$query.sort must be an array`);
  }
  if ("page" in query) {
    const page = query.page as Record<string, unknown>;
    if (typeof page !== "object" || !("number" in page) || !("size" in page)) {
      problems.push(`${where}.$query.page must be { number, size }`);
    }
  }
}

function walkDocument(doc: UIDLDocument, problems: string[], where: string): void {
  if (typeof doc.id !== "string" || doc.id.length === 0) problems.push(`${where} has no id`);
  if (typeof doc.name !== "string" || doc.name.length === 0) problems.push(`${where} has no name`);
  if (typeof doc.route !== "string" || !/^\//.test(doc.route)) {
    problems.push(`${where}.route ("${String(doc.route)}") does not start with "/"`);
  }

  for (const [name, ds] of Object.entries(doc.dataSources ?? {})) {
    checkQuery(ds, problems, `${where}.dataSources.${name}`);
  }
  walkNode(doc.root, problems, where);
}

describe("UIDL Conformance (mirror of UIDL-Runtime schema)", () => {
  const docs = generateUIDL(kir);

  it("emits only registered component types and valid bind/action/query shapes throughout", () => {
    expect(Object.keys(docs).length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const [key, doc] of Object.entries(docs)) {
      expect(doc.version).toBe("1.0.0");
      expect(doc.$schema).toBe("https://uidl.dev/schema/v1/document.schema.json");
      expect(doc.id).toBe(key);
      walkDocument(doc, problems, key);
    }
    expect(problems).toEqual([]);
  });

  it("decorates every document with a Navbar that only targets sibling documents", () => {
    for (const [key, doc] of Object.entries(docs)) {
      const navbar = doc.root.children?.find((c) => c.type === "Navbar");
      expect(navbar, `${key} has no Navbar`).toBeDefined();
      for (const child of navbar?.children ?? []) {
        if (child.type !== "Button") continue;
        const events = (child.events ?? {}) as Record<string, any[]>;
        const route = events.onClick?.[0]?.navigate?.route as unknown;
        expect(typeof route, `${key}: nav "route" must be a plain string`).toBe("string");
        expect(route as string, `${key} nav target must exist`).not.toContain(":id");
      }
    }
  });
});