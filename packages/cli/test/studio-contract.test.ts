import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { compile } from "@kerangka/compiler";
import { Engine } from "@kerangka/engine-ts";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const valid = readJson("./fixtures/studio/source-bundle.valid.json");
const schema = readJson("../../../spec/studio/source-bundle.schema.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

describe("Studio source-bundle contract", () => {
  it("publishes an offline JSON Schema 2020-12 contract", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://kerangka.dev/schema/studio/v0.1/source-bundle.schema.json");
  });

  it("accepts the complete recipe/authored fixture without changing raw text", () => {
    const before = structuredClone(valid);
    expect(validate(valid), ajv.errorsText(validate.errors)).toBe(true);
    expect(valid).toEqual(before);
    expect(compile(valid.sources[valid.entry].text).app).toBe("studio-probe");
  });

  it("rejects the invalid fixture", () => {
    expect(validate(readJson("./fixtures/studio/source-bundle.invalid.json"))).toBe(false);
  });

  it.each([
    ["unknown version", { ...valid, version: "0.2" }],
    ["missing revision", { ...valid, revision: undefined }],
    ["empty revision", { ...valid, revision: "" }],
    ["unknown root fields", { ...valid, secrets: {} }],
    ["compiled KIR instead of source", { ...valid, kind: "kerangka.kir" }],
    ["empty sources", { ...valid, sources: {} }],
    ["parsed source instead of raw text", { ...valid, sources: { "app.json": { format: "json", text: {} } } }],
    ["executable source format", { ...valid, sources: { "app.json": { format: "javascript", text: "" } } }],
    ["ambiguous page ownership", { ...valid, application: { ...valid.application, pages: { requests: { mode: "recipe", view: "requests", source: "pages/help.uidl.json" } } } }],
    ["authored page missing source", { ...valid, application: { ...valid.application, pages: { help: { mode: "authored" } } } }],
    ["permission grants in route metadata", { ...valid, application: { ...valid.application, routes: [{ id: "requests", path: "/requests", page: "requests", access: "admin" }] } }],
    ["writable preview", { ...valid, application: { ...valid.application, preview: { profile: "write", data: "synthetic" } } }],
    ["production preview data", { ...valid, application: { ...valid.application, preview: { profile: "read", data: "production" } } }]
  ])("rejects %s", (_name, bundle) => {
    expect(validate(bundle)).toBe(false);
  });

  it.each([
    "/tmp/app.json", "../app.json", "model/../app.json", "model//app.json",
    "model\\app.json", "https://example.invalid/app.json", "%2e%2e/app.json",
    ".git/config.json", ".env", "node_modules/app.json", "dist/app.json", "build/app.json"
  ])("rejects unsafe or non-source path %s", (path) => {
    expect(validate({ ...valid, entry: path, sources: { [path]: { format: "json", text: "{}" } } })).toBe(false);
    expect(validate({ ...valid, sources: { ...valid.sources, [path]: { format: "json", text: "{}" } } })).toBe(false);
  });

  it.each(["https://example.invalid", "/requests?role=admin", "/requests#edit", "/../requests", "/requests/", "//requests"])("rejects noncanonical route %s", (path) => {
    expect(validate({ ...valid, application: { ...valid.application, routes: [{ id: "requests", path, page: "requests", access: "session" }] } })).toBe(false);
  });

  it("bounds source count and individual character length", () => {
    expect(validate({ ...valid, sources: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`model-${i}.json`, { format: "json", text: "{}" }])) })).toBe(false);
    expect(validate({ ...valid, sources: { "app.json": { format: "json", text: "x".repeat(524289) } } })).toBe(false);
  });

  it("preserves YAML text without claiming visual-write support", () => {
    const bundle = { ...valid, entry: "app.yaml", sources: { "app.yaml": { format: "yaml", text: "# Keep this comment\nkerangka: '0.1'\napp: yaml-probe\n" } } };
    const before = structuredClone(bundle);
    expect(validate(bundle)).toBe(true);
    expect(bundle).toEqual(before);
  });

  it("accepts a parameterized route and separate editor positions", () => {
    const bundle = { ...valid, editor: { positions: { "model:/entities/Request": { x: 20, y: -10 } } }, application: { ...valid.application, routes: [{ id: "request", path: "/requests/:id", page: "requests", access: "session" }] } };
    expect(validate(bundle), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("does not confuse structural acceptance with resolved references or valid source", () => {
    expect(validate({ ...valid, entry: "missing.json" })).toBe(true);
    expect(validate({ ...valid, sources: { "app.json": { format: "json", text: "unfinished draft" } } })).toBe(true);
  });
});

describe("Studio approval acceptance model (pure-engine proof only)", () => {
  const engine = () => new Engine(compile(readJson("./fixtures/studio/approval.kerangka.json")));
  const draft = { id: "request-1", employeeId: "employee-1", title: "Synthetic leave", days: 2, status: "draft" };
  const employee = { id: "employee-1", roles: ["employee"] };
  const manager = { id: "manager-1", roles: ["manager"] };
  const options = { now: "2026-10-16T09:00:00Z" };

  it("lets an employee submit and a different manager approve", () => {
    const runtime = engine();
    const submitted = runtime.run("Request.submit", draft, {}, employee, options);
    expect(submitted.ok).toBe(true);
    expect(submitted.record?.status).toBe("submitted");
    const approved = runtime.run("Request.approve", submitted.record, {}, manager, options);
    expect(approved.ok).toBe(true);
    expect(approved.record?.status).toBe("approved");
    expect(approved.effects).toEqual(expect.arrayContaining([expect.objectContaining({ type: "persist", entity: "Request" })]));
    expect(approved.effects?.every((effect) => effect.type === "persist")).toBe(true);
  });

  it("denies approval to an employee and to an anonymous actor", () => {
    const runtime = engine();
    for (const actor of [employee, { roles: [] }]) {
      expect(runtime.run("Request.approve", { ...draft, status: "submitted" }, {}, actor, options)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    }
  });

  it("denies self-approval even when the actor also has the manager role", () => {
    expect(engine().run("Request.approve", { ...draft, status: "submitted" }, {}, { id: employee.id, roles: ["employee", "manager"] }, options)).toMatchObject({ ok: false, code: "GUARD_FAILED" });
  });

  it("denies submitting another employee's request and an invalid state transition", () => {
    const runtime = engine();
    expect(runtime.run("Request.submit", draft, {}, { id: "employee-2", roles: ["employee"] }, options)).toMatchObject({ ok: false, code: "GUARD_FAILED" });
    expect(runtime.run("Request.approve", draft, {}, manager, options)).toMatchObject({ ok: false, code: "INVALID_STATE_TRANSITION" });
  });

  it("closes generic updates and deletes so they cannot bypass transition controls", () => {
    const runtime = engine();
    for (const actor of [employee, manager]) {
      expect(runtime.canOperate("Request", "update", actor, draft).allowed).toBe(false);
      expect(runtime.canOperate("Request", "delete", actor, draft).allowed).toBe(false);
    }
    expect(runtime.validate("Request", { ...draft, title: " ", days: 0 }).valid).toBe(false);
  });

  it("permits creation only as the employee's own draft", () => {
    const runtime = engine();
    expect(runtime.canOperate("Request", "create", employee, draft).allowed).toBe(true);
    expect(runtime.canOperate("Request", "create", employee, { ...draft, status: "approved" }).allowed).toBe(false);
    expect(runtime.canOperate("Request", "create", employee, { ...draft, employeeId: "employee-2" }).allowed).toBe(false);
  });
});
