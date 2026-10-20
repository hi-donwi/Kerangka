import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startStudio, type StudioHost } from "../src/index.js";

// The shared reference model, so the server test and the browser test edit one source.
const fixture = fileURLToPath(new URL("../../cli/test/fixtures/studio/approval.kerangka.json", import.meta.url));
const token = "synthetic-test-capability-01234567890123456789";
const authorization = `Bearer ${token}`;
const entry = "app.kerangka.json";

describe("Studio draft endpoint", () => {
  let root: string;
  let host: StudioHost;
  let model: string;

  const headers = () => ({ authorization, origin: host.origin });
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${host.origin}/studio/api/draft`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  const revision = async (): Promise<string> => {
    const response = await fetch(`${host.origin}/studio/api/project`, { headers: headers() });
    return (await response.json()).bundle.revision as string;
  };
  const onDisk = () => readFile(join(root, entry), "utf8");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kerangka-studio-draft-"));
    model = await readFile(fixture, "utf8");
    await writeFile(join(root, entry), model);
    host = await startStudio({ target: root, port: 0, token });
  });
  afterEach(async () => {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("applies an optional field and returns its impacts without writing to disk", async () => {
    const before = await revision();
    const response = await post({
      expectedRevision: before,
      operations: [{ op: "addEntityField", entity: "Request", field: "note", definition: "string?" }],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toEqual(["addEntityField Request.note"]);
    const text = body.bundle.sources[entry].text as string;
    expect(text).toContain('"note": "string?"');
    expect(text).toContain('"title": "string!"');
    expect(text).toContain('"status": "enum(draft, submitted, approved, rejected) = draft"');
    expect(body.bundle.revision).not.toBe(before);
    const request = body.inspection.entities.find((item: { name: string }) => item.name === "Request");
    expect(request.fields.find((field: { name: string }) => field.name === "note").required).toBe(false);
    expect(body.inspection.outputs.openapi).toContain("note");
    expect(body.inspection.outputs.postgres).toContain("note");
    expect(await onDisk()).toBe(model);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(root);
  });

  it("applies a second field to the unsaved snapshot and a source edit without writing", async () => {
    const before = await revision();
    const first = await post({
      expectedRevision: before,
      operations: [{ op: "addEntityField", entity: "Request", field: "note", definition: "string?" }],
    });
    const preview = await first.json();
    const second = await post({
      expectedRevision: before,
      operations: [{ op: "addEntityField", entity: "Request", field: "extra", definition: "string?" }],
      sources: preview.bundle.sources,
    });
    expect(second.status).toBe(200);
    const stacked = await second.json();
    expect(stacked.applied).toEqual(["addEntityField Request.extra"]);
    expect(stacked.bundle.sources[entry].text).toContain('"note": "string?"');
    expect(stacked.bundle.sources[entry].text).toContain('"extra": "string?"');
    const edited = stacked.bundle.sources[entry].text.replace("Synthetic Request Approval", "Renamed Approval");
    const sourceEdit = await post({
      expectedRevision: before,
      operations: [],
      sources: { ...stacked.bundle.sources, [entry]: { format: "json", text: edited } },
    });
    expect(sourceEdit.status).toBe(200);
    const renamed = await sourceEdit.json();
    expect(renamed.applied).toEqual([`setSource ${entry}`]);
    expect(renamed.inspection.title).toBe("Renamed Approval");
    expect(await onDisk()).toBe(model);
  });

  it("rejects a YAML text change and leaves the file untouched", async () => {
    await writeFile(join(root, "notes.yaml"), "title: keep\n");
    await host.close();
    host = await startStudio({ target: root, port: 0, token });
    const before = await revision();
    const response = await post({
      expectedRevision: before,
      operations: [],
      sources: { "notes.yaml": { format: "yaml", text: "title: changed\n" } },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("STUDIO_WRITE_UNSUPPORTED");
    expect(await readFile(join(root, "notes.yaml"), "utf8")).toBe("title: keep\n");
  });

  it("updates a form recipe and regenerates the preview without writing UIDL", async () => {
    const before = await revision();
    const response = await post({
      expectedRevision: before,
      operations: [{
        op: "setFormSections",
        view: "request",
        sections: [["days"], ["employeeId", "title"]],
        sectionTitles: ["Duration", "Applicant"],
      }],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toEqual(["setFormSections request"]);
    const text = body.bundle.sources[entry].text as string;
    expect(text).toContain('"sectionTitles": ["Duration","Applicant"]');
    expect(text).toContain('"title": "string!"');
    const form = body.inspection.screens.find((item: { label: string }) => item.label === "request");
    expect(form.sections).toEqual([["days"], ["employeeId", "title"]]);
    expect(JSON.stringify(form.document)).toContain("Applicant");
    expect(JSON.stringify(form.document)).not.toContain("help.uidl.json");
    expect(await onDisk()).toBe(model);
  });

  it("rejects a form section that names a missing field", async () => {
    const response = await post({
      expectedRevision: await revision(),
      operations: [{
        op: "setFormSections",
        view: "request",
        sections: [["missing"]],
        sectionTitles: ["Missing"],
      }],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toEqual([]);
    expect(body.diagnostics.some((item: { code: string }) => item.code === "STUDIO_FIELD_MISSING")).toBe(true);
    expect(await onDisk()).toBe(model);
  });

  it("refuses a stale revision and leaves the source untouched", async () => {
    const response = await post({
      expectedRevision: `sha256:${"0".repeat(64)}`,
      operations: [{ op: "addEntityField", entity: "Request", field: "note", definition: "string?" }],
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("STUDIO_REVISION_CONFLICT");
    expect(body.revision).toBe(await revision());
    expect(await onDisk()).toBe(model);
  });

  it("reports a rejected operation as a diagnostic instead of a change", async () => {
    const response = await post({
      expectedRevision: await revision(),
      operations: [{ op: "addEntityField", entity: "Missing", field: "note", definition: "string?" }],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applied).toEqual([]);
    expect(body.diagnostics.some((item: { code: string }) => item.code === "STUDIO_OPERATION_TARGET")).toBe(true);
    expect(body.bundle.sources[entry].text).toBe(model);
    expect(await onDisk()).toBe(model);
  });

  it.each([
    {},
    { expectedRevision: "sha256:x" },
    { expectedRevision: "x", operations: [] },
    { expectedRevision: "x", operations: [{ op: "deleteEntity", entity: "Request", field: "note", definition: "string" }] },
    { expectedRevision: "x", operations: [{ op: "addEntityField", entity: "Request", field: "note", definition: [1] }] },
  ])("rejects a malformed draft request %#", async (payload) => {
    const response = await post(payload);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("STUDIO_DRAFT_REQUEST");
    expect(await onDisk()).toBe(model);
  });

  it("requires a capability, the right origin, and the POST method", async () => {
    const noCapability = await fetch(`${host.origin}/studio/api/draft`, {
      method: "POST",
      headers: { origin: host.origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(noCapability.status).toBe(403);
    const crossBoundary = await fetch(`${host.origin}/studio/api/draft`, {
      method: "POST",
      headers: { authorization, origin: "https://evil.invalid", "content-type": "application/json" },
      body: "{}",
    });
    expect(crossBoundary.status).toBe(403);
    const wrongMethod = await fetch(`${host.origin}/studio/api/draft`, { headers: headers() });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    const wrongType = await fetch(`${host.origin}/studio/api/draft`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ expectedRevision: await revision(), operations: [] }),
    });
    expect(wrongType.status).toBe(422);
    expect(await onDisk()).toBe(model);
  });
});
