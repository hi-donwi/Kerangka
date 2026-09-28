/**
 * Kerangka Zero-Config Development & API Server
 * Specification Version: 0.2
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
  UIDLDocument,
} from "@kerangka/compiler";
import {
  StorePort,
  MemoryStore,
  VersionConflictError,
  ConnectorsPort,
  DefaultConnectors,
  SchedulerPort,
  StoreScheduler,
  ScheduledJob,
} from "@kerangka/ports";
import { Engine, Effect } from "@kerangka/engine-ts";
import { SchedulerRunner } from "./scheduler-runner.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  store?: StorePort;
  connectors?: ConnectorsPort;
  scheduler?: SchedulerPort;
  enableSchedulerRunner?: boolean;
  runnerPollIntervalMs?: number;
  quiet?: boolean;
}

export class KerangkaServer {
  readonly kir: KIRDocument;
  readonly port: number;
  readonly host: string;
  readonly store: StorePort;
  readonly connectors: ConnectorsPort;
  readonly scheduler: SchedulerPort;
  readonly runner: SchedulerRunner;
  readonly engine: Engine;
  readonly openApiSpec: Record<string, unknown>;
  readonly graphqlSchema: string;
  readonly mcpTools: McpToolDefinition[];
  readonly uidlDocs: Record<string, UIDLDocument>;

  private httpServer: http.Server | null = null;
  private quiet: boolean;
  private enableSchedulerRunner: boolean;
  private idempotencyCache = new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>();

  constructor(kir: KIRDocument, options: ServerOptions = {}) {
    this.kir = kir;
    this.port = options.port || 3000;
    this.host = options.host || "localhost";
    this.quiet = options.quiet ?? false;
    this.enableSchedulerRunner = options.enableSchedulerRunner ?? false;
    this.store = options.store || new MemoryStore();
    this.connectors = options.connectors || new DefaultConnectors();
    this.scheduler = options.scheduler || new StoreScheduler(this.store);
    this.engine = new Engine(kir);

    this.runner = new SchedulerRunner({
      scheduler: this.scheduler,
      executeJob: async (job) => {
        await this.executeScheduledJob(job);
      },
      pollIntervalMs: options.runnerPollIntervalMs ?? 1000,
      onError: (err, job) => {
        if (!this.quiet) {
          console.warn(`[kerangka] Failed executing scheduled job '${job.id}' (${job.name}):`, err);
        }
      },
    });

    this.openApiSpec = generateOpenAPI(kir, {
      serverUrl: `http://${this.host}:${this.port}`,
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
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.sendProblem(res, 500, "Internal Server Error", message);
        }
      });

      this.httpServer.listen(this.port, this.host, () => {
        if (this.enableSchedulerRunner) {
          this.runner.start();
        }
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
    this.runner.stop();
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
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Idempotency-Key, X-Tenant-Id, X-Actor-Id, X-Actor-Roles, X-Expected-Version, If-Match"
    );

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
        this.sendJson(res, 200, { documents: Object.keys(this.uidlDocs) });
        return;
      }
      const docId = parts[1] || "";
      const doc = this.uidlDocs[docId];
      if (doc) {
        this.sendJson(res, 200, doc);
      } else {
        this.sendProblem(res, 404, "Not Found", `UIDL document '${docId}' not found.`, "NOT_FOUND");
      }
      return;
    }

    // REST API routes (/api/{entity}...)
    if (pathname.startsWith("/api/")) {
      await this.handleRestApi(req, res, pathname, method, url);
      return;
    }

    this.sendProblem(res, 404, "Not Found", `Route '${pathname}' not found.`, "NOT_FOUND");
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
      this.sendProblem(res, 404, "Not Found", "Missing entity in API route.", "NOT_FOUND");
      return;
    }

    const entityParam = parts[0] || "";
    const entityName = Object.keys(this.kir.entities || {}).find(
      (k) => k.toLowerCase() === entityParam.toLowerCase()
    );

    if (!entityName) {
      this.sendProblem(res, 404, "Entity Not Found", `Entity '${entityParam}' does not exist.`, "UNKNOWN_ENTITY");
      return;
    }

    // Idempotency check for mutating methods
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    if (idempotencyKey && (method === "POST" || method === "PUT" || method === "DELETE")) {
      const cached = this.idempotencyCache.get(idempotencyKey);
      if (cached) {
        res.setHeader("X-Cache-Lookup", "HIT");
        res.setHeader("X-Idempotent-Replayed", "true");
        this.sendJson(res, cached.status, cached.body);
        return;
      }
    }

    const tenantId = (req.headers["x-tenant-id"] as string | undefined) || url.searchParams.get("tenantId") || undefined;
    const actorId = req.headers["x-actor-id"] as string | undefined;
    const rolesHeader = req.headers["x-actor-roles"] as string | undefined;
    const actorRoles = rolesHeader ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean) : undefined;
    const actor = actorId || actorRoles || tenantId ? { id: actorId, roles: actorRoles ?? [], tenantId } : undefined;

    // Collection endpoint: /api/{entity}
    if (parts.length === 1) {
      if (method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const queryResult = await this.store.find(entityName, undefined, {
          limit,
          offset,
          tenantId,
        });
        res.setHeader("X-Total-Count", String(queryResult.total));
        this.sendJson(res, 200, queryResult.items);
        return;
      }

      if (method === "POST") {
        const body = await this.readJsonBody(req);

        // Validation
        const validation = this.engine.validate(entityName, body);
        if (!validation.valid) {
          this.sendProblem(
            res,
            422,
            "Validation Failed",
            "Record fails validation against entity rules and constraints",
            "INPUT_INVALID",
            validation.errors
          );
          return;
        }

        const entityDef = this.kir.entities[entityName];
        const keyField = entityDef?.key || "id";
        const id = body[keyField] || `${entityName.toLowerCase()}_${Date.now()}`;
        const recordWithComputed = this.engine.compute(entityName, { ...body, [keyField]: id });
        const created = await this.store.create(entityName, recordWithComputed, {
          tenantId,
          actor: actor?.id ? { id: actor.id } : undefined,
        });

        if (idempotencyKey) {
          this.idempotencyCache.set(idempotencyKey, { status: 201, body: created, headers: { "X-Idempotent-Replayed": "true" } });
        }

        this.sendJson(res, 201, created);
        return;
      }
    }

    // Item endpoint: /api/{entity}/{id}
    if (parts.length === 2) {
      const id = parts[1] || "";

      if (method === "GET") {
        const item = await this.store.get(entityName, id, { tenantId });
        if (!item) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`, "NOT_FOUND");
          return;
        }
        this.sendJson(res, 200, item);
        return;
      }

      if (method === "PUT") {
        const body = await this.readJsonBody(req);
        const existing = await this.store.get<Record<string, unknown>>(entityName, id, { tenantId });
        if (!existing) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`, "NOT_FOUND");
          return;
        }

        const rawExpectedVersion = (req.headers["if-match"] as string) || (req.headers["x-expected-version"] as string);
        const expectedVersion = rawExpectedVersion ? parseInt(rawExpectedVersion.replace(/"/g, ""), 10) : undefined;

        const merged = { ...existing, ...body };
        const validation = this.engine.validate(entityName, merged);
        if (!validation.valid) {
          this.sendProblem(
            res,
            422,
            "Validation Failed",
            "Updated record fails validation",
            "INPUT_INVALID",
            validation.errors
          );
          return;
        }

        const updatedWithCompute = this.engine.compute(entityName, merged);

        try {
          const updated = await this.store.update(entityName, id, updatedWithCompute, {
            tenantId,
            actor: actor?.id ? { id: actor.id } : undefined,
            expectedVersion: isNaN(expectedVersion as number) ? undefined : expectedVersion,
          });

          if (idempotencyKey) {
            this.idempotencyCache.set(idempotencyKey, { status: 200, body: updated, headers: { "X-Idempotent-Replayed": "true" } });
          }

          this.sendJson(res, 200, updated);
          return;
        } catch (err: unknown) {
          if (err instanceof VersionConflictError) {
            this.sendProblem(res, 409, "Version Conflict", err.message, "VERSION_CONFLICT");
            return;
          }
          throw err;
        }
      }

      if (method === "DELETE") {
        const soft = url.searchParams.get("soft") === "true";
        await this.store.delete(entityName, id, {
          tenantId,
          soft,
          actor: actor?.id ? { id: actor.id } : undefined,
        });
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
        const existing = await this.store.get<Record<string, unknown>>(entityName, id, { tenantId });
        if (!existing) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`, "NOT_FOUND");
          return;
        }

        const actionActor = actor ?? { id: "dev-user", roles: body.roles || ["admin", "billing"] };

        // Check if transition or custom action
        const entityDef = this.kir.entities[entityName];
        let result = this.engine.transition(entityName, existing, actionName, actionActor);

        if (!result.ok && entityDef?.actions?.[actionName]) {
          result = this.engine.executeAction(entityName, existing, actionName, body, actionActor);
        }

        if (!result.ok) {
          const status = result.error === "PERMISSION_DENIED" || result.error === "FORBIDDEN" ? 403 : 422;
          this.sendProblem(
            res,
            status,
            "Action Execution Failed",
            result.message || result.error || "Guard or validation failed.",
            result.code ?? result.error ?? "ACTION_FAILED"
          );
          return;
        }

        const updatedState = result.record || existing;
        await this.store.update(entityName, id, updatedState, {
          tenantId,
          actor: actionActor?.id ? { id: actionActor.id } : undefined,
        });

        // Dispatch side-effects (call, notify, timer, cancel-timer)
        await this.dispatchEffects(result.effects, entityName, id, tenantId);

        const resPayload = {
          ok: true,
          action: actionName,
          record: updatedState,
          events: result.events,
        };

        if (idempotencyKey) {
          this.idempotencyCache.set(idempotencyKey, { status: 200, body: resPayload, headers: { "X-Idempotent-Replayed": "true" } });
        }

        this.sendJson(res, 200, resPayload);
        return;
      }
    }

    this.sendProblem(res, 404, "Not Found", `No matching route for ${pathname}`, "NOT_FOUND");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleMcpCall(body: any): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const { name, arguments: args = {} } = body;
    try {
      if (name.startsWith("list_")) {
        const entityKey = name.replace("list_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for list tool: ${entityKey}`);

        const results = await this.store.find(entityName, args.filter, {
          limit: args.limit || 50,
          offset: args.offset || 0,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(results.items, null, 2) }],
        };
      }

      if (name.startsWith("get_")) {
        const entityKey = name.replace("get_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for get tool: ${entityKey}`);

        const item = await this.store.get(entityName, args.id);
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);
        return {
          content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
        };
      }

      if (name.startsWith("create_")) {
        const entityKey = name.replace("create_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for create tool: ${entityKey}`);

        const entityDef = this.kir.entities[entityName];
        const keyField = entityDef?.key || "id";
        const id = args[keyField] || `${entityName.toLowerCase()}_${Date.now()}`;
        const record = this.engine.compute(entityName, { ...args, [keyField]: id });
        const created = await this.store.create(entityName, record);
        return {
          content: [
            {
              type: "text",
              text: `Created ${entityName} with ID '${id}':\n${JSON.stringify(created, null, 2)}`,
            },
          ],
        };
      }

      if (name.startsWith("update_")) {
        const entityKey = name.replace("update_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for update tool: ${entityKey}`);

        const existing = await this.store.get(entityName, args.id);
        if (!existing) throw new Error(`${entityName} with id '${args.id}' not found.`);

        const updatedWithCompute = this.engine.compute(entityName, { ...existing, ...(args.patch || {}) });
        const updated = await this.store.update(entityName, args.id, updatedWithCompute);
        return {
          content: [
            {
              type: "text",
              text: `Updated ${entityName} '${args.id}':\n${JSON.stringify(updated, null, 2)}`,
            },
          ],
        };
      }

      if (name.startsWith("action_")) {
        const parts = name.replace("action_", "").split("_");
        const actionName = parts.pop()!;
        const entityKey = parts.join("_");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for action tool: ${entityKey}`);

        const item = await this.store.get(entityName, args.id);
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);

        const result = this.engine.run(entityName, actionName, item as Record<string, unknown>, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Action execution failed: ${result.message || result.error}` }],
          };
        }

        const updatedState = result.record || item;
        await this.store.update(entityName, args.id, updatedState as Record<string, unknown>);

        return {
          content: [
            {
              type: "text",
              text: `Action '${actionName}' executed successfully on ${entityName} ${args.id}.\nNew State:\n${JSON.stringify(
                updatedState,
                null,
                2
              )}`,
            },
          ],
        };
      }

      if (name.startsWith("transition_")) {
        const parts = name.replace("transition_", "").split("_");
        const actionName = parts.pop()!;
        const entityKey = parts.join("_");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for transition tool: ${entityKey}`);

        const item = await this.store.get(entityName, args.id);
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);

        const result = this.engine.transition(entityName, item as Record<string, unknown>, actionName, {
          id: "mcp-user",
          roles: ["admin"],
        });
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Transition failed: ${result.message || result.error}` }],
          };
        }

        const updatedState = result.record || item;
        await this.store.update(entityName, args.id, updatedState as Record<string, unknown>);
        await this.dispatchEffects(result.effects, entityName, String(args.id));

        return {
          content: [
            {
              type: "text",
              text: `Transition '${actionName}' executed successfully on ${entityName} ${args.id}.\nNew State:\n${JSON.stringify(
                updatedState,
                null,
                2
              )}`,
            },
          ],
        };
      }

      throw new Error(`Tool '${name}' is not recognized.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${message}` }],
      };
    }
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = status;
    res.end(JSON.stringify(data, null, 2));
  }

  private sendProblem(
    res: http.ServerResponse,
    status: number,
    title: string,
    detail: string,
    code?: string,
    errors?: unknown[]
  ): void {
    res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
    res.statusCode = status;
    const errorCode =
      code ??
      (status === 404
        ? "NOT_FOUND"
        : status === 403
        ? "FORBIDDEN"
        : status === 409
        ? "CONFLICT"
        : status === 422
        ? "INPUT_INVALID"
        : "INTERNAL_ERROR");

    const problem: Record<string, unknown> = {
      type: `https://kerangka.dev/errors/${errorCode}`,
      title,
      status,
      detail,
      code: errorCode,
    };
    if (errors && errors.length > 0) {
      problem.errors = errors;
    }
    res.end(JSON.stringify(problem, null, 2));
  }

  private sendHtml(res: http.ServerResponse, html: string): void {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    res.end(html);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        if (!data.trim()) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
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
    const mcpToolList = this.mcpTools
      .map((t) => `<li><code>${t.name}</code>: ${t.description}</li>`)
      .join("");

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
    <h1>${title} <span class="badge">v0.2</span></h1>
    <p>Kerangka Zero-Config Development & API Playground</p>
  </header>
  <div class="grid">
    <div class="card">
      <h2>Entities & REST APIs</h2>
      <ul>
        ${entities
          .map(
            (e) =>
              `<li><a href="/api/${e.toLowerCase()}">GET /api/${e.toLowerCase()}</a> <code>${e}</code></li>`
          )
          .join("")}
      </ul>
      <p style="margin-top: 16px;"><a href="/openapi.json" target="_blank">View OpenAPI 3.1 Specification &rarr;</a></p>
      <p><a href="/schema.graphql" target="_blank">View GraphQL Schema SDL &rarr;</a></p>
    </div>
    <div class="card">
      <h2>UIDL Screen Documents</h2>
      <p style="margin-bottom: 12px; font-size: 13px;">Targeting <code>@kerangka/uidl-runtime</code>:</p>
      <ul>
        ${views.map((v) => `<li><a href="/uidl/${v}" target="_blank">/uidl/${v}</a></li>`).join("")}
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

  private async dispatchEffects(
    effects: Effect[] | undefined,
    entityName: string,
    recordId?: string,
    tenantId?: string
  ): Promise<void> {
    if (!effects || effects.length === 0) return;

    for (const effect of effects) {
      if (effect.type === "call" && this.connectors) {
        const extDef = this.kir.extensions?.[effect.extension] as Record<string, unknown> | undefined;
        const targetConnector = (extDef?.connector as string) || effect.extension;
        const canHandle = typeof this.connectors.has === "function" ? this.connectors.has(targetConnector) : true;
        if (canHandle) {
          try {
            await this.connectors.call({
              connector: targetConnector,
              operation: (extDef?.operation as string) || "call",
              payload: {
                ...(extDef || {}),
                input: effect.input,
                ...(typeof effect.input === "object" ? effect.input : {}),
              },
              tenantId,
            });
          } catch (err) {
            if (!this.quiet) {
              console.warn(`[kerangka] Connector call '${targetConnector}' failed:`, err);
            }
          }
        }
      } else if (effect.type === "notify" && this.connectors) {
        const canEmail = typeof this.connectors.has === "function" ? this.connectors.has("email") : true;
        if (canEmail) {
          try {
            await this.connectors.call({
              connector: "email",
              operation: "send",
              payload: {
                to: effect.recipient,
                template: effect.template,
                params: effect.params,
              },
              tenantId,
            });
          } catch (err) {
            if (!this.quiet) {
              console.warn("[kerangka] Email notification failed:", err);
            }
          }
        }
      } else if (effect.type === "timer") {
        try {
          await this.scheduler.scheduleAt(effect.action, effect.at, effect.payload ?? {}, {
            target: effect.target || recordId,
            action: effect.action,
            tenantId,
          });
        } catch (err) {
          if (!this.quiet) {
            console.warn(`[kerangka] Failed to schedule timer '${effect.action}':`, err);
          }
        }
      } else if (effect.type === "cancel-timer") {
        try {
          if (this.scheduler.cancelByTarget) {
            await this.scheduler.cancelByTarget(effect.target || recordId || "", effect.action);
          }
        } catch (err) {
          if (!this.quiet) {
            console.warn(`[kerangka] Failed to cancel timer for target '${effect.target}':`, err);
          }
        }
      }
    }
  }

  async executeScheduledJob(job: ScheduledJob): Promise<void> {
    const actionFullName = job.action || (job.name.includes(".") ? job.name : undefined);
    if (!actionFullName) return;

    const [entityName, opName] = actionFullName.split(".");
    if (!entityName || !opName) return;

    const recordId = job.target;
    if (!recordId) return;

    const record = await this.store.get(entityName, recordId);
    if (!record) return;

    const systemActor = { id: "system", roles: ["system", "admin"] };
    const res = this.engine.run(entityName, opName, record, {}, systemActor);
    if (res.ok && res.record) {
      await this.store.update(entityName, recordId, res.record, {
        actor: { id: "system" },
      });
      if (res.effects && res.effects.length > 0) {
        await this.dispatchEffects(res.effects, entityName, recordId);
      }
    }
  }
}
