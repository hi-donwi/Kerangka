import { describe, expect, it, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkCommand,
  buildCommand,
  ddlCommand,
  openapiCommand,
  graphqlCommand,
  mcpCommand,
  uidlCommand,
  codegenCommand,
  diffCommand,
  composeCommand,
  emitCommand,
  lintCommand,
  graphCommand
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const tmpDir = path.resolve(__dirname, "../../../.tmp-cli-test");

describe("Kerangka CLI Commands", () => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("checkCommand succeeds on valid example", () => {
    const success = checkCommand(examplePath);
    expect(success).toBe(true);
  });

  it("buildCommand produces KIR file", () => {
    const outPath = path.join(tmpDir, "invoicing.kir.json");
    const success = buildCommand(examplePath, outPath);
    expect(success).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    expect(content.kir).toBe("0.1");
    expect(content.app).toBe("invoicing");
  });

  it("ddlCommand generates SQL file", () => {
    const outSql = path.join(tmpDir, "schema.sql");
    const success = ddlCommand(examplePath, { output: outSql, dialect: "postgres" });
    expect(success).toBe(true);
    expect(fs.existsSync(outSql)).toBe(true);
    const sql = fs.readFileSync(outSql, "utf-8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS invoice");
  });

  it("openapiCommand generates OpenAPI spec file", () => {
    const outOpenApi = path.join(tmpDir, "openapi.json");
    const success = openapiCommand(examplePath, outOpenApi);
    expect(success).toBe(true);
    expect(fs.existsSync(outOpenApi)).toBe(true);
    const spec = JSON.parse(fs.readFileSync(outOpenApi, "utf-8"));
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Invoicing");
  });

  it("graphqlCommand generates GraphQL SDL file", () => {
    const outGql = path.join(tmpDir, "schema.graphql");
    const success = graphqlCommand(examplePath, outGql);
    expect(success).toBe(true);
    expect(fs.existsSync(outGql)).toBe(true);
    const gql = fs.readFileSync(outGql, "utf-8");
    expect(gql).toContain("type Invoice {");
  });

  it("mcpCommand generates MCP tool definitions file", () => {
    const outMcp = path.join(tmpDir, "mcp.json");
    const success = mcpCommand(examplePath, outMcp);
    expect(success).toBe(true);
    expect(fs.existsSync(outMcp)).toBe(true);
    const data = JSON.parse(fs.readFileSync(outMcp, "utf-8"));
    expect(Array.isArray(data.tools)).toBe(true);
  });

  it("uidlCommand generates UIDL screens directory", () => {
    const outUidlDir = path.join(tmpDir, "uidl-screens");
    const success = uidlCommand(examplePath, outUidlDir);
    expect(success).toBe(true);
    expect(fs.existsSync(outUidlDir)).toBe(true);
    expect(fs.existsSync(path.join(outUidlDir, "invoices.uidl.json"))).toBe(true);
    expect(fs.existsSync(path.join(outUidlDir, "home.uidl.json"))).toBe(true);
  });

  it("codegenCommand generates TypeScript code", () => {
    const outTs = path.join(tmpDir, "models.ts");
    const success = codegenCommand(examplePath, { target: "ts", output: outTs });
    expect(success).toBe(true);
    expect(fs.existsSync(outTs)).toBe(true);
    const content = fs.readFileSync(outTs, "utf-8");
    expect(content).toContain("export interface Invoice {");
  });

  it("diffCommand analyzes differences between two models", () => {
    const success = diffCommand(examplePath, examplePath);
    expect(success).toBe(true);
  });

  it("composeCommand generates docker-compose.yml file", () => {
    const outCompose = path.join(tmpDir, "docker-compose.yml");
    const success = composeCommand(examplePath, { output: outCompose });
    expect(success).toBe(true);
    expect(fs.existsSync(outCompose)).toBe(true);
    const content = fs.readFileSync(outCompose, "utf-8");
    expect(content).toContain("postgres:16-alpine");
    expect(content).toContain("valkey/valkey:8-alpine");
  });

  it("emitCommand dispatches to targets", () => {
    const outEmit = path.join(tmpDir, "emitted-compose.yml");
    const success = emitCommand("compose", examplePath, { output: outEmit });
    expect(success).toBe(true);
    expect(fs.existsSync(outEmit)).toBe(true);
  });

  it("lintCommand passes on every example with the recommended preset", () => {
    const examplesDir = path.resolve(__dirname, "../../../examples");
    for (const name of ["todo", "invoicing", "leave-request", "inventory"]) {
      expect(lintCommand(path.join(examplesDir, `${name}.kerangka.json`))).toBe(true);
    }
    // A workspace directory resolves to its manifest.
    expect(lintCommand(path.join(examplesDir, "commerce"))).toBe(true);
  });

  it("lintCommand reports a finding and fails", () => {
    const badPath = path.join(tmpDir, "bad.kerangka.json");
    fs.writeFileSync(
      badPath,
      JSON.stringify(
        {
          kerangka: "0.1",
          app: "Bad_App",
          entities: { order: { fields: { id: "uuid!" } } },
          events: { PlaceOrder: { id: "uuid!" } },
        },
        null,
        2
      )
    );
    expect(lintCommand(badPath, { failOn: "warning" })).toBe(false);
  });

  it("lintCommand emits a machine-readable report", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };
    try {
      lintCommand(examplePath, { format: "json" });
    } finally {
      console.log = original;
    }
    const report = JSON.parse(lines.join("\n"));
    expect(report.ok).toBe(true);
    expect(report.preset).toBe("kerangka:recommended");
    expect(report.diagnostics).toEqual([]);
    expect(report.counts.entities).toBe(3);
  });

  it("lintCommand honours the kerangka:off preset", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };
    try {
      lintCommand(examplePath, { format: "json", preset: "kerangka:off" });
    } finally {
      console.log = original;
    }
    expect(JSON.parse(lines.join("\n")).preset).toBe("kerangka:off");
  });

  it("graphCommand generates Mermaid flowchart for multi-context workspace", () => {
    const commercePath = path.resolve(__dirname, "../../../examples/commerce");
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };
    try {
      const ok = graphCommand(commercePath);
      expect(ok).toBe(true);
    } finally {
      console.log = original;
    }
    const output = lines.join("\n");
    expect(output).toContain("flowchart TD");
    expect(output).toContain("orders");
    expect(output).toContain("billing");
    expect(output).toContain("inventory");
    expect(output).toContain("billing -->|depends on| orders");
    expect(output).toContain("orders -.->|on: OrderPlaced| billing");
  });

  it("graphCommand groups into services when topology is provided", () => {
    const commercePath = path.resolve(__dirname, "../../../examples/commerce");
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };
    try {
      const ok = graphCommand(commercePath, { topology: "distributed" });
      expect(ok).toBe(true);
    } finally {
      console.log = original;
    }
    const output = lines.join("\n");
    expect(output).toContain("subgraph svc_orders_service");
    expect(output).toContain("subgraph svc_billing_service");
    expect(output).toContain("subgraph svc_inventory_service");
  });

  it("graphCommand generates JSON format and writes to file", () => {
    const commercePath = path.resolve(__dirname, "../../../examples/commerce");
    const outGraph = path.join(tmpDir, "graph.json");
    const ok = graphCommand(commercePath, { format: "json", output: outGraph });
    expect(ok).toBe(true);
    expect(fs.existsSync(outGraph)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outGraph, "utf-8"));
    expect(parsed.app).toBe("commerce");
    expect(parsed.nodes.length).toBe(3);
    expect(parsed.edges.some((e: any) => e.type === "dependsOn")).toBe(true);
  });

  it("graphCommand renders single-file model entities", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };
    try {
      const ok = graphCommand(examplePath);
      expect(ok).toBe(true);
    } finally {
      console.log = original;
    }
    const output = lines.join("\n");
    expect(output).toContain("flowchart TD");
    expect(output).toContain("Invoice");
  });
});

