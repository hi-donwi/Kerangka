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
import { CloudEvent, Effect, Engine } from "@kerangka/engine-ts";
import { SchedulerRunner } from "./scheduler-runner.js";
import { SessionStoreLike } from "./session-store.js";
import {
  matchRoute,
  unavailableFor,
  operationalOpenAPI,
  OPERATIONAL_ROUTES,
  type OperationalRoute,
  type OperationalContext
} from "./operational-openapi.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  store?: StorePort;
  connectors?: ConnectorsPort;
  /**
   * A sidecar session to record effects this deployment could not deliver into.
   *
   * Separate from `store` on purpose. `StorePort` persists aggregates — it is the database
   * adapter boundary of ADR-0017 and knows nothing about an outbox, a queue, or a host. The
   * sidecar already has that machinery in `SessionStoreLike`, including `ack`/`nack` and a
   * durable implementation, so the HTTP path borrows it rather than growing a second one.
   *
   * Without it the server still works and still reports `effectsFailed` in the response; the
   * failures are simply not queued, so a restart loses them.
   */
  session?: SessionStoreLike;
  scheduler?: SchedulerPort;
  enableSchedulerRunner?: boolean;
  runnerPollIntervalMs?: number;
  quiet?: boolean;
}

/**
 * An effect a run asked for and the host could not deliver.
 *
 * `index` lines the failure up with the run's effect list, so a caller holding a trace can
 * say which effect it was. It is the effect's position, not a durable id: the sidecar mints
 * durable ids in the session store, and this transport has no such store.
 */
export interface FailedEffect {
  index: number;
  type: Effect["type"];
  /** The connector, action, or timer target the effect was aimed at. */
  target?: string;
  code: "EFFECT_NOT_APPLIED" | "EFFECT_UNHANDLED";
}

/**
 * A failure and the effect behind it.
 *
 * The response carries only the `FailedEffect` half, because the contract declares four
 * fields and `additionalProperties: false`. The effect is what gets queued when a session
 * store is configured, so a host can drain and retry the real thing rather than a
 * description of it.
 */
interface UndeliveredEffect extends FailedEffect {
  effect: Effect;
}

/** The client-facing half, with the effect stripped. */
const reportable = ({ index, type, target, code }: UndeliveredEffect): FailedEffect => ({
  index,
  type,
  target,
  code
});

/**
 * Add the routes the server serves that the model does not describe.
 *
 * The emitter's document is about the model; this server is about a running deployment, and
 * a document a client fetches from a running server has to describe the running server. The
 * queue routes appear only when a session is configured, because a path this deployment
 * cannot serve should not be advertised.
 */
