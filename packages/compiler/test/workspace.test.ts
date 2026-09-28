import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { compile, CompilerError } from "../src/index.js";

const examplesDir = resolve(__dirname, "../../../examples");
const commercePath = resolve(examplesDir, "commerce/kerangka.json");

describe("Workspace Compiler - Multi-Context Compilation", () => {
  it("compiles commerce multi-context workspace with all entities, events, and policies", () => {
    const raw = fs.readFileSync(commercePath, "utf8");
    const kir = compile(raw, { sourcePath: commercePath });

    expect(kir.app).toBe("commerce");
    expect(kir.kir).toBe("0.1");

    // All entities across contexts must be flattened
    expect(Object.keys(kir.entities).sort()).toEqual([
      "Invoice",
      "Order",
      "OrderLine",
      "StockReservation",
    ]);

    // Order entity checks
    expect(kir.entities.Order!.fields.orderNumber).toBeDefined();
    expect(kir.entities.Order!.fields.totalAmount).toBeDefined();
    expect(kir.entities.Order!.workflow?.transitions.place).toBeDefined();
    expect(kir.entities.Order!.workflow?.transitions.cancel).toBeDefined();

    // OrderLine entity checks
    expect(kir.entities.OrderLine!.embedded).toBe(true);

    // Invoice entity checks
    expect(kir.entities.Invoice!.fields.invoiceNumber).toBeDefined();
    expect(kir.entities.Invoice!.workflow?.transitions.markPaid).toBeDefined();

    // StockReservation entity checks
    expect(kir.entities.StockReservation!.fields.status).toBeDefined();

    // Events must be aggregated
    expect(kir.events).toBeDefined();
    expect(kir.events!.OrderPlaced).toBeDefined();
    expect(kir.events!.OrderCancelled).toBeDefined();
    expect(kir.events!.InvoicePaid).toBeDefined();

    // Policies must be aggregated
    expect(kir.policies).toBeDefined();
    expect(kir.policies!.onOrderPlaced).toBeDefined();
  });

  it("detects dependency cycles between contexts (DEPENDENCY_CYCLE)", () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), "kerangka-cycle-"));
    try {
      const rootManifest = {
        kerangka: "0.1",
        app: "cycle-app",
        contexts: ["a", "b"],
      };
      fs.writeFileSync(resolve(tmpDir, "kerangka.json"), JSON.stringify(rootManifest));
      fs.mkdirSync(resolve(tmpDir, "contexts/a"), { recursive: true });
      fs.mkdirSync(resolve(tmpDir, "contexts/b"), { recursive: true });

      fs.writeFileSync(
        resolve(tmpDir, "contexts/a/context.kerangka.json"),
        JSON.stringify({
          context: "a",
          dependsOn: ["b"],
          entities: { EntityA: { fields: { name: "string!" } } },
        })
      );

      fs.writeFileSync(
        resolve(tmpDir, "contexts/b/context.kerangka.json"),
        JSON.stringify({
          context: "b",
          dependsOn: ["a"],
          entities: { EntityB: { fields: { title: "string!" } } },
        })
      );

      const rootPath = resolve(tmpDir, "kerangka.json");
      expect(() =>
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath })
      ).toThrowError(CompilerError);

      try {
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath });
      } catch (err) {
        expect(err).toBeInstanceOf(CompilerError);
        const diags = (err as CompilerError).diagnostics;
        expect(diags.some((d) => d.code === "DEPENDENCY_CYCLE")).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces boundary rule: foreign events consumed by policies must be exported (NOT_EXPORTED)", () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), "kerangka-export-"));
    try {
      const rootManifest = {
        kerangka: "0.1",
        app: "export-app",
        contexts: ["producer", "consumer"],
      };
      fs.writeFileSync(resolve(tmpDir, "kerangka.json"), JSON.stringify(rootManifest));
      fs.mkdirSync(resolve(tmpDir, "contexts/producer"), { recursive: true });
      fs.mkdirSync(resolve(tmpDir, "contexts/consumer"), { recursive: true });

      // Producer has PrivateEvent but only exports PublicEvent
      fs.writeFileSync(
        resolve(tmpDir, "contexts/producer/context.kerangka.json"),
        JSON.stringify({
          context: "producer",
          exports: { events: ["PublicEvent"] },
          events: {
            PublicEvent: { id: "string!" },
            PrivateEvent: { secret: "string!" },
          },
          entities: { ProdEntity: { fields: { name: "string!" } } },
        })
      );

      // Consumer depends on producer but listens to PrivateEvent
      fs.writeFileSync(
        resolve(tmpDir, "contexts/consumer/context.kerangka.json"),
        JSON.stringify({
          context: "consumer",
          dependsOn: ["producer"],
          entities: { ConsEntity: { fields: { name: "string!" } } },
          policies: {
            onPrivate: {
              on: "producer.PrivateEvent",
              run: "ConsEntity.create",
            },
          },
        })
      );

      const rootPath = resolve(tmpDir, "kerangka.json");
      expect(() =>
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath })
      ).toThrowError(CompilerError);

      try {
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath });
      } catch (err) {
        expect(err).toBeInstanceOf(CompilerError);
        const diags = (err as CompilerError).diagnostics;
        expect(diags.some((d) => d.code === "NOT_EXPORTED")).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces boundary rule: emitted events must be declared (UNDECLARED_EVENT)", () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), "kerangka-event-"));
    try {
      const rootManifest = {
        kerangka: "0.1",
        app: "event-app",
        contexts: ["main"],
      };
      fs.writeFileSync(resolve(tmpDir, "kerangka.json"), JSON.stringify(rootManifest));
      fs.mkdirSync(resolve(tmpDir, "contexts/main"), { recursive: true });

      fs.writeFileSync(
        resolve(tmpDir, "contexts/main/context.kerangka.json"),
        JSON.stringify({
          context: "main",
          entities: {
            Order: {
              fields: { status: "enum(draft, placed) = draft" },
              workflow: {
                field: "status",
                transitions: {
                  place: {
                    from: "draft",
                    to: "placed",
                    then: [{ emit: "GhostEvent", data: {} }],
                  },
                },
              },
            },
          },
          events: {},
        })
      );

      const rootPath = resolve(tmpDir, "kerangka.json");
      expect(() =>
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath })
      ).toThrowError(CompilerError);

      try {
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath });
      } catch (err) {
        expect(err).toBeInstanceOf(CompilerError);
        const diags = (err as CompilerError).diagnostics;
        expect(diags.some((d) => d.code === "UNDECLARED_EVENT")).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports error when declared context directory does not exist (CONTEXT_NOT_FOUND)", () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), "kerangka-missing-ctx-"));
    try {
      const rootManifest = {
        kerangka: "0.1",
        app: "missing-ctx-app",
        contexts: ["ghost"],
      };
      fs.writeFileSync(resolve(tmpDir, "kerangka.json"), JSON.stringify(rootManifest));
      const rootPath = resolve(tmpDir, "kerangka.json");

      expect(() =>
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath })
      ).toThrowError(CompilerError);

      try {
        compile(fs.readFileSync(rootPath, "utf8"), { sourcePath: rootPath });
      } catch (err) {
        expect(err).toBeInstanceOf(CompilerError);
        const diags = (err as CompilerError).diagnostics;
        expect(diags.some((d) => d.code === "CONTEXT_NOT_FOUND")).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
