import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentSchema } from "uidl-runtime";
import { compile } from "@kerangka/compiler";
import { RecipeProjector, ScreenNotFoundError, fieldMeta, type Screen } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const invoicing = compile(fs.readFileSync(path.resolve(here, "../../../examples/invoicing.kerangka.json"), "utf8"));

type Node = { id: string; type: string; props?: Record<string, unknown>; events?: Record<string, unknown[]>; children?: Node[]; visibility?: unknown };

function find(node: Node, predicate: (n: Node) => boolean): Node | undefined {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return undefined;
}

const root = (screen: Screen) => screen.root as unknown as Node;
const json = (value: unknown) => JSON.stringify(value);

describe("RecipeProjector.views", () => {
  it("lists declared list and form views, then scaffolds, and leaves dashboards to the generator", () => {
    expect(new RecipeProjector(invoicing).views()).toEqual([
      { id: "invoices", kind: "list", entity: "Invoice", route: "/invoices" },
      { id: "invoice", kind: "form", entity: "Invoice", route: "/invoice/:id" },
      { id: "customer-list", kind: "list", entity: "Customer", route: "/customer-list" },
      { id: "customer-form", kind: "form", entity: "Customer", route: "/customer-form/:id" },
    ]);
  });
});

describe("RecipeProjector.list", () => {
  const screen = new RecipeProjector(invoicing).list("invoices");

  it("reads the entity through a $query and keeps the declared top-level columns", () => {
    expect(screen.id).toBe("invoices");
    expect(screen.route).toBe("/invoices");
    expect(json(screen.dataSources)).toContain('"collection":"Invoice"');
    // `customer.name` is a relation column the bridge flattens; the recipe lists stored fields.
    expect(json(screen)).toContain('"number"');
    expect(json(screen)).not.toContain('"customer.name"');
  });

  it("opens a row at the route the bridge decorated it with, and creates through the form view", () => {
    expect(json(screen)).toContain('{"navigate":{"route":{"$bind":"event.route"}}}');
    expect(json(screen)).toContain('{"navigate":{"route":"/invoice/new"}}');
  });

  it("sits in the shell the model's navigation describes, with its own item marked", () => {
    const nav = find(root(screen), (n) => n.id.endsWith("-nav-invoices"));
    expect(nav?.props).toMatchObject({ variant: "primary", "aria-current": "page" });
    expect(find(root(screen), (n) => n.id.endsWith("-nav-home"))?.events?.onClick).toEqual([{ navigate: { route: "/" } }]);
  });
});

describe("RecipeProjector.form", () => {
  const projector = new RecipeProjector(invoicing);

  it("edits the given record with its version, and offers the workflow from its state", () => {
    const screen = projector.form("invoice", { id: "INV-1", data: { number: "INV-1", status: "draft" }, version: 3 });
    expect(screen.id).toBe("invoice-INV-1");
    expect(screen.route).toBe("/invoice/INV-1");
    expect(screen.state).toMatchObject({ id: "INV-1", number: "INV-1", status: "draft", _meta: { version: 3 } });

    const send = find(root(screen), (n) => n.id === "transition-send");
    expect(send?.events?.onClick).toEqual([
      expect.objectContaining({ mutate: expect.objectContaining({ operation: "transition", collection: "Invoice", transition: "send" }) }),
    ]);
    expect(json(send?.visibility)).toContain('"draft"');
  });

  it("creates without a record: no workflow buttons, and no expression shown as a default", () => {
    const screen = projector.form("invoice");
    expect(screen.id).toBe("invoice-new");
    expect(find(root(screen), (n) => n.id.startsWith("transition-"))).toBeUndefined();
    // `issuedOn` defaults to today(), which the engine evaluates on create.
    expect(screen.state?.issuedOn).toBe("");
  });

  it("turns an action without input into a button and leaves one that needs input out", () => {
    const kir = compile({
      kerangka: "0.1",
      app: "tasks",
      entities: {
        Task: {
          fields: { title: "string!", done: "bool = false" },
          actions: {
            complete: { when: "!done", run: { done: true } },
            rename: { input: { title: "string!" }, run: { title: "input.title" } },
          },
        },
      },
    } as never);
    const screen = new RecipeProjector(kir).form("task-form", { id: "t-1", data: { title: "x", done: false } });
    expect(find(root(screen), (n) => n.id === "action-complete")?.events?.onClick).toEqual([
      expect.objectContaining({ mutate: expect.objectContaining({ transition: "complete", collection: "Task" }) }),
    ]);
    expect(find(root(screen), (n) => n.id === "action-rename")).toBeUndefined();
  });

  it("refuses a screen the model does not have, or one of the other kind", () => {
    expect(() => projector.form("nope")).toThrow(ScreenNotFoundError);
    expect(() => projector.form("invoices")).toThrow(/is a list, not a form/);
    expect(() => projector.list("invoice")).toThrow(/is a form, not a list/);
  });
});

describe("every projected screen", () => {
  it("is a valid UIDL document with unique node ids", () => {
    const projector = new RecipeProjector(invoicing);
    const screens = [
      ...projector.views().filter((v) => v.kind === "list").map((v) => projector.list(v.id)),
      ...projector.views().filter((v) => v.kind === "form").flatMap((v) => [projector.form(v.id), projector.form(v.id, { id: "x-1", data: {} })]),
    ];
    for (const screen of screens) {
      expect(DocumentSchema.safeParse(screen).success, screen.id).toBe(true);
      const ids: string[] = [];
      const walk = (n: Node) => { ids.push(n.id); n.children?.forEach(walk); };
      walk(root(screen));
      expect(new Set(ids).size, screen.id).toBe(ids.length);
    }
  });
});

describe("fieldMeta", () => {
  const f = (type: string, extra: Record<string, unknown> = {}) => fieldMeta("amountDue", { type, required: false, ...extra } as never);

  it("maps each Kerangka type to a widget", () => {
    expect(f("string")?.widget).toBe("TextField");
    expect(f("text")?.widget).toBe("Textarea");
    expect(f("bool")?.widget).toBe("Checkbox");
    expect(f("decimal")?.widget).toBe("Currency");
    expect(f("date")?.widget).toBe("Date");
    expect(f("enum", { values: ["draft", "sent"] })).toMatchObject({ widget: "Select", options: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }] });
    expect(f("ref", { target: "Customer" })).toMatchObject({ widget: "Link", options: { doctype: "Customer" } });
    expect(f("list")).toBeUndefined();
  });

  it("labels from the name, marks computed fields read-only, and keeps only literal defaults", () => {
    expect(f("string")?.label).toEqual({ id: "Amount Due", en: "Amount Due" });
    expect(f("decimal", { compute: { $expr: "+" } })?.readOnly).toBe(true);
    expect(f("enum", { values: ["a"], default: "a" })?.default).toBe("a");
    expect(f("date", { default: "today()" })).not.toHaveProperty("default");
    expect(f("string", { default: "actor.id" })).not.toHaveProperty("default");
  });
});
