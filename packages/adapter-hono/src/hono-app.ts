/**
 * Kerangka Hono HTTP Adapter
 * Specification Version: 0.2
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
import { BusPort, MemoryStore, StorePort, VersionConflictError } from "@kerangka/ports";
import { createProblemDetails, ProblemDetails } from "./problem.js";
import { IdempotencyStore, MemoryIdempotencyStore } from "./idempotency.js";

export interface KerangkaHonoOptions {
  store?: StorePort;
  engine?: Engine;
  bus?: BusPort;
  idempotencyStore?: IdempotencyStore;
  serverUrl?: string;
  cors?: boolean;
}

export function createKerangkaHonoApp(kir: KIRDocument, options: KerangkaHonoOptions = {}): Hono {
  const app = new Hono();
  const store = options.store ?? new MemoryStore();
  const engine = options.engine ?? new Engine(kir);
  const bus = options.bus;
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
      instance: c.req.path,
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

    const tenantId = getTenantId(c);
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50;
    const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : 0;

    // Filters from query params
    const queryParams = c.req.query();
    const filter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      if (["limit", "offset", "sort", "tenantId"].includes(k)) continue;
      filter[k] = v;
    }

    const res = await store.find(entityName, Object.keys(filter).length > 0 ? filter : undefined, {
      limit,
      offset,
      tenantId,
    });

    c.header("X-Total-Count", String(res.total));
    return c.json(res);
  });

  app.post("/api/:entity", async (c) => {
    const entityParam = c.req.param("entity");
    const entityName = resolveEntityName(entityParam);
    if (!entityName) {
      return sendProblem(c, 404, "UNKNOWN_ENTITY", `Entity '${entityParam}' does not exist`);
    }

    // Idempotency check
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = await idempotencyStore.get(idempotencyKey);
      if (cached) {
        c.header("X-Cache-Lookup", "HIT");
        return c.json(cached.body, 200);
      }
    }

    const tenantId = getTenantId(c);
    const actor = getActorContext(c);
    const body = await c.req.json().catch(() => ({}));

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

    if (idempotencyKey) {
      await idempotencyStore.set(idempotencyKey, {
        status: 201,
        headers: { "X-Idempotent-Replayed": "true" },
        body: created,
        timestamp: Date.now(),
      });
    }

    return c.json(created, 201);
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

    const tenantId = getTenantId(c);
    const item = await store.get(entityName, id, { tenantId });
    if (!item) {
      return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
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

    // Idempotency check
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = await idempotencyStore.get(idempotencyKey);
      if (cached) {
        c.header("X-Cache-Lookup", "HIT");
        return c.json(cached.body, 200);
      }
    }

    const tenantId = getTenantId(c);
    const actor = getActorContext(c);
    const existing = await store.get<Record<string, unknown>>(entityName, id, { tenantId });
    if (!existing) {
      return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
    }

    const body = await c.req.json().catch(() => ({}));

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

      if (idempotencyKey) {
        await idempotencyStore.set(idempotencyKey, {
          status: 200,
          headers: { "X-Idempotent-Replayed": "true" },
          body: updated,
          timestamp: Date.now(),
        });
      }

      return c.json(updated);
    } catch (err: unknown) {
      if (err instanceof VersionConflictError) {
        return sendProblem(c, 409, "VERSION_CONFLICT", err.message);
      }
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

    const tenantId = getTenantId(c);
    const actor = getActorContext(c);
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

    // Idempotency check
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = await idempotencyStore.get(idempotencyKey);
      if (cached) {
        c.header("X-Cache-Lookup", "HIT");
        return c.json(cached.body, 200);
      }
    }

    const tenantId = getTenantId(c);
    const actor = getActorContext(c);
    const existing = await store.get<Record<string, unknown>>(entityName, id, { tenantId });
    if (!existing) {
      return sendProblem(c, 404, "NOT_FOUND", `${entityName} with id '${id}' not found`);
    }

    const body = await c.req.json().catch(() => ({}));

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

    // Dispatch events to bus if available
    if (bus && runResult.events && runResult.events.length > 0) {
      for (const ev of runResult.events) {
        await bus.publish(ev.type, ev.data, {
          id: ev.id,
          source: ev.source,
          tenantId,
          timestamp: ev.time,
        });
      }
    }

    const responsePayload = {
      ok: true,
      record: updatedRecord,
      trace: runResult.trace,
      events: runResult.events,
    };

    if (idempotencyKey) {
      await idempotencyStore.set(idempotencyKey, {
        status: 200,
        headers: { "X-Idempotent-Replayed": "true" },
        body: responsePayload,
        timestamp: Date.now(),
      });
    }

    return c.json(responsePayload);
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

    // Idempotency check
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey) {
      const cached = await idempotencyStore.get(idempotencyKey);
      if (cached) {
        c.header("X-Cache-Lookup", "HIT");
        return c.json(cached.body, 200);
      }
    }

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

    // Dispatch events to bus if available
    if (bus && transResult.events && transResult.events.length > 0) {
      for (const ev of transResult.events) {
        await bus.publish(ev.type, ev.data, {
          id: ev.id,
          source: ev.source,
          tenantId,
          timestamp: ev.time,
        });
      }
    }

    const responsePayload = {
      ok: true,
      record: updatedRecord,
      trace: transResult.trace,
      events: transResult.events,
    };

    if (idempotencyKey) {
      await idempotencyStore.set(idempotencyKey, {
        status: 200,
        headers: { "X-Idempotent-Replayed": "true" },
        body: responsePayload,
        timestamp: Date.now(),
      });
    }

    return c.json(responsePayload);
  });

  return app;
}
