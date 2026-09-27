/**
 * Kerangka Zero-Config Development & API Server
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as http from "node:http";
import { URL } from "node:url";
import {
  KIRDocument,
  generateOpenAPI,
  generateGraphQL,
  generateMcpTools,
  generateUIDL,
  McpToolDefinition,
  UIDLDocument
} from "@kerangka/compiler";
import { StorePort, MemoryStore } from "@kerangka/ports";
import { Engine } from "@kerangka/engine-ts";

export interface ServerOptions {
  port?: number;
  host?: string;
  store?: StorePort;
  quiet?: boolean;
}

export class KerangkaServer {
  readonly kir: KIRDocument;
  readonly port: number;
  readonly host: string;
  readonly store: StorePort;
  readonly engine: Engine;
  readonly openApiSpec: Record<string, unknown>;
  readonly graphqlSchema: string;
  readonly mcpTools: McpToolDefinition[];
  readonly uidlDocs: Record<string, UIDLDocument>;

  private httpServer: http.Server | null = null;
  private quiet: boolean;

  constructor(kir: KIRDocument, options: ServerOptions = {}) {
    this.kir = kir;
    this.port = options.port || 3000;
    this.host = options.host || "localhost";
    this.quiet = options.quiet ?? false;
    this.store = options.store || new MemoryStore();
    this.engine = new Engine(kir);

    this.openApiSpec = generateOpenAPI(kir, {
      serverUrl: `http://${this.host}:${this.port}`
    });
    this.graphqlSchema = generateGraphQL(kir);
    this.mcpTools = generateMcpTools(kir);
    this.uidlDocs = generateUIDL(kir);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          this.sendProblem(res, 500, "Internal Server Error", err?.message || String(err));
        }
      });

      this.httpServer.listen(this.port, this.host, () => {
        if (!this.quiet) {
          console.log(`Kerangka Dev Server running at http://${this.host}:${this.port}`);
          console.log(`- Playground: http://${this.host}:${this.port}/`);
          console.log(`- OpenAPI Spec: http://${this.host}:${this.port}/openapi.json`);
          console.log(`- GraphQL SDL: http://${this.host}:${this.port}/schema.graphql`);
          console.log(`- MCP Tools: http://${this.host}:${this.port}/api/mcp/tools`);
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close((err) => {
        if (err) return reject(err);
        this.httpServer = null;
        resolve();
      });
    });
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${this.host}:${this.port}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || "GET";

    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Static / Metadata endpoints
    if (pathname === "/" || pathname === "/playground") {
      this.sendHtml(res, this.renderPlaygroundHtml());
      return;
    }

    if (pathname === "/openapi.json") {
      this.sendJson(res, 200, this.openApiSpec);
      return;
    }

    if (pathname === "/schema.graphql") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.statusCode = 200;
      res.end(this.graphqlSchema);
      return;
    }

    if (pathname === "/api/mcp/tools") {
      this.sendJson(res, 200, { tools: this.mcpTools });
      return;
    }

    if (pathname === "/api/mcp/call" && method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.handleMcpCall(body);
      this.sendJson(res, 200, result);
      return;
    }

    // UIDL documents endpoints
    if (pathname.startsWith("/uidl")) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length === 1) {
        // List all UIDL doc keys
        this.sendJson(res, 200, { documents: Object.keys(this.uidlDocs) });
        return;
      }
      const docId = parts[1] || "";
      const doc = this.uidlDocs[docId];
      if (doc) {
        this.sendJson(res, 200, doc);
      } else {
        this.sendProblem(res, 404, "Not Found", `UIDL document '${docId}' not found.`);
      }
      return;
    }

    // REST API routes (/api/{entity}...)
    if (pathname.startsWith("/api/")) {
      await this.handleRestApi(req, res, pathname, method, url);
      return;
    }

    this.sendProblem(res, 404, "Not Found", `Route '${pathname}' not found.`);
  }

  private async handleRestApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    url: URL
  ): Promise<void> {
    const parts = pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
    if (parts.length === 0) {
      this.sendProblem(res, 404, "Not Found", "Missing entity in API route.");
      return;
    }

    const entityParam = parts[0] || "";
    const entityName = Object.keys(this.kir.entities || {}).find(
      (k) => k.toLowerCase() === entityParam.toLowerCase()
    );

    if (!entityName) {
      this.sendProblem(res, 404, "Entity Not Found", `Entity '${entityParam}' does not exist.`);
      return;
    }

    // Collection endpoint: /api/{entity}
    if (parts.length === 1) {
      if (method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const queryResult = await this.store.find(entityName, undefined, {
          limit,
          offset
        });
        this.sendJson(res, 200, queryResult.items);
        return;
      }

      if (method === "POST") {
        const body = await this.readJsonBody(req);
        const entityDef = this.kir.entities[entityName];
        const keyField = entityDef?.key || "id";
        const id = body[keyField] || `${entityName.toLowerCase()}_${Date.now()}`;
        const recordWithComputed = this.engine.compute(entityName, { ...body, [keyField]: id });
        const created = await this.store.create(entityName, recordWithComputed);
        this.sendJson(res, 201, created);
        return;
      }
    }

    // Item endpoint: /api/{entity}/{id}
    if (parts.length === 2) {
      const id = parts[1] || "";

      if (method === "GET") {
        const item = await this.store.get(entityName, id);
        if (!item) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`);
          return;
        }
        this.sendJson(res, 200, item);
        return;
      }

      if (method === "PUT") {
        const body = await this.readJsonBody(req);
        const existing = await this.store.get(entityName, id);
        if (!existing) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`);
          return;
        }
        const updatedWithCompute = this.engine.compute(entityName, { ...existing, ...body });
        const updated = await this.store.update(entityName, id, updatedWithCompute);
        this.sendJson(res, 200, updated);
        return;
      }

      if (method === "DELETE") {
        await this.store.delete(entityName, id);
        res.statusCode = 204;
        res.end();
        return;
      }
    }

    // Action endpoint: /api/{entity}/{id}/actions/{actionName}
    if (parts.length === 4 && parts[2] === "actions") {
      const id = parts[1] || "";
      const actionName = parts[3] || "";

      if (method === "POST") {
        const body = (await this.readJsonBody(req).catch(() => ({}))) || {};
        const existing = await this.store.get(entityName, id);
        if (!existing) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`);
          return;
        }

        const actor = { id: "dev-user", roles: body.roles || ["admin", "billing"] };

        // Check if transition or custom action
        const entityDef = this.kir.entities[entityName];
        let result = this.engine.transition(entityName, existing, actionName, actor);

        if (!result.ok && entityDef?.actions?.[actionName]) {
          result = this.engine.executeAction(entityName, existing, actionName, body, actor);
        }

        if (!result.ok) {
          this.sendProblem(res, 400, "Action Execution Failed", result.message || result.error || "Guard or validation failed.");
          return;
        }

        const updatedState = result.record || existing;
        await this.store.update(entityName, id, updatedState);

        this.sendJson(res, 200, {
          ok: true,
          action: actionName,
          record: updatedState,
          events: result.events
        });
        return;
      }
    }

    this.sendProblem(res, 404, "Not Found", `No matching route for ${pathname}`);
  }

  private async handleMcpCall(body: any): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const { name, arguments: args = {} } = body;
    try {
      if (name.startsWith("list_")) {
        const entityKey = name.replace("list_", "");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for list tool: ${entityKey}`);

        const results = await this.store.find(entityName, args.filter, {
          limit: args.limit || 50,
          offset: args.offset || 0
        });
        return {
          content: [{ type: "text", text: JSON.stringify(results.items, null, 2) }]
        };
      }

      if (name.startsWith("get_")) {
        const entityKey = name.replace("get_", "");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for get tool: ${entityKey}`);

        const item = await this.store.get(entityName, args.id);
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }]
        };
      }

      if (name.startsWith("create_")) {
        const entityKey = name.replace("create_", "");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for create tool: ${entityKey}`);

        const entityDef = this.kir.entities[entityName];
        const keyField = entityDef?.key || "id";
        const id = args[keyField] || `${entityName.toLowerCase()}_${Date.now()}`;
        const record = this.engine.compute(entityName, { ...args, [keyField]: id });
        const created = await this.store.create(entityName, record);
        return {
          content: [{ type: "text", text: `Created ${entityName} with ID '${id}':\n${JSON.stringify(created, null, 2)}` }]
        };
      }

      if (name.startsWith("update_")) {
        const entityKey = name.replace("update_", "");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for update tool: ${entityKey}`);

        const existing = await this.store.get(entityName, args.id);
        if (!existing) throw new Error(`${entityName} with id '${args.id}' not found.`);

        const updatedWithCompute = this.engine.compute(entityName, { ...existing, ...(args.patch || {}) });
        const updated = await this.store.update(entityName, args.id, updatedWithCompute);
        return {
          content: [{ type: "text", text: `Updated ${entityName} '${args.id}':\n${JSON.stringify(updated, null, 2)}` }]
        };
      }

      if (name.startsWith("delete_")) {
        const entityKey = name.replace("delete_", "");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for delete tool: ${entityKey}`);

        await this.store.delete(entityName, args.id);
        return {
          content: [{ type: "text", text: `Deleted ${entityName} '${args.id}'.` }]
        };
      }

      if (name.startsWith("transition_")) {
        const parts = name.replace("transition_", "").split("_");
        const entityKey = parts[0] || "";
        const actionName = parts.slice(1).join("_");
        const entityName = Object.keys(this.kir.entities).find(k => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for transition: ${entityKey}`);

        const item = await this.store.get(entityName, args.id);
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);

        const result = this.engine.transition(
          entityName,
          item,
          actionName,
          { id: "mcp-agent", roles: args.actorRoles || ["admin", "billing"] }
        );

        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Transition failed: ${result.message || result.error}` }]
          };
        }

        const updatedState = result.record || item;
        await this.store.update(entityName, args.id, updatedState);

        return {
          content: [{ type: "text", text: `Transition '${actionName}' executed successfully on ${entityName} ${args.id}.\nNew State:\n${JSON.stringify(updatedState, null, 2)}` }]
        };
      }

      throw new Error(`Tool '${name}' is not recognized.`);
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }]
      };
    }
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = status;
    res.end(JSON.stringify(data, null, 2));
  }

  private sendProblem(res: http.ServerResponse, status: number, title: string, detail: string): void {
    res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
    res.statusCode = status;
    res.end(JSON.stringify({
      type: "about:blank",
      title,
      status,
      detail
    }, null, 2));
  }

  private sendHtml(res: http.ServerResponse, html: string): void {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    res.end(html);
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        if (!data.trim()) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  private renderPlaygroundHtml(): string {
    const title = this.kir.meta?.title || this.kir.app;
    const entities = Object.keys(this.kir.entities || {});
    const views = Object.keys(this.uidlDocs);
    const mcpToolList = this.mcpTools.map(t => `<li><code>${t.name}</code>: ${t.description}</li>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — Kerangka Dev Playground</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
    header { border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { margin: 0 0 8px 0; font-size: 24px; color: #38bdf8; }
    p { margin: 0; color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
    .card { background: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 20px; }
    .card h2 { margin-top: 0; font-size: 18px; color: #f1f5f9; border-bottom: 1px solid #334155; padding-bottom: 8px; }
    ul { list-style: none; padding-left: 0; }
    li { margin-bottom: 10px; font-size: 14px; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #fbbf24; font-size: 13px; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>${title} <span class="badge">v0.1</span></h1>
    <p>Kerangka Zero-Config Development & API Playground</p>
  </header>
  <div class="grid">
    <div class="card">
      <h2>Entities & REST APIs</h2>
      <ul>
        ${entities.map(e => `<li><a href="/api/${e.toLowerCase()}">GET /api/${e.toLowerCase()}</a> <code>${e}</code></li>`).join("")}
      </ul>
      <p style="margin-top: 16px;"><a href="/openapi.json" target="_blank">View OpenAPI 3.1 Specification &rarr;</a></p>
      <p><a href="/schema.graphql" target="_blank">View GraphQL Schema SDL &rarr;</a></p>
    </div>
    <div class="card">
      <h2>UIDL Screen Documents</h2>
      <p style="margin-bottom: 12px; font-size: 13px;">Targeting <code>@kerangka/uidl-runtime</code>:</p>
      <ul>
        ${views.map(v => `<li><a href="/uidl/${v}" target="_blank">/uidl/${v}</a></li>`).join("")}
      </ul>
    </div>
    <div class="card">
      <h2>Model Context Protocol (MCP)</h2>
      <p style="margin-bottom: 12px; font-size: 13px;">Exported tools for AI coding agents:</p>
      <ul style="max-height: 240px; overflow-y: auto;">
        ${mcpToolList}
      </ul>
      <p style="margin-top: 12px;"><a href="/api/mcp/tools" target="_blank">Inspect MCP Tools JSON &rarr;</a></p>
    </div>
  </div>
</body>
</html>`;
  }
}
