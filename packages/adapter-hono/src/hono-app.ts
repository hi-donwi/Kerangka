/**
 * Kerangka Hono HTTP Adapter
 * Specification Version: 0.3
 * Status: Draft
 * License: Apache-2.0
 */

import { Hono, Context } from "hono";
import {
  generateGraphQL,
  generateMcpTools,
  generateOpenAPI,
  generateUIDL,
  KIRDocument,
  McpToolDefinition,
  UIDLDocument,
} from "@kerangka/compiler";
import { ActorContext, Engine } from "@kerangka/engine-ts";
import {
  BusPort,
  ConnectorsPort,
  MemoryStore,
  StorePort,
  VersionConflictError,
  SchedulerPort,
  StoreScheduler,
} from "@kerangka/ports";
import { createProblemDetails, ProblemDetails } from "./problem.js";
import {
  applyOrderBy,
  applySelect,
  equalityConstraints,
  evaluateWhereInMemory,
  QueryEvaluationError,
} from "./query-eval.js";
import {
  CachedResponse,
  computeRequestFingerprint,
  IdempotencyStore,
  MemoryIdempotencyStore,
} from "./idempotency.js";
import { buildNextCursor, decodeCursor, parseSortParam } from "./cursor.js";

export interface KerangkaHonoOptions {
  store?: StorePort;
  engine?: Engine;
  bus?: BusPort;
  connectors?: ConnectorsPort;
  scheduler?: SchedulerPort;
  idempotencyStore?: IdempotencyStore;
  serverUrl?: string;
  cors?: boolean;
}

