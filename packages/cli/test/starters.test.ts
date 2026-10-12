/**
 * Starters are data (ADR-0043): `packages/cli/starters/<name>/starter.json` plus the files it
 * lists. Each one is held to the same gate as `examples/` — a starter is the first model a
 * user ever compiles, so one that does not verify is worse than none.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkCommand,
  diffCommand,
  emitCommand,
  initCommand,
  listStarters,
  loadStarter,
  scaffoldCommand,
  testCommand,
  verifyCommand,
} from "../src/index.js";

const EMIT_TARGETS = ["openapi", "asyncapi", "json-schema", "sql:postgres", "sql:sqlite"];

let workDir: string;
beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kerangka-starters-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Where `kerangka check` and friends should point for a starter written to `dir`. */
function target(dir: string, layout: string, app: string, ext: string): string {
  return layout === "document" ? path.join(dir, `${app}.kerangka.${ext}`) : dir;
}

describe("the starter catalog", () => {
  it("lists every starter with a description, by name", () => {
    const starters = listStarters();
    const names = starters.map((s) => s.starter);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining(["admin-console", "api", "commerce", "dashboard", "invoicing", "todo", "workspace"])
    );
    for (const starter of starters) {
      expect(starter.description.length, `${starter.starter} has no description`).toBeGreaterThan(0);
      expect(["document", "workspace"]).toContain(starter.layout);
    }
  });

  it("names each starter after its own directory", () => {
    for (const starter of listStarters()) {
      expect(loadStarter(starter.starter)?.starter).toBe(starter.starter);
    }
  });

  it("uses no placeholder but ${app} in content and ${app} or ${ext} in paths", () => {
    for (const starter of listStarters()) {
      for (const file of starter.files) {
        const placeholders = [...file.to.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
        expect(placeholders.every((p) => p === "app" || p === "ext"), `${starter.starter}: ${file.to}`).toBe(true);
        const text = fs.readFileSync(path.join(starter.dir, file.from), "utf8");
        // `${input.x}` and `${secret:X}` belong to connectors and are left alone; a plain
        // `${name}` that is not `app` would be written out unexpanded.
        const plain = [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
        expect(plain.every((p) => p === "app"), `${starter.starter}/${file.from}: ${plain.join(", ")}`).toBe(true);
      }
    }
  });
});

describe.each(listStarters().map((s) => [s.starter, s.layout] as const))("the %s starter", (name, layout) => {
  const app = `demo-${name}`;

  it("compiles, verifies, runs its examples, emits every contract, and diffs clean", () => {
    const dir = path.join(workDir, `${name}-json`);
    expect(initCommand(name, { output: dir, name: app })).toBe(true);
    const file = target(dir, layout, app, "json");

    expect(checkCommand(file)).toBe(true);
    expect(verifyCommand(file)).toBe(true);
    expect(testCommand(file)).toBe(true);
    for (const emitter of EMIT_TARGETS) {
      expect(emitCommand(emitter, file, { output: "-" }), `${name}: emit ${emitter}`).toBe(true);
    }
    expect(diffCommand(file, file, { checkBreaking: true })).toBe(true);
  });

  it("carries at least one declarative example, so 'kerangka test' proves something", () => {
    const dir = path.join(workDir, `${name}-examples`);
    initCommand(name, { output: dir, name: app });
    const root = layout === "document"
      ? path.join(dir, `${app}.kerangka.json`)
      : path.join(dir, "kerangka.json");
    const doc = JSON.parse(fs.readFileSync(root, "utf8"));
    expect(doc.app).toBe(app);
    expect(Array.isArray(doc.examples) && doc.examples.length > 0, `${name} has no examples`).toBe(true);
  });

  it("compiles when written as YAML", () => {
    const dir = path.join(workDir, `${name}-yaml`);
    expect(initCommand(name, { output: dir, name: app, format: "yaml" })).toBe(true);
    const file = target(dir, layout, app, "yaml");
    expect(fs.existsSync(layout === "document" ? file : path.join(dir, "kerangka.yaml"))).toBe(true);
    expect(checkCommand(file)).toBe(true);
  });
});

describe("kerangka init", () => {
  it("refuses a starter that does not exist and names the ones that do", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(initCommand("dashbord", { output: path.join(workDir, "nope") })).toBe(false);
    const said = errors.mock.calls.flat().join("\n");
    expect(said).toContain("Unknown starter 'dashbord'");
    expect(said).toContain("Did you mean 'dashboard'?");
    expect(fs.existsSync(path.join(workDir, "nope"))).toBe(false);
    errors.mockRestore();
  });

  it("creates the empty folders a workspace starter declares", () => {
    const dir = path.join(workDir, "ws-dirs");
    expect(initCommand("workspace", { output: dir, name: "ws" })).toBe(true);
    for (const folder of ["views", "policies", "tests"]) {
      expect(fs.statSync(path.join(dir, "contexts/core", folder)).isDirectory()).toBe(true);
    }
  });
});

describe("kerangka scaffold", () => {
  it("builds its polyglot app from the todo starter's model", () => {
    const dir = path.join(workDir, "scaffold-from-starter");
    expect(scaffoldCommand("taskflow", { output: dir, backend: "node", frontend: "react" })).toBe(true);
    const scaffolded = JSON.parse(fs.readFileSync(path.join(dir, "taskflow.kerangka.json"), "utf8"));

    const initDir = path.join(workDir, "todo-for-scaffold");
    initCommand("todo", { output: initDir, name: "taskflow" });
    const started = JSON.parse(fs.readFileSync(path.join(initDir, "taskflow.kerangka.json"), "utf8"));

    expect(scaffolded).toEqual(started);
  });
});
