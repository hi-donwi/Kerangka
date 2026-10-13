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
import { CloudEvent, Effect, Engine, type ActorContext } from "@kerangka/engine-ts";
import { equalityConstraints, evaluateWhereInMemory } from "@kerangka/adapter-hono";
import { SchedulerRunner } from "./scheduler-runner.js";
import { SessionStoreLike } from "./session-store.js";
import type { HostEffectEntry, OutboxEntry } from "./session-store.js";
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
  /**
   * The actor a request acts as when it carries none (`X-Actor-*` headers, MCP `roles`).
   *
   * For a local playground only: `kerangka dev` sets it so the page can drive guarded actions
   * without a login. A deployed server leaves it unset, and a request with no actor holds no
   * role. It used to be implicit — every anonymous action ran as `admin` and `billing`, or as
   * whatever roles its body named.
   */
  devActor?: ActorContext;
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
/**
 * What `openDelivery` queued, so `settleDelivery` can find the entries again.
 *
 * The entries, not the ids, because the caller should not have to reconstruct which entry
 * belongs to which effect — the store already paired them.
 */
interface DeliveryReceipt {
  events: OutboxEntry[];
  effects: HostEffectEntry[];
}

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
 * One committed mutation to an entity, pushed over a change stream.
 *
 * Deliberately a *change notification*, not the new record: a subscribed list re-queries on the
 * event rather than patching itself from the payload, so it stays correct under filtering,
 * sorting and pagination it cannot see. `version` is the record's optimistic-concurrency token
 * when the store keeps one, so a client can skip a refresh it already has.
 */
export interface ChangeEvent {
  entity: string;
  operation: "create" | "update" | "delete" | "action";
  id: string;
  version?: number;
  /** Present when `operation` is `"action"`: the action or transition that ran. */
  action?: string;
  /** ISO-8601 commit time. */
  at: string;
}

/** One open `text/event-stream` connection following an entity. */
interface ChangeSubscriber {
  res: http.ServerResponse;
  /** When set, the subscriber only receives changes committed under the same tenant. */
  tenantId?: string;
}