function withOperationalRoutes(
  spec: Record<string, unknown>,
  withQueues: boolean
): Record<string, unknown> {
  const extra = operationalOpenAPI(withQueues);
  const paths = (spec.paths ?? {}) as Record<string, unknown>;
  const components = (spec.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;
  return {
    ...spec,
    paths: { ...paths, ...extra.paths },
    components: {
      ...components,
      schemas: { ...schemas, ...extra.schemas }
    }
  };
}

export class KerangkaServer {
  readonly kir: KIRDocument;
  readonly port: number;
  readonly host: string;
  readonly store: StorePort;
  readonly connectors: ConnectorsPort;
  readonly scheduler: SchedulerPort;
  /** Optional: where undelivered effects are queued for a host to drain. */
  readonly session: SessionStoreLike | null;
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
    this.session = options.session ?? null;
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

    this.openApiSpec = withOperationalRoutes(
      generateOpenAPI(kir, { serverUrl: `http://${this.host}:${this.port}` }),
      this.session !== null
    );
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

    // Operational routes, matched against the one table that also describes them. See
    // `operational-openapi.ts`: the document a client fetches and the routes this router
    // serves come from the same declaration, so neither can drift from the other.
    const operational = matchRoute(pathname, method, this.session !== null);
    if (operational) {
      await this.serveOperationalRoute(operational.route, operational.params, req, res, url);
      return;
    }

    // A route that needs a session, asked for by a client that guessed the path. The table
    // says which one it is; the answer says how to fix it.
    if (!this.session) {
      const unavailable = OPERATIONAL_ROUTES.find(
        (route) => route.session === "required" && route.pattern.test(pathname) && route.method === method
      );
      if (unavailable) {
        const { code, detail } = unavailableFor(unavailable);
        this.sendProblem(res, 501, "Not Implemented", detail, code);
        return;
      }
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
        const undelivered = await this.dispatchEffects(result.effects, entityName, id, tenantId);
        this.recordDelivery(result.events, undelivered, entityName);
        const effectsFailed = undelivered.map(reportable);

        // Present only when something was not delivered, so a successful run's response is
        // byte-for-byte what it was before this was added. A caller that does not read it
        // is unaffected; a caller that needs to know the email did not go out now can.
        const resPayload: {
          ok: boolean;
          action: string;
          record: unknown;
          events: unknown;
          effectsFailed?: FailedEffect[];
        } = {
          ok: true,
          action: actionName,
          record: updatedState,
          events: result.events,
        };
        if (effectsFailed.length > 0) resPayload.effectsFailed = effectsFailed;

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
        const effectsFailed = await this.dispatchEffects(result.effects, entityName, String(args.id));

        return {
          content: [
            {
              type: "text",
              text:
                `Transition '${actionName}' executed successfully on ${entityName} ${args.id}.\nNew State:\n${JSON.stringify(
                  updatedState,
                  null,
                  2
                )}` +
                // The aggregate is written and that is not in doubt. What is in doubt is
                // whether the side effect happened, and a tool result that says only
                // "successfully" is what this gap looked like from the outside.
                (effectsFailed.length > 0
                  ? `\nNot delivered: ${effectsFailed
                      .map((f) => `${f.type}${f.target ? ` to ${f.target}` : ""} (${f.code})`)
                      .join(", ")}`
                  : ""),
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

  /**
   * Serve one operational route, named by the table.
   *
   * The 501 lives here rather than in each handler, because it is the same answer for every
   * route that needs a session and it is a property of the deployment rather than of the
   * route. `unavailableFor` supplies the code and the message from the table, so a route
   * cannot answer with a code its own description does not mention.
   */
  /** What a handler is given: the route it is serving, and the request's own parts. */
  private operationalContext(
    route: OperationalRoute,
    params: string[],
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): OperationalContext {
    return { route, params, req, res, url, session: this.session, server: this };
  }

  private handleMcpTools({ res, server }: OperationalContext): void {
    this.sendJson(res, 200, { tools: (server as KerangkaServer).mcpTools });
  }

  private async handleMcpCallRoute({ req, res }: OperationalContext): Promise<void> {
    const body = await this.readJsonBody(req);
    this.sendJson(res, 200, await this.handleMcpCall(body));
  }

  private handleListEvents({ res, session }: OperationalContext): void {
    this.sendJson(res, 200, { events: session!.pending() });
  }

  private handleListEffects({ res, session, url }: OperationalContext): void {
    this.sendJson(res, 200, {
      effects: session!.pendingEffects(url.searchParams.get("type") ?? undefined)
    });
  }

  private async handleEventSettlement(
    { route, params, req, res, session }: OperationalContext
  ): Promise<void> {
    // The pattern captures only the id; `ack` or `nack` is in the route's own path, so the
    // two settlement routes differ by name and not by a captured segment.
    const action = route.path.endsWith("/nack") ? "nack" : "ack";
    const id = decodeURIComponent(params[0] ?? "");
    // Read for the `nack` reason only; an empty body is `{}`, so `ack` needs no read.
    const body = action === "nack" ? await this.readJsonBody(req) : {};
    const entry =
      action === "ack"
        ? session!.ack(id)
        : session!.nack(id, typeof body?.error === "string" ? body.error : undefined);
    if (!entry) {
      this.sendProblem(res, 404, "Not Found", `No queued event '${id}'.`, "EVENT_NOT_FOUND");
      return;
    }
    this.sendJson(res, 200, { event: entry });
  }

  private async handleEffectSettlement(
    { route, params, req, res, session }: OperationalContext
  ): Promise<void> {
    const action = route.path.endsWith("/nack") ? "nack" : "ack";
    const id = decodeURIComponent(params[0] ?? "");
    const body = action === "nack" ? await this.readJsonBody(req) : {};
    const entry =
      action === "ack"
        ? session!.ackEffect(id)
        : session!.nackEffect(id, typeof body?.error === "string" ? body.error : undefined);
    if (!entry) {
      this.sendProblem(res, 404, "Not Found", `No queued effect '${id}'.`, "EFFECT_NOT_FOUND");
      return;
    }
    this.sendJson(res, 200, { effect: entry });
  }

  /**
   * Serve one operational route, by the name the table gives it.
   *
   * The 501 lives here rather than in each handler, because it is the same answer for every
   * route that needs a session and it is a property of the deployment rather than of the
   * route. `unavailableFor` supplies the code and the message from the table, so a route
   * cannot answer with a code its own description does not mention.
   */
  private async serveOperationalRoute(
    route: OperationalRoute,
    params: string[],
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    if (route.session === "required" && !this.session) {
      const { code, detail } = unavailableFor(route);
      this.sendProblem(res, 501, "Not Implemented", detail, code);
      return;
    }

    const context = this.operationalContext(route, params, req, res, url);
    const handler = (this as unknown as Record<string, unknown>)[route.handler];
    if (typeof handler !== "function") {
      // Unreachable while every name in the table resolves, and a test proves it. A route
      // declared without a handler must fail loudly, not serve a 200 with no body.
      this.sendProblem(
        res,
        500,
        "Internal Server Error",
        `No handler for the declared route ${route.path}.`,
        "OPERATIONAL_ROUTE_UNHANDLED"
      );
      return;
    }
    await (handler as (context: OperationalContext) => void | Promise<void>).call(this, context);
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

  /**
   * Everything that was asked for and did not happen.
   *
   * Two codes, because they are not the same fault and a caller should not have to guess:
   * `EFFECT_UNHANDLED` means nothing in this deployment can perform the effect — the model
   * asks for an extension no connector is registered for. `EFFECT_NOT_APPLIED` means it was
   * attempted and failed. Both used to be a `console.warn` and nothing else, so a run whose
   * invoice email never went out answered `ok: true` and the only evidence was a log line
   * nobody was reading.
   *
   * The reason stays in the log. A connector error can carry an endpoint URL or a response
   * body, and this shape goes to an HTTP client, so the caller learns which effect failed
   * and where it was aimed, not what the failed call said.
   */
  private async dispatchEffects(
    effects: Effect[] | undefined,
    entityName: string,
    recordId?: string,
    tenantId?: string
  ): Promise<UndeliveredEffect[]> {
    const failed: UndeliveredEffect[] = [];
    if (!effects || effects.length === 0) return failed;

    for (const [index, effect] of effects.entries()) {
      if (effect.type === "call" && this.connectors) {
        const extDef = this.kir.extensions?.[effect.extension] as Record<string, unknown> | undefined;
        const targetConnector = (extDef?.connector as string) || effect.extension;
        const canHandle = typeof this.connectors.has === "function" ? this.connectors.has(targetConnector) : true;
        if (!canHandle) {
          failed.push({ index, type: effect.type, target: targetConnector, code: "EFFECT_UNHANDLED", effect });
        } else {
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
            failed.push({ index, type: effect.type, target: targetConnector, code: "EFFECT_NOT_APPLIED", effect });
            if (!this.quiet) {
              console.warn(`[kerangka] Connector call '${targetConnector}' failed:`, err);
            }
          }
        }
      } else if (effect.type === "notify" && this.connectors) {
        const canEmail = typeof this.connectors.has === "function" ? this.connectors.has("email") : true;
        if (!canEmail) {
          failed.push({ index, type: effect.type, target: "email", code: "EFFECT_UNHANDLED", effect });
        } else {
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
            failed.push({ index, type: effect.type, target: "email", code: "EFFECT_NOT_APPLIED", effect });
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
          failed.push({ index, type: effect.type, target: effect.action, code: "EFFECT_NOT_APPLIED", effect });
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
          failed.push({
            index,
            type: effect.type,
            target: effect.target,
            code: "EFFECT_NOT_APPLIED",
            effect
          });
          if (!this.quiet) {
            console.warn(`[kerangka] Failed to cancel timer for target '${effect.target}':`, err);
          }
        }
      }
    }

    return failed;
  }

  /**
   * Put the effects this run could not deliver where a host will find them.
   *
   * Not atomic with the write, and it cannot be: the aggregate is already stored through
   * `StorePort` and the queue is a different store with a different lifecycle. So a crash
   * in the window between the two still loses the effect. What changes is everything else —
   * the failure is now something a host can drain, retry and acknowledge, instead of a log
   * line that named a problem nobody could act on.
   */
  private recordDelivery(
    events: CloudEvent[] | undefined,
    undelivered: UndeliveredEffect[],
    entityName: string
  ): void {
    if (!this.session) return;
    try {
      // Both halves in one transaction: the events this run emitted and the effects it
      // could not deliver are one fact about what the run promised. The record write is
      // still a separate store and a separate moment — that window is ADR-0034's stated
      // limit — but nothing inside the queue is left half-recorded.
      this.session.enqueueDelivery(
        events,
        undelivered.map((failure) => failure.effect),
        entityName
      );
    } catch (err) {
      // The queue is a second store and can fail on its own. Losing that must not lose
      // the run's own outcome, and the caller is already being told about the effects.
      if (!this.quiet) {
        console.warn("[kerangka] Failed to record this run's events and undelivered effects:", err);
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
        this.recordDelivery(
          res.events,
          await this.dispatchEffects(res.effects, entityName, recordId),
          entityName
        );
      }
    }
  }
}
