import { describe, expect, it, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { scaffoldCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testOutputDir = path.resolve(__dirname, "../../.tmp-scaffold-test");

describe("Kerangka CLI Scaffold Command (Polyglot & Stack Switcher)", () => {
  if (!fs.existsSync(testOutputDir)) {
    fs.mkdirSync(testOutputDir, { recursive: true });
  }

  afterAll(() => {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  });

  it("scaffolds Go backend and React frontend with UIDL screens", () => {
    const appDir = path.join(testOutputDir, "go-react-app");
    const ok = scaffoldCommand("taskflow", {
      output: appDir,
      backend: "go",
      frontend: "react",
      database: "postgres",
    });

    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(appDir, "taskflow.kerangka.json"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "docker-compose.yml"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "README.md"))).toBe(true);

    // Go Backend
    expect(fs.existsSync(path.join(appDir, "backend/models.go"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/main.go"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/go.mod"))).toBe(true);
    const goModels = fs.readFileSync(path.join(appDir, "backend/models.go"), "utf-8");
    expect(goModels).toContain("type Task struct {");

    // React Frontend + UIDL Screens
    expect(fs.existsSync(path.join(appDir, "frontend/package.json"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/src/App.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/screens/task-list.uidl.json"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/screens/task-form.uidl.json"))).toBe(true);
  });

  it("scaffolds Python backend and Flutter frontend with UIDL screens", () => {
    const appDir = path.join(testOutputDir, "python-flutter-app");
    const ok = scaffoldCommand("shopflow", {
      output: appDir,
      backend: "python",
      frontend: "flutter",
      database: "sqlite",
    });

    expect(ok).toBe(true);

    // Python Backend
    expect(fs.existsSync(path.join(appDir, "backend/models.py"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/main.py"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/requirements.txt"))).toBe(true);
    const pyModels = fs.readFileSync(path.join(appDir, "backend/models.py"), "utf-8");
    expect(pyModels).toContain("class Task(BaseModel):");

    // Flutter Frontend
    expect(fs.existsSync(path.join(appDir, "frontend/pubspec.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/lib/models.dart"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/lib/main.dart"))).toBe(true);
    const dartModels = fs.readFileSync(path.join(appDir, "frontend/lib/models.dart"), "utf-8");
    expect(dartModels).toContain("class Task {");
    expect(fs.existsSync(path.join(appDir, "frontend/screens/task-list.uidl.json"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "frontend/screens/task-form.uidl.json"))).toBe(true);
  });


  it("scaffolds Rust backend with typed Serde models", () => {
    const appDir = path.join(testOutputDir, "rust-app");
    const ok = scaffoldCommand("coreflow", {
      output: appDir,
      backend: "rust",
      frontend: "react",
      database: "postgres",
    });

    expect(ok).toBe(true);

    // Rust Backend
    expect(fs.existsSync(path.join(appDir, "backend/Cargo.toml"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/src/main.rs"))).toBe(true);
    expect(fs.existsSync(path.join(appDir, "backend/src/models.rs"))).toBe(true);
    const rustModels = fs.readFileSync(path.join(appDir, "backend/src/models.rs"), "utf-8");
    expect(rustModels).toContain("pub struct Task {");
    expect(rustModels).toContain("pub completed: Option<bool>,");
  });
});
