import { describe, expect, it, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { scaffoldCommand, switchCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testOutputDir = path.resolve(__dirname, "../../.tmp-switch-test");

describe("Kerangka CLI Switch Command (Instant Stack Switcher)", () => {
  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  afterAll(() => {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  });

  it("switches an existing Go backend to Rust with typed Serde models", () => {
    const appDir = path.join(testOutputDir, "switch-to-rust");
    scaffoldCommand("polyflow", {
      output: appDir,
      backend: "go",
      frontend: "react",
      database: "postgres",
    });

    expect(fs.existsSync(path.join(appDir, "backend/models.go"))).toBe(true);

    // Switch backend to Rust
    const ok = switchCommand("backend", "rust", { cwd: appDir });
    expect(ok).toBe(true);

    expect(fs.existsSync(path.join(appDir, "backend/Cargo.toml"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/src/models.rs"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/src/main.rs"))).toBe(true);
    const rustModels = fs.readFileSync(path.join(appDir, "backend/src/models.rs"), "utf-8");
    expect(rustModels).toContain("pub struct Task {");
  });

  it("switches an existing backend to Python with Pydantic models", () => {
    const appDir = path.join(testOutputDir, "switch-to-python");
    scaffoldCommand("polyflow", {
      output: appDir,
      backend: "node",
      frontend: "react",
      database: "sqlite",
    });

    // Switch backend to Python
    const ok = switchCommand("backend", "python", { cwd: appDir });
    expect(ok).toBe(true);

    expect(fs.existsSync(path.join(appDir, "backend/models.py"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/main.py"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/requirements.txt"))).toBe(true);
    const pyModels = fs.readFileSync(path.join(appDir, "backend/models.py"), "utf-8");
    expect(pyModels).toContain("class Task(BaseModel):");
  });

  it("switches an existing React frontend to Flutter with Dart models and UIDL screens", () => {
    const appDir = path.join(testOutputDir, "switch-to-flutter");
    scaffoldCommand("polyflow", {
      output: appDir,
      backend: "go",
      frontend: "react",
      database: "sqlite",
    });

    expect(fs.existsSync(path.join(appDir, "frontend/package.json"))).toBe(true);

    // Switch frontend to Flutter
    const ok = switchCommand("frontend", "flutter", { cwd: appDir });
    expect(ok).toBe(true);

    expect(fs.existsSync(path.join(appDir, "frontend/pubspec.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/lib/models.dart"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/lib/main.dart"))).toBe(true);
    const dartModels = fs.readFileSync(path.join(appDir, "frontend/lib/models.dart"), "utf-8");
    expect(dartModels).toContain("class Task {");
    expect(fs.existsSync(path.join(appDir, "frontend/screens/task-list.uidl.json"))).toBe(true);
  });
});
