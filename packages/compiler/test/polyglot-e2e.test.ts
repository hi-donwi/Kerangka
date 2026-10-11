import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, verifyDocument } from "@kerangka/compiler";
import { CodeGenerator } from "../src/codegen/index.js";
import { Engine } from "@kerangka/engine-ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const polyglotDir = path.resolve(__dirname, "../../../examples/polyglot");
const modelPath = path.join(polyglotDir, "kerangka.json");

describe("Polyglot Showcase End-to-End Validation", () => {
  const modelContent = fs.readFileSync(modelPath, "utf8");
  const model = JSON.parse(modelContent);

  it("passes verification gate with zero fatal findings", () => {
    const verification = verifyDocument(model, modelContent);
    expect(verification.ok).toBe(true);
    const fatalFindings = verification.findings.filter((f) => f.severity === "error");
    expect(fatalFindings).toHaveLength(0);
  });

  it("compiles polyglot model into valid IR", () => {
    const ir = compile(model);
    expect(ir.app).toBe("polyglot-tasks");
    expect(ir.entities.Task).toBeDefined();
    expect(ir.entities.Task.fields.title).toBeDefined();
    expect(ir.entities.Task.actions.complete).toBeDefined();
    expect(ir.entities.Task.actions.reopen).toBeDefined();
  });

  it("generates Rust types matching domain entity and enum variants", () => {
    const ir = compile(model);
    const rustCode = CodeGenerator.generate(ir, "rust");
    expect(rustCode).toContain("pub struct Task");
    expect(rustCode).toContain("pub title: String");
    expect(rustCode).toContain("pub completed: Option<bool>");
    expect(rustCode).toContain("pub priority: Option<TaskPriority>");
    expect(rustCode).toContain("pub enum TaskPriority");
    expect(rustCode).toContain("#[serde(rename_all = \"camelCase\")]");
  });

  it("generates Dart types matching domain entity and constructor", () => {
    const ir = compile(model);
    const dartCode = CodeGenerator.generate(ir, "dart");
    expect(dartCode).toContain("class Task");
    expect(dartCode).toContain("final String title;");
    expect(dartCode).toContain("final bool? completed;");
    expect(dartCode).toContain("factory Task.fromJson");
    expect(dartCode).toContain("Map<String, dynamic> toJson()");
  });

  it("generates Go types matching domain entity and tags", () => {
    const ir = compile(model);
    const goCode = CodeGenerator.generate(ir, "go");
    expect(goCode).toContain("type Task struct");
    expect(goCode).toContain("Title string `json:\"title\"`");
    expect(goCode).toContain("Completed *bool `json:\"completed,omitempty\"`");
  });

  it("generates Python types matching domain dataclass and types", () => {
    const ir = compile(model);
    const pythonCode = CodeGenerator.generate(ir, "python");
    expect(pythonCode).toContain("class Task(BaseModel):");
    expect(pythonCode).toContain("title: str");
    expect(pythonCode).toContain("completed: Optional[bool]");
  });

  it("validates projected UIDL screens structure", () => {
    const listScreenPath = path.join(polyglotDir, "frontend-screens/task-list.uidl.json");
    const formScreenPath = path.join(polyglotDir, "frontend-screens/task-form.uidl.json");

    expect(fs.existsSync(listScreenPath)).toBe(true);
    expect(fs.existsSync(formScreenPath)).toBe(true);

    const listScreen = JSON.parse(fs.readFileSync(listScreenPath, "utf8"));
    const formScreen = JSON.parse(fs.readFileSync(formScreenPath, "utf8"));

    expect(listScreen.version).toBe("1.0.0");
    expect(listScreen.id).toBe("task-list");
    expect(listScreen.root.type).toBe("Container");

    expect(formScreen.version).toBe("1.0.0");
    expect(formScreen.id).toBe("task-form");
    expect(formScreen.root.type).toBe("Container");
  });

  it("executes state machine transitions in Engine correctly", async () => {
    const ir = compile(model);
    const engine = new Engine(ir);

    // Initial state: not completed
    const task = {
      title: "Write multi-stack test",
      priority: "high",
      completed: false,
    };

    // 1. Run complete action -> ok
    const completeRes = await engine.run("Task.complete", task);
    expect(completeRes.ok).toBe(true);
    expect(completeRes.record.completed).toBe(true);

    // 2. Run complete on already completed task -> refused by precondition (!completed)
    const invalidCompleteRes = await engine.run("Task.complete", completeRes.record);
    expect(invalidCompleteRes.ok).toBe(false);

    // 3. Run reopen on completed task -> ok
    const reopenRes = await engine.run("Task.reopen", completeRes.record);
    expect(reopenRes.ok).toBe(true);
    expect(reopenRes.record.completed).toBe(false);

    // 4. Run reopen on already open task -> refused by precondition (completed)
    const invalidReopenRes = await engine.run("Task.reopen", reopenRes.record);
    expect(invalidReopenRes.ok).toBe(false);
  });
});