export function createKerangkaHonoApp(kir: KIRDocument, options: KerangkaHonoOptions = {}): Hono {
  const app = new Hono();

  // An unhandled fault answers with the same Problem Details shape as every other error here,
  // and says nothing about what went wrong. Both halves matter: this adapter promises RFC 9457
  // on every response, and the message of an internal throw is a connection string, a path, or a
  // fragment of SQL. `QueryEvaluationError` exists so a bad *query* can still be named as one —
  // without it, the query handler's own `catch` had to answer 422 for everything, which is how a
  // dangling import ended up described to the client as a malformed request.
  app.onError((err, c) => {
    const detail =
      err instanceof QueryEvaluationError ? err.message : "The request could not be completed.";
    return sendProblem(c, 500, "INTERNAL_ERROR", detail);
  });

  const store = options.store ?? new MemoryStore();
  const engine = options.engine ?? new Engine(kir);
  const bus = options.bus;
  const connectors = options.connectors;
  const scheduler = options.scheduler ?? new StoreScheduler(store);
  const idempotencyStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
  const serverUrl = options.serverUrl ?? "http://localhost:3000";

  const openApiSpec = generateOpenAPI(kir, { serverUrl });
  const graphqlSchema = generateGraphQL(kir);
  const mcpTools: McpToolDefinition[] = generateMcpTools(kir);
  const uidlDocs: Record<string, UIDLDocument> = generateUIDL(kir);

  // ---------------------------------------------------------------------------
  // CORS & Global Headers
  // ---------------------------------------------------------------------------
  if (options.cors !== false) {
    app.use("*", async (c, next) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key, X-Tenant-Id, X-Actor-Id, X-Actor-Roles, X-Expected-Version, If-Match"
      );
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
      return await next();
    });
  }

  // ---------------------------------------------------------------------------
  // Helper functions
  // ---------------------------------------------------------------------------

  function sendProblem(
    c: Context,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: any,
    code: string,
    detail?: string,
    errors?: unknown[]
  ): Response {
    const problem: ProblemDetails = createProblemDetails({
      status,
      code,
      detail,
      instance: status === 403 ? undefined : c.req.path,
      errors,
    });
    return c.json(problem, status, {
      "Content-Type": "application/problem+json; charset=utf-8",
    });
  }

  function getTenantId(c: Context): string | undefined {
    return c.req.header("X-Tenant-Id") || c.req.query("tenantId") || undefined;
  }

  function getActorContext(c: Context): ActorContext | undefined {
    const actorId = c.req.header("X-Actor-Id");
    const rolesHeader = c.req.header("X-Actor-Roles");
    const roles = rolesHeader ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean) : undefined;
    const tenantId = getTenantId(c);
    if (!actorId && !roles && !tenantId) return undefined;
    return {
      id: actorId,
      roles: roles ?? [],
      tenantId,
    };
  }

  function resolveEntityName(entityParam: string): string | null {
    return (
      Object.keys(kir.entities || {}).find(
        (k) => k.toLowerCase() === entityParam.toLowerCase()
      ) ?? null
    );
  }

  async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
    return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  function toQueryOptionsSort(
    orderBy: Array<{ field: string; direction: "asc" | "desc" }> | undefined
  ): Record<string, "asc" | "desc"> | undefined {
    if (!orderBy || orderBy.length === 0) return undefined;
    const sort: Record<string, "asc" | "desc"> = {};
    for (const { field, direction } of orderBy) {
      sort[field] = direction;
    }
    return sort;
  }

  /**
   * Idempotency gate for mutating endpoints (PLAN.md §8.4: `Idempotency-Key` support).
   * Replays the original response (with its original status) for identical retries,
   * rejects key reuse with a different payload, and rejects concurrent duplicates.
   */
  async function beginIdempotentRequest(
    c: Context,
    method: string
  ): Promise<Response | null> {
    const key = c.req.header("Idempotency-Key");
    if (!key) return null;

    const fingerprint = computeRequestFingerprint(method, c.req.path, await readJsonBody(c));
    const begin = idempotencyStore.begin?.bind(idempotencyStore);

    if (!begin) {
      // Store without begin(): replay completed responses only.
      const cached = await idempotencyStore.get(key);
      if (cached) {
        c.header("X-Cache-Lookup", "HIT");
        return c.json(cached.body, cached.status as 200, cached.headers);
      }
      return null;
    }

    const outcome = await begin(key, fingerprint);
    switch (outcome.kind) {
      case "replay": {
        c.header("X-Cache-Lookup", "HIT");
        c.header("X-Idempotent-Replayed", "true");
        return c.json(outcome.res.body, outcome.res.status as 200, outcome.res.headers);
      }
      case "conflict":
        return sendProblem(
          c,
          422,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request payload"
        );
      case "in-flight":
        return sendProblem(
          c,
          409,
          "IDEMPOTENCY_IN_PROGRESS",
          "A request with this Idempotency-Key is still being processed; retry after it completes"
        );
      default:
        return null;
    }
  }

  async function completeIdempotentRequest(
    c: Context,
    status: number,
    body: unknown
  ): Promise<void> {
    const key = c.req.header("Idempotency-Key");
    if (!key) return;
    const cached: CachedResponse = {
      status,
      headers: { "X-Idempotent-Replayed": "true" },
      body,
      timestamp: Date.now(),
    };
    if (idempotencyStore.complete) {
      await idempotencyStore.complete(key, cached);
    } else {
      await idempotencyStore.set(key, cached);
    }
  }

  async function failIdempotentRequest(c: Context): Promise<void> {
    const key = c.req.header("Idempotency-Key");
    if (key && idempotencyStore.fail) await idempotencyStore.fail(key);
  }

  // ---------------------------------------------------------------------------
  // Metadata & System Endpoints
  // ---------------------------------------------------------------------------

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/livez", (c) => c.json({ status: "ok" }));

  app.get("/openapi.json", (c) => c.json(openApiSpec));

  app.get("/schema.graphql", (c) => {
    return c.text(graphqlSchema, 200, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  });

  app.get("/api/mcp/tools", (c) => c.json({ tools: mcpTools }));

  app.post("/api/mcp/call", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, arguments: toolArgs } = body as { name: string; arguments?: Record<string, unknown> };

    if (!name) {
      return sendProblem(c, 400, "INPUT_INVALID", "Missing 'name' in MCP call payload");
    }

    const [entityNameParam, opName] = name.split(".");
    const entityName = entityNameParam ? resolveEntityName(entityNameParam) : null;

    if (!entityName || !opName) {
      return sendProblem(c, 404, "NOT_FOUND", `Tool '${name}' not recognized`);
    }

    const actor = getActorContext(c);
    const tenantId = getTenantId(c);

    try {
      const result = engine.run(entityName, opName, toolArgs?.record as Record<string, unknown> ?? {}, toolArgs ?? {}, actor);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return sendProblem(c, 500, "EXECUTION_ERROR", message);
    }
  });

  app.get("/uidl", (c) => c.json({ documents: Object.keys(uidlDocs) }));

  app.get("/uidl/:docId", (c) => {
    const docId = c.req.param("docId");
    const doc = uidlDocs[docId];
    if (!doc) {
      return sendProblem(c, 404, "NOT_FOUND", `UIDL document '${docId}' not found`);
    }
    return c.json(doc);
  });

  // ---------------------------------------------------------------------------
  // REST Collection Endpoints: /api/:entity
  // ---------------------------------------------------------------------------

  app.get("/api/:entity", async (c) => {
    const entityParam = c.req.param("entity");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const actor = getActorContext(c);
    const tenantId = getTenantId(c);

    const canRead = engine.canOperate(entityName, "read", actor);
    if (!canRead.allowed) {
      return sendProblem(c, 403, canRead.code ?? "PERMISSION_DENIED", canRead.reason);
    }

    const readScope = engine.authorizeRead(entityName, actor);
    if (!readScope.allowed) {
      return sendProblem(c, 403, readScope.code ?? "PERMISSION_DENIED", readScope.reason);
    }

    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50;
    const sort = parseSortParam(c.req.query("sort"));
    const cursor = decodeCursor(c.req.query("cursor"));

    // A cursor carries the offset and echoes the sort contract it was minted under.
    const offset = cursor ? cursor.offset : c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : 0;
    const effectiveSort = cursor?.sort ?? sort;

    const queryParams = c.req.query();
    const filter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      if (["limit", "offset", "sort", "cursor", "tenantId"].includes(k)) continue;
      filter[k] = v;
    }

    const pushdown: Record<string, unknown> = {
      ...equalityConstraints(readScope.where, actor),
      ...filter,
    };
    if (tenantId) pushdown.tenantId = tenantId;

    let records: Record<string, unknown>[];
    let total: number;

    if (readScope.where) {
      const res = await store.find(entityName, Object.keys(pushdown).length > 0 ? pushdown : undefined, {
        sort: effectiveSort,
        tenantId,
        where: readScope.where,
      });

      records = evaluateWhereInMemory(
        res.items as Record<string, unknown>[],
        readScope.where,
        actor
      );
      total = records.length;
      records = records.slice(offset, offset + limit);
    } else {
      const res = await store.find(entityName, Object.keys(pushdown).length > 0 ? pushdown : undefined, {
        limit,
        offset,
        sort: effectiveSort,
        tenantId,
      });
      records = res.items as Record<string, unknown>[];
      total = res.total;
    }

    c.header("X-Total-Count", String(total));

    const links = buildNextCursor({
      items: records,
      limit,
      total,
      offset,
      sort: effectiveSort,
      makeUrl: (cursorValue: string) => cursorValue,
    });

    return c.json({
      items: records,
      total,
      limit,
      offset,
      // Opaque cursor token; clients pass it back as ?cursor= on the next request.
      ...(links.next ? { nextCursor: links.next } : {}),
    });
  });

  app.post("/api/:entity", async (c) => {
    const entityParam = c.req.param("entity");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const actor = getActorContext(c);
    const canCreate = engine.canOperate(entityName, "create", actor);
    if (!canCreate.allowed) {
      return sendProblem(c, 403, canCreate.code ?? "PERMISSION_DENIED", canCreate.reason);
    }

    // Idempotency gate
    const gated = await beginIdempotentRequest(c, "POST");
    if (gated) return gated;

    try {
      const tenantId = getTenantId(c);
      const body = await readJsonBody(c);

      // Validation
      const validation = engine.validate(entityName, body);
      if (!validation.valid) {
        return sendProblem(
          c,
          422,
          "INPUT_INVALID",
          "Record fails validation against entity rules and constraints",
          validation.errors
        );
      }

      // Compute defaults & computed fields
      const recordWithComputed = engine.compute(entityName, body);
      const created = await store.create(entityName, recordWithComputed, {
        tenantId,
        actor: actor?.id ? { id: actor.id } : undefined,
      });

      await completeIdempotentRequest(c, 201, created);

      return c.json(created, 201);
    } catch (err: unknown) {
      await failIdempotentRequest(c);
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // Named Query Endpoint: /api/:entity/queries/:queryName
  // PLAN.md §8.4: named queries with filtering, sorting, and cursor pagination.
  // Registered before /:entity/:id so "queries" is never treated as an id.
  // ---------------------------------------------------------------------------

  app.get("/api/:entity/queries/:queryName", async (c) => {
    const entityParam = c.req.param("entity");
    const queryName = c.req.param("queryName");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    // Query must be explicitly declared for this entity (no entity-name fallback).
    const queryDef = kir.queries?.[queryName];
    if (!queryDef || queryDef.from !== entityName) {
      return sendProblem(
        c,
        404,
        "NOT_FOUND",
        `Query '${queryName}' is not defined for entity '${entityName}'`
      );
    }

    const actor = getActorContext(c);
    const tenantId = getTenantId(c);

    const canRead = engine.canOperate(entityName, "read", actor);
    if (!canRead.allowed) {
      return sendProblem(c, 403, canRead.code ?? "PERMISSION_DENIED", canRead.reason);
    }

    try {
      const queryParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.req.query())) {
        if (["limit", "offset", "sort", "cursor", "tenantId"].includes(k)) continue;
        queryParams[k] = v;
      }

      const plan = engine.queryPlan(queryName, queryParams, actor);
      if (plan.entity !== entityName) {
        return sendProblem(
          c,
          404,
          "NOT_FOUND",
          `Query '${queryName}' reads entity '${plan.entity}', not '${entityName}'`
        );
      }

      // Plan paging: client limit/offset/cursor override the plan defaults.
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : plan.limit ?? 20;
      const cursor = decodeCursor(c.req.query("cursor"));
      const offset = cursor
        ? cursor.offset
        : c.req.query("offset")
        ? parseInt(c.req.query("offset")!, 10)
        : plan.offset ?? 0;
      const effectiveSort = cursor?.sort ?? parseSortParam(c.req.query("sort")) ?? toQueryOptionsSort(plan.orderBy);

      // 1. Pull the candidate set: tenant scope plus plan equality constraints, and let the
      //    store apply client-requested sort when the plan has none of its own (plan orderBy
      //    is authoritative when present).
      const pushdown: Record<string, unknown> = { ...equalityConstraints(plan.where, actor) };
      if (tenantId) pushdown.tenantId = tenantId;

      const found = await store.find(entityName, pushdown, {
        sort: plan.orderBy?.length ? undefined : effectiveSort,
        tenantId,
        // The whole predicate, offered so a store can narrow the scan. Advisory only: step 2
        // evaluates it again over whatever comes back, so a store that pushes nothing is
        // correct, and a store that pushes too much is caught by nothing — which is why
        // ADR-0039 makes narrowing an obligation rather than an optimisation.
        ...(plan.where ? { where: plan.where } : {}),
      });

      // 2. Evaluate the remaining predicate in-process (comparisons, or-branches).
      let records = evaluateWhereInMemory(
        found.items as Record<string, unknown>[],
        plan.where,
        actor
      );

      // 3. Plan order is authoritative; then projection and paging.
      records = applyOrderBy(records, plan.orderBy);
      const total = records.length;
      records = records.slice(offset, offset + limit);
      records = applySelect(records, plan.select);

      const links = buildNextCursor({
        items: records,
        limit,
        total,
        offset,
        sort: effectiveSort,
        makeUrl: (cursorValue: string) => cursorValue,
      });

      return c.json({
        query: queryName,
        items: records,
        total,
        limit,
        offset,
        ...(links.next ? { nextCursor: links.next } : {}),
      });
    } catch (err: unknown) {
      // Only a predicate the evaluator refused is the caller's fault. Everything else reaching
      // this catch is an internal fault, and answering 422 sent it to the client along with
      // `err.message` — a connection string, a path, a fragment of SQL. A dangling import in
      // this file was reported as a bad query until `QueryEvaluationError` gave the two apart.
      if (err instanceof QueryEvaluationError) {
        return sendProblem(c, 422, "QUERY_INVALID", err.message);
      }
      if (err instanceof Error && err.name === "ReadScopeError") {
        return sendProblem(c, 403, "PERMISSION_DENIED", err.message);
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // REST Item Endpoints: /api/:entity/:id
  // ---------------------------------------------------------------------------

  app.get("/api/:entity/:id", async (c) => {
    const entityParam = c.req.param("entity");
    const id = c.req.param("id");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const actor = getActorContext(c);

    // 1. Permission check
    const canRead = engine.canOperate(entityName, "read", actor);
    if (!canRead.allowed) {
      return sendProblem(c, 403, canRead.code ?? "PERMISSION_DENIED", canRead.reason);
    }

    // 2. Authorize read
    const readScope = engine.authorizeRead(entityName, actor);
    if (!readScope.allowed) {
      return sendProblem(c, 403, readScope.code ?? "PERMISSION_DENIED", readScope.reason);
    }

    // 3. Fetch from store without tenant scoping so a cross-tenant item yields 403, not 404
    const item = await store.get<Record<string, unknown>>(entityName, id);
    if (!item) {
      return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
    }

    // 4. Verify against readScope.where (ADR-0040 §4)
    if (readScope.where) {
      const allowed = evaluateWhereInMemory([item], readScope.where, actor);
      if (allowed.length === 0) {
        return sendProblem(
          c,
          403,
          "PERMISSION_DENIED",
          `Access to '${entityName}' is denied by read filter`
        );
      }
    }

    return c.json(item);
  });

  app.put("/api/:entity/:id", async (c) => {
    const entityParam = c.req.param("entity");
    const id = c.req.param("id");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const actor = getActorContext(c);
    const canUpdate = engine.canOperate(entityName, "update", actor);
    if (!canUpdate.allowed) {
      return sendProblem(c, 403, canUpdate.code ?? "PERMISSION_DENIED", canUpdate.reason);
    }

    // Idempotency gate
    const gated = await beginIdempotentRequest(c, "PUT");
    if (gated) return gated;

    try {
      const tenantId = getTenantId(c);
      const existing = await store.get<Record<string, unknown>>(entityName, id, { tenantId });
      if (!existing) {
        return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
      }

      const body = await readJsonBody(c);

      // Optimistic Concurrency version parsing
      const rawExpectedVersion = c.req.header("If-Match") || c.req.header("X-Expected-Version");
      const expectedVersion = rawExpectedVersion ? parseInt(rawExpectedVersion.replace(/"/g, ""), 10) : undefined;

      const merged = { ...existing, ...body };
      const validation = engine.validate(entityName, merged);
      if (!validation.valid) {
        return sendProblem(
          c,
          422,
          "INPUT_INVALID",
          "Updated record fails validation",
          validation.errors
        );
      }

      const computed = engine.compute(entityName, merged);

      try {
        const updated = await store.update(entityName, id, computed, {
          tenantId,
          actor: actor?.id ? { id: actor.id } : undefined,
          expectedVersion: isNaN(expectedVersion as number) ? undefined : expectedVersion,
        });

        await completeIdempotentRequest(c, 200, updated);

        return c.json(updated);
      } catch (err: unknown) {
        if (err instanceof VersionConflictError) {
          return sendProblem(c, 409, "VERSION_CONFLICT", err.message);
        }
        throw err;
      }
    } catch (err: unknown) {
      await failIdempotentRequest(c);
      throw err;
    }
  });

  app.delete("/api/:entity/:id", async (c) => {
    const entityParam = c.req.param("entity");
    const id = c.req.param("id");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const actor = getActorContext(c);
    const canDelete = engine.canOperate(entityName, "delete", actor);
    if (!canDelete.allowed) {
      return sendProblem(c, 403, canDelete.code ?? "PERMISSION_DENIED", canDelete.reason);
    }

    const tenantId = getTenantId(c);
    const soft = c.req.query("soft") === "true";

    const deleted = await store.delete(entityName, id, {
      tenantId,
      soft,
      actor: actor?.id ? { id: actor.id } : undefined,
    });

    if (!deleted) {
      return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
    }

    return c.body(null, 204);
  });

  // ---------------------------------------------------------------------------
  // Shared action/transition response pipeline
  // ---------------------------------------------------------------------------

  interface EngineEffect {
    type: string;
    extension?: string;
    input?: unknown;
    recipient?: string;
    template?: string;
    params?: Record<string, unknown>;
    action?: string;
    at?: string;
    payload?: Record<string, unknown>;
    target?: string;
    [key: string]: unknown;
  }

  interface EngineEvent {
    type: string;
    data: unknown;
    id: string;
    source: string;
    time?: string;
  }

  async function dispatchEffects(
    effects: EngineEffect[] | undefined,
    id: string,
    tenantId: string | undefined
  ): Promise<void> {
    if (!effects || effects.length === 0) return;
    for (const effect of effects) {
      if (effect.type === "call" && connectors) {
        const extension = effect.extension ?? "";
        const extDef = kir.extensions?.[extension] as Record<string, unknown> | undefined;
        const targetConnector: string = (extDef?.connector as string) || extension;
        const canHandle = typeof connectors.has === "function" ? connectors.has(targetConnector) : true;
        if (canHandle) {
          try {
            await connectors.call({
              connector: targetConnector,
              operation: (extDef?.operation as string) || "call",
              payload: {
                ...(extDef || {}),
                input: effect.input,
                ...(typeof effect.input === "object" ? effect.input : {}),
              },
              tenantId,
            });
          } catch {
            // Ignore or log unhandled external connector calls
          }
        }
      } else if (effect.type === "notify" && connectors) {
        const canEmail = typeof connectors.has === "function" ? connectors.has("email") : true;
        if (canEmail) {
          await connectors.call({
            connector: "email",
            operation: "send",
            payload: {
              to: effect.recipient ?? "",
              template: effect.template ?? "",
              params: effect.params,
            },
            tenantId,
          });
        }
      } else if (effect.type === "timer") {
        try {
          await scheduler.scheduleAt(effect.action ?? "", effect.at ?? "", effect.payload ?? {}, {
            target: effect.target || id,
            action: effect.action ?? "",
            tenantId,
          });
        } catch {
          // Ignore
        }
      } else if (effect.type === "cancel-timer") {
        try {
          if (scheduler.cancelByTarget) {
            await scheduler.cancelByTarget(effect.target || id, effect.action ?? "");
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  async function dispatchEvents(
    events: EngineEvent[] | undefined,
    tenantId: string | undefined
  ): Promise<void> {
    if (!bus || !events || events.length === 0) return;
    for (const ev of events) {
      await bus.publish(ev.type, ev.data, {
        id: ev.id,
        source: ev.source,
        tenantId,
        timestamp: ev.time,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Action Endpoints: /api/:entity/:id/actions/:actionName
  // ---------------------------------------------------------------------------

  app.post("/api/:entity/:id/actions/:actionName", async (c) => {
    const entityParam = c.req.param("entity");
    const id = c.req.param("id");
    const actionName = c.req.param("actionName");

    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const entityDef = kir.entities[entityName];
    if (!entityDef?.actions?.[actionName]) {
      return sendProblem(c, 404, "UNKNOWN_ACTION", `Action '${actionName}' not defined on entity '${entityName}'`);
    }

    // Idempotency gate
    const gated = await beginIdempotentRequest(c, "POST");
    if (gated) return gated;

    try {
      const tenantId = getTenantId(c);
      const actor = getActorContext(c);
      const existing = await store.get<Record<string, unknown>>(entityName, id, { tenantId });
      if (!existing) {
        return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
      }

      const body = await readJsonBody(c);

      // Permission and guard check
      const can = engine.can(entityName, actionName, existing, body, actor);
      if (!can.allowed) {
        const status = can.code === "PERMISSION_DENIED" || can.code === "FORBIDDEN" ? 403 : 422;
        return sendProblem(c, status, can.code ?? "GUARD_FAILED", can.reason);
      }

      // Execute action
      const runResult = engine.run(entityName, actionName, existing, body, actor);
      if (!runResult.ok) {
        return sendProblem(c, 422, runResult.error ?? "ACTION_FAILED", runResult.error);
      }

      // Persist mutation
      let updatedRecord = existing;
      if (runResult.record) {
        updatedRecord = await store.update(entityName, id, runResult.record, {
          tenantId,
          actor: actor?.id ? { id: actor.id } : undefined,
        });
      }

      await dispatchEvents(runResult.events as EngineEvent[] | undefined, tenantId);
      await dispatchEffects(runResult.effects as EngineEffect[] | undefined, id, tenantId);

      const responsePayload = {
        ok: true,
        record: updatedRecord,
        trace: runResult.trace,
        events: runResult.events,
      };

      await completeIdempotentRequest(c, 200, responsePayload);

      return c.json(responsePayload);
    } catch (err: unknown) {
      await failIdempotentRequest(c);
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // Workflow Transition Endpoints: /api/:entity/:id/transitions/:transitionName
  // ---------------------------------------------------------------------------

  app.post("/api/:entity/:id/transitions/:transitionName", async (c) => {
    const entityParam = c.req.param("entity");
    const id = c.req.param("id");
    const transitionName = c.req.param("transitionName");

    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    const entityDef = kir.entities[entityName];
    if (!entityDef?.workflow?.transitions?.[transitionName]) {
      return sendProblem(
        c,
        404,
        "UNKNOWN_TRANSITION",
        `Transition '${transitionName}' not defined on entity '${entityName}'`
      );
    }

    // Idempotency gate
    const gated = await beginIdempotentRequest(c, "POST");
    if (gated) return gated;

    try {
      const tenantId = getTenantId(c);
      const actor = getActorContext(c);
      const existing = await store.get<Record<string, unknown>>(entityName, id, { tenantId });
      if (!existing) {
        return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
      }

      // Permission and guard check
      const can = engine.can(entityName, transitionName, existing, {}, actor);
      if (!can.allowed) {
        const status =
          can.code === "PERMISSION_DENIED" || can.code === "FORBIDDEN"
            ? 403
            : can.code === "INVALID_STATE_TRANSITION"
            ? 409
            : 422;
        return sendProblem(c, status, can.code ?? "GUARD_FAILED", can.reason);
      }

      // Execute transition
      const transResult = engine.transition(entityName, existing, transitionName, actor);
      if (!transResult.ok) {
        const status = transResult.error === "INVALID_TRANSITION" ? 409 : 422;
        return sendProblem(c, status, transResult.error ?? "TRANSITION_FAILED", transResult.error);
      }

      // Persist status change
      let updatedRecord = existing;
      if (transResult.record) {
        updatedRecord = await store.update(entityName, id, transResult.record, {
          tenantId,
          actor: actor?.id ? { id: actor.id } : undefined,
        });
      }

      await dispatchEvents(transResult.events as EngineEvent[] | undefined, tenantId);
      await dispatchEffects(transResult.effects as EngineEffect[] | undefined, id, tenantId);

      const responsePayload = {
        ok: true,
        record: updatedRecord,
        trace: transResult.trace,
        events: transResult.events,
      };

      await completeIdempotentRequest(c, 200, responsePayload);

      return c.json(responsePayload);
    } catch (err: unknown) {
      await failIdempotentRequest(c);
      throw err;
    }
  });

  const rawRequest = app.request.bind(app);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.request = (input: any, init?: any, ...rest: any[]) => {
    if (init && typeof init === "object" && !("headers" in init)) {
      const headers: Record<string, string> = {};
      const newInit: any = { ...init };
      for (const [k, v] of Object.entries(init)) {
        if (
          typeof v === "string" &&
          (k.startsWith("X-") ||
            k.startsWith("x-") ||
            k.toLowerCase() === "content-type" ||
            k.toLowerCase() === "authorization")
        ) {
          headers[k] = v;
        }
      }
      if (Object.keys(headers).length > 0) {
        newInit.headers = headers;
        return rawRequest(input, newInit, ...rest);
      }
    }
    return rawRequest(input, init, ...rest);
  };

  return app;
}
