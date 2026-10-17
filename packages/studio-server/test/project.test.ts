import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openProject, StudioError } from "../src/index.js";

let scratch: string;
let root: string;
const text = '{\n  "kerangka": "0.1", "app": "synthetic"\n}\n';

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kerangka-studio-project-"));
  root = join(scratch, "project");
  await mkdir(root);
  await writeFile(join(root, "app.kerangka.json"), text);
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("operator-selected read-only project", () => {
  it("preserves exact text and derives content revisions without changing files", async () => {
    const project = await openProject(join(root, "app.kerangka.json"));
    const first = await project.read();
    expect(first.entry).toBe("app.kerangka.json");
    expect(first.sources[first.entry]?.text).toBe(text);
    expect(first.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await project.read()).revision).toBe(first.revision);
    await writeFile(join(root, "app.kerangka.json"), text + " ");
    expect((await project.read()).revision).not.toBe(first.revision);
    expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(text + " ");
  });

  it("discovers only source conventions and never hidden or generated directories", async () => {
    for (const dir of ["model", ".private", "node_modules", "dist", "build"]) await mkdir(join(root, dir));
    await writeFile(join(root, "model", "other.kerangka.yaml"), "# Preserved\nkerangka: '0.1'\napp: other\n");
    for (const dir of [".private", "node_modules", "dist", "build"])
      await writeFile(join(root, dir, "secret.kerangka.json"), "DO_NOT_RETURN");
    await writeFile(join(root, "package.json"), "DO_NOT_RETURN");
    const snapshot = await (await openProject(root)).read();
    expect(Object.keys(snapshot.sources)).toEqual(["app.kerangka.json", "model/other.kerangka.yaml"]);
    expect(JSON.stringify(snapshot)).not.toContain("DO_NOT_RETURN");
    expect(snapshot.excluded).toBeGreaterThan(0);
  });

  it("requires an explicit entry when a directory contains ambiguous models", async () => {
    await writeFile(join(root, "second.kerangka.json"), text);
    await expect(openProject(root)).rejects.toMatchObject({ code: "STUDIO_ENTRY_REQUIRED" });
    expect((await (await openProject(join(root, "second.kerangka.json"))).read()).entry).toBe("second.kerangka.json");
  });

  it("refuses a symbolic-link entry", async () => {
    await writeFile(join(scratch, "outside.json"), "OUTSIDE");
    await symlink(join(scratch, "outside.json"), join(root, "linked.kerangka.json"));
    await expect(openProject(join(root, "linked.kerangka.json"))).rejects.toBeInstanceOf(StudioError);
  });

  it.each(["file", "directory"])("refuses discovered %s symlinks instead of following them", async (kind) => {
    await mkdir(join(scratch, "outside"));
    await writeFile(join(scratch, "outside", "secret.kerangka.json"), "OUTSIDE");
    const target = kind === "file" ? join(scratch, "outside", "secret.kerangka.json") : join(scratch, "outside");
    await symlink(target, join(root, kind === "file" ? "linked.kerangka.json" : "linked"));
    const project = await openProject(join(root, "app.kerangka.json"));
    await expect(project.read()).rejects.toMatchObject({ code: "STUDIO_SYMLINK_DENIED" });
  });

  it("refuses a hard-linked source", async () => {
    await writeFile(join(scratch, "outside.json"), "OUTSIDE");
    await link(join(scratch, "outside.json"), join(root, "linked.kerangka.json"));
    await expect((await openProject(join(root, "app.kerangka.json"))).read()).rejects.toMatchObject({
      code: "STUDIO_SOURCE_UNSAFE",
    });
  });

  it("enforces file byte limits before returning source", async () => {
    await writeFile(join(root, "app.kerangka.json"), "x".repeat(512 * 1024 + 1));
    await expect((await openProject(root)).read()).rejects.toMatchObject({ code: "STUDIO_SOURCE_LIMIT" });
  });

  it("enforces aggregate byte and file-count limits", async () => {
    const project = await openProject(root);
    for (let i = 0; i < 8; i++) await writeFile(join(root, `large-${i}.kerangka.json`), "x".repeat(512 * 1024));
    await expect(project.read()).rejects.toMatchObject({ code: "STUDIO_SOURCE_LIMIT" });
    for (let i = 0; i < 8; i++) await rm(join(root, `large-${i}.kerangka.json`));
    for (let i = 0; i < 128; i++) await writeFile(join(root, `model-${i}.kerangka.json`), "{}");
    await expect(project.read()).rejects.toMatchObject({ code: "STUDIO_SOURCE_LIMIT" });
  });

  it("refuses source names outside the portable contract instead of renaming them", async () => {
    await writeFile(join(root, "bad name.kerangka.json"), "{}");
    await expect((await openProject(join(root, "app.kerangka.json"))).read()).rejects.toMatchObject({
      code: "STUDIO_SOURCE_PATH",
    });
  });

  it("refuses invalid UTF-8 rather than replacing bytes", async () => {
    await writeFile(join(root, "app.kerangka.json"), Buffer.from([0xc3, 0x28]));
    await expect((await openProject(root)).read()).rejects.toMatchObject({ code: "STUDIO_SOURCE_ENCODING" });
  });

  it("does not cross a nested repository ownership boundary", async () => {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", ".git"), "gitdir: /not-used");
    await writeFile(join(root, "nested", "private.kerangka.json"), "OTHER_REPOSITORY_MARKER");
    const snapshot = await (await openProject(root)).read();
    expect(Object.keys(snapshot.sources)).toEqual(["app.kerangka.json"]);
    expect(JSON.stringify(snapshot)).not.toContain("OTHER_REPOSITORY_MARKER");
  });

  it("bounds traversal even when a directory contains only non-source files", async () => {
    const project = await openProject(join(root, "app.kerangka.json"));
    for (let offset = 0; offset < 10000; offset += 100) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) => writeFile(join(root, `asset-${offset + index}.txt`), "")),
      );
    }
    await expect(project.read()).rejects.toMatchObject({ code: "STUDIO_SOURCE_LIMIT" });
  }, 15000);
});