function versionOf(record: unknown): number | undefined {
  if (record && typeof record === "object" && "version" in record) {
    const value = (record as Record<string, unknown>).version;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

function wantsEventStream(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept;
  return typeof accept === "string" && accept.includes("text/event-stream");
}

function parseSortParam(value: string | null): Record<string, "asc" | "desc"> | undefined {
  if (!value) return undefined;
  const sort: Record<string, "asc" | "desc"> = {};
  for (const clause of value.split(",")) {
    const [field, direction = "asc"] = clause.split(":", 2);
    if (!field || (direction !== "asc" && direction !== "desc")) return undefined;
    sort[field] = direction;
  }
  return Object.keys(sort).length > 0 ? sort : undefined;
}

function parseWhereParam(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

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

  /**
   * Live change subscribers, keyed by lower-cased entity name; each entry is one open
   * `text/event-stream`. A host follows a collection without polling, and the server pushes a
   * `ChangeEvent` after every committed mutation. Empty sets are deleted so a disconnected
   * client leaves nothing behind.
   */
  private changeStreams = new Map<string, Set<ChangeSubscriber>>();

  /** See `ServerOptions.devActor`. */
  private readonly devActor?: ActorContext;


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
    this.devActor = options.devActor;
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
    // End every change stream first: an open keep-alive response would otherwise hold the
    // server open past `close`.
    for (const subscribers of this.changeStreams.values()) {
      for (const subscriber of subscribers) {
        if (!subscriber.res.writableEnded) subscriber.res.end();
      }
    }
    this.changeStreams.clear();
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

    // Everything this server serves that the model does not describe, matched against the
    // one table that also says which of them belong in the document. See
    // `operational-openapi.ts`: a route cannot be served without being declared, and a route
    // excluded from the document carries the reason it is excluded.
    const operational = matchRoute(pathname, method, this.session !== null);
    if (operational) {
      await this.serveOperationalRoute(operational.route, operational.params, req, res, url);
      return;
    }

    // A route that needs a session, asked for by a client that guessed the path. The table
    // says which one it is; the answer says how to fix it.
    if (!this.session) {
      const unavailable = OPERATIONAL_ROUTES.find(
        (route) =>
          route.session === "required" && route.method === method && route.pattern.test(pathname)
      );
      if (unavailable) {
        const { code, detail } = unavailableFor(unavailable);
        this.sendProblem(res, 501, "Not Implemented", detail, code);
        return;
      }
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
    // A request that names no one (no id, no roles) acts as the dev actor when a playground set
    // one, in the tenant it asked for; otherwise it holds no role.
    const namesSomeone = Boolean(actorId || actorRoles);
    const actor: ActorContext | undefined = namesSomeone
      ? { id: actorId, roles: actorRoles ?? [], tenantId }
      : this.devActor
        ? { ...this.devActor, ...(tenantId ? { tenantId } : {}) }
        : tenantId
          ? { roles: [], tenantId }
          : undefined;

    // Collection endpoint: /api/{entity}
    if (parts.length === 1) {
      if (method === "GET") {
        if (!this.authorize(res, entityName, "read", actor, undefined, { listing: true })) return;
        const readScope = this.engine.authorizeRead(entityName, actor);
        if (!readScope.allowed) {
          this.sendProblem(res, 403, "Forbidden", readScope.reason ?? "Read denied.", readScope.code ?? "PERMISSION_DENIED");
          return;
        }

        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        const sort = parseSortParam(url.searchParams.get("sort"));
        const where = parseWhereParam(url.searchParams.get("where"));
        const search = url.searchParams.get("search") || undefined;
        const filter: Record<string, unknown> = {};
        for (const [key, value] of url.searchParams.entries()) {
          if (!["limit", "offset", "sort", "tenantId", "where", "search"].includes(key)) filter[key] = value;
        }

        if (readScope.where) {
          // The read filter references the actor, which a storage adapter has no context for:
          // push down only its equalities, then evaluate it here before paging (ADR-0040).
          const pushdown = { ...equalityConstraints(readScope.where, actor), ...filter };
          const found = await this.store.find(entityName, Object.keys(pushdown).length > 0 ? pushdown : undefined, {
            tenantId,
            sort,
            where,
            search,
          });
          const visible = evaluateWhereInMemory(found.items as Record<string, unknown>[], readScope.where, actor);
          res.setHeader("X-Total-Count", String(visible.length));
          this.sendJson(res, 200, visible.slice(offset, offset + limit));
          return;
        }

        const queryResult = await this.store.find(entityName, Object.keys(filter).length > 0 ? filter : undefined, {
          limit,
          offset,
          tenantId,
          sort,
          where,
          search,
        });
        res.setHeader("X-Total-Count", String(queryResult.total));
        this.sendJson(res, 200, queryResult.items);
        return;
      }

      if (method === "POST") {
        const body = await this.readJsonBody(req);
        if (!this.authorize(res, entityName, "create", actor, body)) return;

        // Validation
        const bodyWithDefaults = this.engine.applyDefaults(entityName, body, actor, new Date());
        const validation = this.engine.validate(entityName, bodyWithDefaults);
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
        const recordWithComputed = this.engine.compute(entityName, { ...bodyWithDefaults, [keyField]: id });
        const created = await this.store.create(entityName, recordWithComputed, {
          tenantId,
          actor: actor?.id ? { id: actor.id } : undefined,
        });

        if (idempotencyKey) {
          this.idempotencyCache.set(idempotencyKey, { status: 201, body: created, headers: { "X-Idempotent-Replayed": "true" } });
        }

        this.broadcastChange(entityName, { operation: "create", id, version: versionOf(created), tenantId });
        this.sendJson(res, 201, created);
        return;
      }
    }

    // Change stream: /api/{entity}/events, opened only when the client asks for
    // `text/event-stream`. The path has the same shape as an item read
    // (/api/{entity}/{id}), so an `Accept` header is what tells them apart — a record whose id is
    // literally `events` stays readable by a JSON client, and an EventSource (which always sends
    // `Accept: text/event-stream`) gets the live stream.
    if (parts.length === 2 && parts[1] === "events" && wantsEventStream(req)) {
      if (method !== "GET") {
        this.sendProblem(
          res,
          405,
          "Method Not Allowed",
          `Subscribe to ${entityName} changes with GET /api/${entityName}/events.`,
          "METHOD_NOT_ALLOWED"
        );
        return;
      }
      this.handleChangeStream(req, res, entityName, tenantId);
      return;
    }

    // Item endpoint: /api/{entity}/{id}
    if (parts.length === 2) {
      const id = parts[1] || "";

      if (method === "GET") {
        const item = await this.store.get<Record<string, unknown>>(entityName, id, { tenantId });
        if (!item) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`, "NOT_FOUND");
          return;
        }
        if (!this.authorizeRecordRead(res, entityName, actor, item)) return;
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
        // Decided against the record as stored, before the change, so a body cannot grant itself.
        if (!this.authorize(res, entityName, "update", actor, existing)) return;

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

          this.broadcastChange(entityName, { operation: "update", id, version: versionOf(updated), tenantId });
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
        const existing = await this.store.get<Record<string, unknown>>(entityName, id, { tenantId });
        if (!existing) {
          this.sendProblem(res, 404, "Not Found", `${entityName} with id '${id}' not found.`, "NOT_FOUND");
          return;
        }
        if (!this.authorize(res, entityName, "delete", actor, existing)) return;
        const soft = url.searchParams.get("soft") === "true";
        await this.store.delete(entityName, id, {
          tenantId,
          soft,
          actor: actor?.id ? { id: actor.id } : undefined,
        });
        this.broadcastChange(entityName, { operation: "delete", id, tenantId });
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

        // The actor is the request's, or the dev actor a playground opted into; never the body's.
        const actionActor = actor;

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

        // Queue what this run promised, then attempt it, then settle it. See
        // `openDelivery` for why the order is forced.
        const undelivered = await this.runWithDelivery(
          entityName,
          id,
          result.events,
          result.effects,
          tenantId
        );
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

        this.broadcastChange(entityName, {
          operation: "action",
          id,
          action: actionName,
          version: versionOf(updatedState),
          tenantId,
        });
        this.sendJson(res, 200, resPayload);
        return;
      }
    }

    this.sendProblem(res, 404, "Not Found", `No matching route for ${pathname}`, "NOT_FOUND");
  }

  /**
   * Writes the refusal and returns false when `actor` may not perform `operation` (ADR-0044).
   * A grant that depends on the record is decided against `record`; a list has no record to
   * decide it against without reading rows the actor may not see, so it is refused with the
   * advice to declare the condition as a readFilter (ADR-0040).
   */
  private authorize(
    res: http.ServerResponse,
    entityName: string,
    operation: string,
    actor: ActorContext | undefined,
    record?: Record<string, unknown>,
    options: { listing?: boolean } = {}
  ): boolean {
    const decision = this.permit(entityName, operation, actor, record, options);
    if (decision.allowed) return true;
    this.sendProblem(res, 403, "Forbidden", decision.reason, decision.code);
    return false;
  }

  /** The authorization decision itself, shared by REST and MCP. */
  private permit(
    entityName: string,
    operation: string,
    actor: ActorContext | undefined,
    record?: Record<string, unknown>,
    options: { listing?: boolean } = {}
  ): { allowed: true } | { allowed: false; code: string; reason: string } {
    const decision = this.engine.canOperate(entityName, operation, actor, record);
    if (decision.allowed) return { allowed: true };
    const reason =
      decision.code === "PERMISSION_NEEDS_RECORD" && options.listing
        ? `${decision.reason}; a list cannot apply a per-record read condition, so declare it as the entity's readFilter instead`
        : decision.reason ?? "Permission denied.";
    return { allowed: false, code: decision.code ?? "PERMISSION_DENIED", reason };
  }

  /** Whether `actor` may read this one record: its read permission, then its read filter. */
  private canReadRecord(
    entityName: string,
    actor: ActorContext | undefined,
    record: Record<string, unknown>
  ): { allowed: true } | { allowed: false; code: string; reason: string } {
    const permitted = this.permit(entityName, "read", actor, record);
    if (!permitted.allowed) return permitted;
    const scope = this.engine.authorizeRead(entityName, actor);
    if (!scope.allowed) {
      return { allowed: false, code: scope.code ?? "PERMISSION_DENIED", reason: scope.reason ?? "Read denied." };
    }
    if (scope.where && evaluateWhereInMemory([record], scope.where, actor).length === 0) {
      return { allowed: false, code: "PERMISSION_DENIED", reason: `Access to '${entityName}' is denied by its read filter.` };
    }
    return { allowed: true };
  }

  private authorizeRecordRead(
    res: http.ServerResponse,
    entityName: string,
    actor: ActorContext | undefined,
    record: Record<string, unknown>
  ): boolean {
    const decision = this.canReadRecord(entityName, actor, record);
    if (decision.allowed) return true;
    this.sendProblem(res, 403, "Forbidden", decision.reason, decision.code);
    return false;
  }

  /**
   * The actor an MCP call names in its arguments (`actorId`, `roles`, `tenantId`), or the dev
   * actor, or none. Never a default role: a tool call with no actor holds no role.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mcpActor(args: any): ActorContext | undefined {
    const roles = Array.isArray(args.roles) ? args.roles.filter((r: unknown): r is string => typeof r === "string") : undefined;
    const id = typeof args.actorId === "string" ? args.actorId : undefined;
    const tenantId = typeof args.tenantId === "string" ? args.tenantId : undefined;
    if (roles || id || tenantId) return { id, roles: roles ?? [], tenantId };
    return this.devActor;
  }

  /** Throws the refusal for an MCP tool, which reports it as `isError`. */
  private mcpRequire(decision: { allowed: true } | { allowed: false; code: string; reason: string }): void {
    if (!decision.allowed) throw new Error(`${decision.code}: ${decision.reason}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleMcpCall(body: any): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    const { name, arguments: args = {} } = body;
    const actor = this.mcpActor(args);
    try {
      if (name.startsWith("list_")) {
        const entityKey = name.replace("list_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for list tool: ${entityKey}`);

        this.mcpRequire(this.permit(entityName, "read", actor, undefined, { listing: true }));
        const scope = this.engine.authorizeRead(entityName, actor);
        if (!scope.allowed) throw new Error(`${scope.code ?? "PERMISSION_DENIED"}: ${scope.reason ?? "Read denied."}`);

        const limit = args.limit || 50;
        const offset = args.offset || 0;
        let items: unknown[];
        if (scope.where) {
          const pushdown = { ...equalityConstraints(scope.where, actor), ...(args.filter ?? {}) };
          const found = await this.store.find(entityName, Object.keys(pushdown).length > 0 ? pushdown : undefined, {
            tenantId: actor?.tenantId,
          });
          items = evaluateWhereInMemory(found.items as Record<string, unknown>[], scope.where, actor).slice(offset, offset + limit);
        } else {
          items = (await this.store.find(entityName, args.filter, { limit, offset, tenantId: actor?.tenantId })).items;
        }
        return {
          content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
        };
      }

      if (name.startsWith("get_")) {
        const entityKey = name.replace("get_", "");
        const entityName = Object.keys(this.kir.entities).find((k) => k.toLowerCase() === entityKey);
        if (!entityName) throw new Error(`Unknown entity for get tool: ${entityKey}`);

        const item = await this.store.get<Record<string, unknown>>(entityName, args.id, { tenantId: actor?.tenantId });
        if (!item) throw new Error(`${entityName} with id '${args.id}' not found.`);
        this.mcpRequire(this.canReadRecord(entityName, actor, item));
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
        const { roles: _roles, actorId: _actorId, tenantId: _tenantId, ...data } = args;
        const id = data[keyField] || `${entityName.toLowerCase()}_${Date.now()}`;
        this.mcpRequire(this.permit(entityName, "create", actor, { ...data, [keyField]: id }));
        // Held to the same rules as a REST create; this path used to store whatever it was given.
        const withDefaults = this.engine.applyDefaults(entityName, { ...data, [keyField]: id }, actor, new Date());
        const validation = this.engine.validate(entityName, withDefaults);
        if (!validation.valid) {
          throw new Error(`INPUT_INVALID: ${validation.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ")}`);
        }
        const record = this.engine.compute(entityName, withDefaults);
        const created = await this.store.create(entityName, record, { tenantId: actor?.tenantId });
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

        const existing = await this.store.get<Record<string, unknown>>(entityName, args.id, { tenantId: actor?.tenantId });
        if (!existing) throw new Error(`${entityName} with id '${args.id}' not found.`);
        this.mcpRequire(this.permit(entityName, "update", actor, existing));

        const merged = { ...existing, ...(args.patch || {}) };
        const validation = this.engine.validate(entityName, merged);
        if (!validation.valid) {
          throw new Error(`INPUT_INVALID: ${validation.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ")}`);
        }
        const updatedWithCompute = this.engine.compute(entityName, merged);
        const updated = await this.store.update(entityName, args.id, updatedWithCompute, { tenantId: actor?.tenantId });
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

        const { id: _id, roles: _r, actorId: _a, tenantId: _t, ...input } = args;
        const result = this.engine.run(entityName, actionName, item as Record<string, unknown>, input, actor);
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

        // The caller supplies the actor's roles, as the HTTP path does with the request
        // body. A hardcoded `["admin"]` meant an MCP tool could not drive any action the
        // model guards by role — and because the guard rejected it first, the run emitted
        // nothing, which is part of why its events going missing went unnoticed for so long.
        // A call that names no actor holds no role (the dev actor aside); this used to default
        // to admin, so any MCP client could drive any guarded transition.
        const { roles: _roles, actorId: _actorId, ...transitionArgs } = args as Record<string, unknown>;
        const result = this.engine.transition(
          entityName,
          item as Record<string, unknown>,
          actionName,
          actor
        );
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: `Transition failed: ${result.message || result.error}` }],
          };
        }

        const updatedState = result.record || item;
        await this.store.update(entityName, args.id, updatedState as Record<string, unknown>);
        // Queued and settled like the HTTP path. A tool call that emits an event used to
        // drop it: the effects were dispatched and nothing recorded what the run promised.
        const effectsFailed = await this.runWithDelivery(
          entityName,
          String(args.id),
          result.events,
          result.effects
        );

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
  private handlePlayground({ res, server }: OperationalContext): void {
    (server as KerangkaServer).sendHtml(res, (server as KerangkaServer).renderPlaygroundHtml());
  }

  private handleOpenApi({ res, server }: OperationalContext): void {
    (server as KerangkaServer).sendJson(res, 200, (server as KerangkaServer).openApiSpec);
  }

  private handleGraphQLSchema({ res, server }: OperationalContext): void {
    const owner = server as KerangkaServer;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.statusCode = 200;
    res.end(owner.graphqlSchema);
  }

  private handleListUidl({ res, server }: OperationalContext): void {
    (server as KerangkaServer).sendJson(res, 200, {
      documents: Object.keys((server as KerangkaServer).uidlDocs)
    });
  }

  private handleUidlDocument({ res, server, params }: OperationalContext): void {
    const owner = server as KerangkaServer;
    const docId = decodeURIComponent(params[0] ?? "");
    const doc = owner.uidlDocs[docId];
    if (!doc) {
      owner.sendProblem(res, 404, "Not Found", `UIDL document '${docId}' not found.`, "NOT_FOUND");
      return;
    }
    owner.sendJson(res, 200, doc);
  }

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

  /**
   * Subscribe one client to an entity's change feed.
   *
   * `text/event-stream` is a long-lived response: the connection stays open and the server
   * pushes a `change` event after every committed mutation. A `: ping` comment every 20s keeps
   * an idle proxy from closing it. The subscriber is removed when the socket closes, so a
   * dropped client leaks nothing; `stop()` ends the rest.
   */
  private handleChangeStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    entityName: string,
    tenantId?: string
  ): void {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Tells nginx and friends not to buffer the stream into uselessness.
    res.setHeader("X-Accel-Buffering", "no");
    res.statusCode = 200;
    res.flushHeaders?.();

    const key = entityName.toLowerCase();
    let subscribers = this.changeStreams.get(key);
    if (!subscribers) {
      subscribers = new Set<ChangeSubscriber>();
      this.changeStreams.set(key, subscribers);
    }
    const subscriber: ChangeSubscriber = { res, tenantId };
    subscribers.add(subscriber);

    res.write(`: connected to ${entityName} change stream\n\n`);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 20000);

    const cleanup = () => {
      clearInterval(heartbeat);
      subscribers.delete(subscriber);
      // Only the set that is still current may be removed: a later subscriber may have
      // registered a fresh set under the same key, and deleting by key alone would drop it.
      if (subscribers.size === 0 && this.changeStreams.get(key) === subscribers) {
        this.changeStreams.delete(key);
      }
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  /**
   * Push a change to everyone following the entity.
   *
   * `operation` is the committed act, not the record: a subscribed list re-queries on any of
   * them rather than guessing what to patch, so it stays correct under filtering, sorting and
   * pagination the payload cannot describe. `tenantId` scopes delivery — a subscriber bound to a
   * tenant never sees another tenant's change.
   */
  private broadcastChange(
    entityName: string,
    change: { operation: ChangeEvent["operation"]; id: string; version?: number; action?: string; tenantId?: string }
  ): void {
    const subscribers = this.changeStreams.get(entityName.toLowerCase());
    if (!subscribers || subscribers.size === 0) return;

    const event: ChangeEvent = {
      entity: entityName,
      operation: change.operation,
      id: change.id,
      ...(change.version !== undefined ? { version: change.version } : {}),
      ...(change.action !== undefined ? { action: change.action } : {}),
      at: new Date().toISOString(),
    };
    const frame = `event: change\ndata: ${JSON.stringify(event)}\n\n`;

    for (const subscriber of subscribers) {
      if (subscriber.tenantId !== undefined && subscriber.tenantId !== change.tenantId) continue;
      if (subscriber.res.writableEnded) continue;
      subscriber.res.write(frame);
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
   * Queue everything this run promised, before any of it is attempted.
   *
   * The order matters and it is forced. The record write has to come first, or a crash
   * between the two would leave a host performing effects for a write that never committed —
   * worse than losing them. The queue write has to come second and immediately, so the
   * window is two adjacent store calls rather than the whole dispatch.
   *
   * That is the whole point of this split. Before it, the window between the record write and
   * the queue write spanned `dispatchEffects`, which is every outbound connector call, timer
   * and email in the run. A connector that takes thirty seconds is a thirty-second window in
   * which a crash loses every event the run emitted and every effect it owed. Now the queue
   * holds the promise before the first attempt, so an interrupted dispatch leaves the effects
   * pending and a host can drain them.
   *
   * Not atomic with the record write, and it cannot be: the aggregate is in `StorePort` and
   * the queue is a session store with its own lifecycle. That limit is unchanged. What
   * changed is its size, and what survives a crash inside it.
   */
  private openDelivery(
    events: CloudEvent[] | undefined,
    effects: Effect[] | undefined,
    entityName: string
  ): DeliveryReceipt | null {
    if (!this.session) return null;
    try {
      // Events and effects in one transaction: they are one fact about what the run
      // promised, and a half-recorded promise is the thing an outbox exists to prevent.
      const queued = this.session.enqueueDelivery(events, effects, entityName);
      return { events: queued.events, effects: queued.effects };
    } catch (err) {
      // The queue is a second store and can fail on its own. Losing it must not lose the
      // run's own outcome, which is already written and already being returned.
      if (!this.quiet) {
        console.warn("[kerangka] Failed to record this run's events and effects:", err);
      }
      return null;
    }
  }

  /**
   * Settle what the dispatch managed: delivered effects are acknowledged, failures keep
   * their entry pending with a reason and a counted attempt.
   *
   * The queue's entries are in the same order as the effects that produced them, and
   * `UndeliveredEffect` carries the index of the effect it is about, so the two are matched
   * by position rather than by a second id scheme that could disagree.
   */
  private settleDelivery(receipt: DeliveryReceipt | null, undelivered: UndeliveredEffect[]): void {
    if (!receipt || !this.session) return;
    const failedAt = new Map(undelivered.map((failure) => [failure.index, failure.code]));

    for (const [index, entry] of receipt.effects.entries()) {
      const code = failedAt.get(index);
      if (code) this.session.nackEffect(entry.id, code);
      else this.session.ackEffect(entry.id);
    }
  }

  /**
   * Dispatch a run's effects with the queue open around it.
   *
   * Both action paths — HTTP and MCP — go through here, so neither can queue an event it
   * then drops: the MCP path used to dispatch and discard, which lost every event a tool
   * call emitted.
   */
  private async runWithDelivery(
    entityName: string,
    recordId: string | undefined,
    events: CloudEvent[] | undefined,
    effects: Effect[] | undefined,
    tenantId?: string
  ): Promise<UndeliveredEffect[]> {
    const receipt = this.openDelivery(events, effects, entityName);
    const undelivered = await this.dispatchEffects(effects, entityName, recordId, tenantId);
    this.settleDelivery(receipt, undelivered);
    return undelivered;
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
      // Keyed on either, not on effects alone: a job that emits an event and performs no
      // host effect still promised something, and the old condition dropped it on the floor.
      if ((res.effects && res.effects.length > 0) || (res.events && res.events.length > 0)) {
        await this.runWithDelivery(entityName, recordId, res.events, res.effects);
      }
    }
  }
}
