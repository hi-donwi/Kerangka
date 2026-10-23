import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startStudio, type StudioHost } from "../src/index.js";

const fixture = fileURLToPath(new URL("../../cli/test/fixtures/studio/approval.kerangka.json", import.meta.url));
const token = "synthetic-test-capability-01234567890123456789";
const entry = "app.kerangka.json";

describe("Studio save endpoint", () => {
  let root: string;
  let host: StudioHost;
  let model: string;

  const headers = () => ({ authorization: `Bearer ${host.token}`, origin: host.origin });
  const revision = async (): Promise<string> => {
    const response = await fetch(`${host.origin}/studio/api/project`, { headers: headers() });
    return (await response.json()).bundle.revision as string;
  };
  /** Draft one optional field and return the draft's source map plus the base revision. */
  const draft = async (field: string) => {
    const base = await revision();
    const response = await fetch(`${host.origin}/studio/api/draft`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: base,
        operations: [{ op: "addEntityField", entity: "Request", field, definition: "string?" }],
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    return { base, sources: body.bundle.sources as Record<string, { format: string; text: string }> };
  };
  const save = (body: unknown, target: StudioHost = host) =>
    fetch(`${target.origin}/studio/api/save`, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, origin: target.origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const onDisk = () => readFile(join(root, entry), "utf8");
  const strayFiles = async () => (await readdir(root)).filter((name) => name.endsWith(".tmp"));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kerangka-studio-save-"));
    model = await readFile(fixture, "utf8");
    await writeFile(join(root, entry), model);
    host = await startStudio({ target: root, port: 0, token, writable: true });
  });
  afterEach(async () => {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("writes a drafted field to disk atomically and advances the revision", async () => {
    const { base, sources } = await draft("note");
    const response = await save({ expectedRevision: base, sources });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toEqual([entry]);
    expect(await onDisk()).toContain('"note": "string?"');
    expect(await onDisk()).toContain('"title": "string!"');
    expect(body.revision).toBe(await revision());
    expect(body.bundle.sources[entry].text).toBe(await onDisk());
    expect(body.inspection.outputs.openapi).toContain("note");
    expect(await strayFiles()).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(root);
  });

  it("refuses a stale revision, returns the file that won, and changes nothing", async () => {
    const { base, sources } = await draft("note");
    await writeFile(join(root, entry), model.replace("Synthetic Request Approval", "External Edit"));
    const external = await onDisk();
    const response = await save({ expectedRevision: base, sources });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("STUDIO_REVISION_CONFLICT");
    expect(body.revision).toBe(await revision());
    expect(body.sources[entry].text).toBe(external);
    expect(body.sources[entry].text).toContain("External Edit");
    expect(await onDisk()).toBe(external);
    expect(await strayFiles()).toEqual([]);
  });

  it("refuses a model that does not compile and writes nothing", async () => {
    const { base, sources } = await draft("note");
    sources[entry]!.text = '{\n "kerangka":"0.1",\n "app":"broken",\n "entities":{"Request":{"fields":{"title":{"required":true}}}}\n}';
    const response = await save({ expectedRevision: base, sources });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("STUDIO_SAVE_INVALID");
    expect(body.diagnostics.some((item: { code: string }) => item.code === "MISSING_FIELD_TYPE")).toBe(true);
    expect(await onDisk()).toBe(model);
  });

  it("refuses a new source that is not a document, to edit a YAML source, and to accept an unsafe path", async () => {
    await writeFile(join(root, "notes.kerangka.yaml"), "kerangka: '0.1'\n");
    const { base, sources } = await draft("note");
    // A new file is allowed now, but it has to be a document the runtime can render.
    sources["new.kerangka.json"] = { format: "json", text: '{"kerangka":"0.1"}' };
    const created = await save({ expectedRevision: base, sources });
    expect(created.status).toBe(422);
    expect((await created.json()).code).toBe("STUDIO_SAVE_NOT_DOCUMENT");

    const baseAfterDraft = await revision();
    const { sources: yamlSources } = await draft("note");
    yamlSources["notes.kerangka.yaml"] = { format: "yaml", text: "kerangka: '0.1'\nedited: true\n" };
    const editedYaml = await save({ expectedRevision: baseAfterDraft, sources: yamlSources });
    expect(editedYaml.status).toBe(422);
    expect((await editedYaml.json()).code).toBe("STUDIO_SAVE_UNSUPPORTED");
    expect(await readFile(join(root, "notes.kerangka.yaml"), "utf8")).toBe("kerangka: '0.1'\n");

    const unsafe = await save({ expectedRevision: base, sources: { "../escape.json": sources[entry]! } });
    expect(unsafe.status).toBe(422);
    expect((await unsafe.json()).code).toBe("STUDIO_SAVE_REQUEST");
    expect(await onDisk()).toBe(model);
    expect(await strayFiles()).toEqual([]);
  });

  it.each([
    {},
    { expectedRevision: "sha256:x" },
    { expectedRevision: "x", sources: {} },
    { expectedRevision: "x", sources: { [entry]: { format: "xml", text: "{}" } } },
    { expectedRevision: "x", sources: { [entry]: { format: "json" } } },
  ])("rejects a malformed save request %#", async (payload) => {
    const response = await save(payload);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("STUDIO_SAVE_REQUEST");
    expect(await onDisk()).toBe(model);
  });

  it("is unavailable unless the host was launched writable, and still checks access", async () => {
    const readOnly = await startStudio({ target: root, port: 0, token: "read-only-capability-0123456789012345" });
    try {
      const { base, sources } = await draft("note");
      const unavailable = await save({ expectedRevision: base, sources }, readOnly);
      expect(unavailable.status).toBe(501);
      expect((await unavailable.json()).code).toBe("STUDIO_SAVE_UNAVAILABLE");
    } finally {
      await readOnly.close();
    }

    const { base, sources } = await draft("note");
    const noCapability = await fetch(`${host.origin}/studio/api/save`, {
      method: "POST",
      headers: { origin: host.origin, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: base, sources }),
    });
    expect(noCapability.status).toBe(403);
    const crossBoundary = await fetch(`${host.origin}/studio/api/save`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, origin: "https://evil.invalid", "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: base, sources }),
    });
    expect(crossBoundary.status).toBe(403);
    const wrongMethod = await fetch(`${host.origin}/studio/api/save`, { headers: headers() });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    expect(await onDisk()).toBe(model);
  });
  it("accepts only one concurrent save for the same source revision", async () => {
    const left = await draft("left_note");
    const right = await draft("right_note");
    expect(left.base).toBe(right.base);
    const responses = await Promise.all([
      save({ expectedRevision: left.base, sources: left.sources }),
      save({ expectedRevision: right.base, sources: right.sources }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

});
