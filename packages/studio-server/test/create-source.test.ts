import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openProject, saveSources, sourceRevision, type SourceText } from "../src/index.js";

/**
 * Creating an authored page.
 *
 * A page that cannot be saved is a page the author will lose, so the create path has
 * to be as careful as the write path: the file must be new, it must stay inside the
 * project, and it must hold a document the runtime can render.
 */

const model = `{
  "kerangka": "0.1",
  "app": "create-probe",
  "entities": {
    "Request": { "fields": { "title": "string" } }
  }
}
`;

const document = JSON.stringify({
  version: "1.0",
  id: "requests",
  name: "Requests",
  root: { id: "root", type: "Container", props: {}, style: {}, children: [] },
});

async function project() {
  const root = await mkdtemp(join(tmpdir(), "kerangka-studio-create-"));
  await writeFile(join(root, "app.kerangka.json"), model);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("creating an authored page", () => {
  it("creates a new JSON source and returns it in the snapshot", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      const result = await saveSources(opened, {
        expectedRevision: before.revision,
        sources: { ...before.sources, "requests.uidl.json": { format: "json", text: document } },
      });

      expect(result.status).toBe("saved");
      expect(result.saved).toContain("requests.uidl.json");
      expect(await readFile(join(root, "requests.uidl.json"), "utf8")).toBe(document);
      expect(result.snapshot.sources["requests.uidl.json"]?.text).toBe(document);
      expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("refuses to overwrite a page created after the source snapshot", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      await writeFile(join(root, "taken.uidl.json"), document);
      const result = await saveSources(opened, {
        expectedRevision: before.revision,
        sources: { ...before.sources, "taken.uidl.json": { format: "json", text: document } },
      });
      expect(result.status).toBe("conflict");
      expect(result.saved).toEqual([]);
      expect(await readFile(join(root, "taken.uidl.json"), "utf8")).toBe(document);
    } finally {
      await cleanup();
    }
  });

  it("refuses a new file that is not a document", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "broken.uidl.json": { format: "json", text: "{ not json" } },
        }),
      ).rejects.toThrow(/UIDL document/);
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "empty.uidl.json": { format: "json", text: "{}" } },
        }),
      ).rejects.toThrow(/UIDL document/);
    } finally {
      await cleanup();
    }
  });

  it("refuses a valid UIDL document at a non-UIDL source path", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "requests.json": { format: "json", text: document } },
        }),
      ).rejects.toThrow(/\.uidl\.json/);
      await expect(readFile(join(root, "requests.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await cleanup();
    }
  });

  it("refuses to save malformed content into an existing UIDL source", async () => {
    const { root, cleanup } = await project();
    try {
      await writeFile(join(root, "requests.uidl.json"), document);
      const opened = await openProject(root);
      const before = await opened.read();
      const broken = JSON.stringify({ version: "1.0", id: "requests", name: "Requests", root: { id: "root" } });
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "requests.uidl.json": { format: "json", text: broken } },
        }),
      ).rejects.toThrow(/UIDL document/);
      expect(await readFile(join(root, "requests.uidl.json"), "utf8")).toBe(document);
    } finally {
      await cleanup();
    }
  });

  it("refuses a path that leaves the project", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "../escaped.uidl.json": { format: "json", text: document } },
        }),
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  it("refuses a new file inside a directory that is a symbolic link", async () => {
    const { root, cleanup } = await project();
    try {
      const outside = await mkdtemp(join(tmpdir(), "kerangka-studio-outside-"));
      const opened = await openProject(root);
      const before = await opened.read();
      // The link appears after the project was opened, so the loader never saw it.
      await symlink(outside, join(root, "linked"));
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "linked/escaped.uidl.json": { format: "json", text: document } },
        }),
      ).rejects.toThrow();
      await rm(outside, { recursive: true, force: true });
    } finally {
      await cleanup();
    }
  });

  it("refuses a page in a directory that does not exist yet", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      await expect(
        saveSources(opened, {
          expectedRevision: before.revision,
          sources: { ...before.sources, "deep/requests.uidl.json": { format: "json", text: document } },
        }),
      ).rejects.toThrow(/directory for a new page has to exist/);
    } finally {
      await cleanup();
    }
  });

  it("keeps the source count within the bundle limit", async () => {
    const { root, cleanup } = await project();
    try {
      const opened = await openProject(root);
      const before = await opened.read();
      const many = Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `pages/page-${index}.uidl.json`,
          { format: "json" as const, text: document },
        ]),
      );
      await expect(
        saveSources(opened, { expectedRevision: before.revision, sources: { ...before.sources, ...many } }),
      ).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });
});
