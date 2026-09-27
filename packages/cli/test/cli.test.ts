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
  uidlCommand
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
});
