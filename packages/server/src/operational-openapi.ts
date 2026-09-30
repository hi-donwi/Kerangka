/**
 * The routes the server serves that the model does not describe.
 *
 * These live here, in `packages/server`, and not in the OpenAPI emitter, on purpose. The
 * emitter turns a `KIRDocument` into a document about a *model*; it has no idea whether a
 * deployment has a session, so it cannot know whether `/api/events` exists. This server can,
 * because it knows whether it was given one. So the **served** document describes the
 * **running** server, and the document `keranga emit openapi` writes stays model-only.
 *
 * Both are correct and they are different things. A consumer generating a client from the
 * emitted file gets the model surface; a consumer pointing at a running server gets that plus
 * the operational surface it can actually call. Before this existed, the served document
 * omitted the outbox and the effect queue, which is exactly the surface a host needs.
 *
 * **One table, two readers.** `OPERATIONAL_ROUTES` is the single declaration of each route:
 * its path, the pattern that matches it, whether it needs a session, and its OpenAPI shape.
 * The router matches against it and the document is built from it, so a route cannot be served
 * without being described or described without being served. This replaced an if-chain in
 * `server.ts` and a hand-written document, which were two declarations of the same list and
 * could drift in either direction.
 *
 * The handlers themselves are deliberately *not* in this table. A table of closures would
 * hide the control flow, and the alternative — a name here and a method there — reintroduces
 * the mapping this file exists to remove. The handler for a route is a method on the server
 * named by `handler`, and the table's tests prove each name resolves.
 */

/** Whether a route can only work when the server was given a session to queue into. */
import type * as http from "node:http";
import type { SessionStoreLike } from "./session-store.js";

export type SessionNeed = "required" | "not-needed";

/** How the route's path is matched and how it is written in the document. */
export interface OperationalRoute {
  /** The OpenAPI path, with `{id}` for a path parameter. */
  path: string;
  /** The HTTP method. */
  method: "GET" | "POST";
  /**
   * The matcher, anchored. Built from `path` by `routePattern`, and stored so a caller never
   * has to reconstruct it — reconstructing it in two places is how the two drift.
   */
  pattern: RegExp;
  /** Whether the route requires a session, and so is absent from the document without one. */
  session: SessionNeed;
  /** The method on `KerangkaServer` that serves this route. */
  handler: string;
  /** The operation id, which is what a generated client names the method. */
  operationId: string;
  summary: string;
  description: string;
  /** A schema for the request body, when the route reads one. */
  requestBody?: Record<string, unknown>;
  /** Responses other than the success one, keyed by status. */
  errorResponses?: Record<string, string>;
  /** The error code returned when the route is called without a session it requires. */
  unavailableCode?: string;
  /** The detail message for that 501. */
  unavailableDetail?: string;
  tag: "host" | "mcp";
}

/**
 * What a route handler is given.
 *
 * The handler name is on the route rather than a closure here, so this is how the two meet.
 * `server` is the instance the handlers are methods of, which is what lets them be private
 * while the table stays declarative.
 */
export interface OperationalContext {
  route: OperationalRoute;
  /** The path captures, in the order they appear in `route.path`. */
  params: string[];
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  session: SessionStoreLike | null;
  server: unknown;
}

const param = (name: string, what: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description: `Identifier of the queued ${what}.`
});

/** Turn `/api/events/{id}/ack` into a matcher that captures `id` and nothing else. */
function routePattern(path: string): RegExp {
  const source = path.replace(/\{(\w+)\}/g, "([^/]+)");
  return new RegExp(`^${source}$`);
}

const list = (what: "events" | "effects") => ({
  description: `The pending ${what}, oldest first.`,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: [what],
        properties: {
          [what]: {
            type: "array",
            items: { $ref: `#/components/schemas/${entrySchema(singular(what))}` }
          }
        }
      }
    }
  }
});

const single = (what: "event" | "effect") => ({
  description: `The ${what} as it now stands.`,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: [what],
        properties: { [what]: { $ref: `#/components/schemas/${entrySchema(what)}` } }
      }
    }
  }
});

/** The response key, and the schema each entry is described by. */
const singular = (what: "events" | "effects") => (what === "events" ? "event" : "effect");
const entrySchema = (what: "event" | "effect") => (what === "event" ? "OutboxEntry" : "HostEffectEntry");

/** The outbox entry, as `/api/events` returns it. */
const outboxEntry = {
  type: "object",
  required: ["id", "event", "state", "attempts"],
  properties: {
    id: { type: "string", description: "The CloudEvent id, which is also the outbox key." },
    event: { $ref: "#/components/schemas/CloudEvent" },
    entity: { type: "string", description: "The aggregate the run wrote, for a consumer that needs it." },
    state: { type: "string", enum: ["pending", "delivered"] },
    attempts: { type: "integer", minimum: 0 },
    lastError: { type: "string", description: "Why the last delivery attempt failed." },
    enqueuedAtRevision: { type: "integer" }
  },
  additionalProperties: false
};

/** The host-effect entry, as `/api/effects` returns it. */
const hostEffectEntry = {
  type: "object",
  required: ["id", "effect", "state", "attempts"],
  properties: {
    id: { type: "string" },
    effect: {
      type: "object",
      description: "The effect a host has to perform: a call, a notification, or a timer.",
      additionalProperties: true
    },
    state: { type: "string", enum: ["pending", "delivered"] },
    attempts: { type: "integer", minimum: 0 },
    lastError: { type: "string" },
    enqueuedAtRevision: { type: "integer" }
  },
  additionalProperties: false
};

const nackBody = {
  required: false,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "string", description: "Why the attempt failed." } }
      }
    }
  }
};

const unavailable = (code: string, detail: string) => ({ code, detail });

/**
 * Every operational route, in one place.
 *
 * Read the order as the order a host would: find out what tools exist, call one, then drain
 * the events and effects it left behind and settle them.
 */
const ROUTE_SPECS: Array<Omit<OperationalRoute, "pattern">> = [
  {
    path: "/api/mcp/tools",
    method: "GET",
    session: "not-needed",
    handler: "handleMcpTools",
    operationId: "list_mcp_tools",
    tag: "mcp",
    summary: "List the MCP tools this model exposes",
    description: "One tool per entity action, plus `list_<entity>` and `get_<entity>`."
  },
  {
    path: "/api/mcp/call",
    method: "POST",
    session: "not-needed",
    handler: "handleMcpCallRoute",
    operationId: "call_mcp_tool",
    tag: "mcp",
    summary: "Invoke an MCP tool",
    description:
      "Runs a model action through the tool interface. The result is the same envelope an " +
      "HTTP action returns, including `effectsFailed` when a host effect was not delivered.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "The tool name." },
              arguments: { type: "object", additionalProperties: true }
            }
          }
        }
      }
    }
  },
  {
    path: "/api/events",
    method: "GET",
    session: "required",
    handler: "handleListEvents",
    operationId: "list_pending_events",
    tag: "host",
    summary: "List the events waiting to be delivered",
    description:
      "Entries a run promised and no host has settled yet. A `nack` keeps an entry here " +
      "with its attempt counted, so nothing is lost by a failed delivery.",
    unavailableCode: "EVENT_OUTBOX_UNAVAILABLE",
    unavailableDetail:
      "This server was started without a session, so emitted events are returned in the " +
      "action response but not queued. Start it with a session to drain them."
  },
  {
    path: "/api/events/{id}/ack",
    method: "POST",
    session: "required",
    handler: "handleEventSettlement",
    operationId: "ack_event",
    tag: "host",
    summary: "Record that a host delivered the event",
    description:
      "Marks the entry delivered. It stays as history rather than being deleted, so a " +
      "duplicate acknowledgement is visible instead of silent.",
    errorResponses: { "404": "No queued event with that id." },
    unavailableCode: "EVENT_OUTBOX_UNAVAILABLE",
    unavailableDetail: "This server was started without a session, so there is no outbox to acknowledge."
  },
  {
    path: "/api/events/{id}/nack",
    method: "POST",
    session: "required",
    handler: "handleEventSettlement",
    operationId: "nack_event",
    tag: "host",
    summary: "Record that a host could not deliver the event",
    description:
      "Keeps the entry pending for another attempt and counts it. The optional `error` " +
      "body is the host's reason, for the operator.",
    requestBody: nackBody,
    errorResponses: { "404": "No queued event with that id." },
    unavailableCode: "EVENT_OUTBOX_UNAVAILABLE",
    unavailableDetail: "This server was started without a session, so there is no outbox to acknowledge."
  },
  {
    path: "/api/effects",
    method: "GET",
    session: "required",
    handler: "handleListEffects",
    operationId: "list_pending_effects",
    tag: "host",
    summary: "List the host effects waiting to be performed",
    description:
      "The drain for undelivered effects. Only useful when the server was given a session " +
      "to queue them into.",
    unavailableCode: "EFFECT_QUEUE_UNAVAILABLE",
    unavailableDetail:
      "This server was started without a session, so host effects are reported in the " +
      "action response but not queued. Start it with a session to drain them."
  },
  {
    path: "/api/effects/{id}/ack",
    method: "POST",
    session: "required",
    handler: "handleEffectSettlement",
    operationId: "ack_effect",
    tag: "host",
    summary: "Record that a host performed the effect",
    description:
      "Marks the effect delivered. It stays as history rather than being deleted, so a " +
      "duplicate acknowledgement is visible instead of silent.",
    errorResponses: { "404": "No queued effect with that id." },
    unavailableCode: "EFFECT_QUEUE_UNAVAILABLE",
    unavailableDetail:
      "This server was started without a session, so there is no effect queue to acknowledge."
  },
  {
    path: "/api/effects/{id}/nack",
    method: "POST",
    session: "required",
    handler: "handleEffectSettlement",
    operationId: "nack_effect",
    tag: "host",
    summary: "Record that a host could not perform the effect",
    description:
      "Keeps the effect pending for another attempt and counts it. The optional `error` " +
      "body is the host's reason, for the operator.",
    requestBody: nackBody,
    errorResponses: { "404": "No queued effect with that id." },
    unavailableCode: "EFFECT_QUEUE_UNAVAILABLE",
    unavailableDetail:
      "This server was started without a session, so there is no effect queue to acknowledge."
  }
];

/** The table, with each route's matcher built once. */
export const OPERATIONAL_ROUTES: readonly OperationalRoute[] = ROUTE_SPECS.map((spec) => ({
  ...spec,
  pattern: routePattern(spec.path)
}));

/**
 * The routes this deployment can actually serve.
 *
 * A route that needs a session and has none is excluded rather than included-and-501: a path
 * this deployment cannot serve should not be advertised. A client that guesses it still gets
 * the 501 below, and the README says so.
 */
export function servedRoutes(withQueues: boolean): readonly OperationalRoute[] {
  return OPERATIONAL_ROUTES.filter((route) => withQueues || route.session === "not-needed");
}

/**
 * Find the route serving a request, if this deployment serves one.
 *
 * Returns the captures in `params`, so the caller does not re-run the pattern to get the id —
 * re-running it is how a matcher and a path template come to disagree.
 */
export function matchRoute(
  pathname: string,
  method: string,
  withQueues: boolean
): { route: OperationalRoute; params: string[] } | null {
  for (const route of servedRoutes(withQueues)) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}

/**
 * The 501 a route returns when it needs a session and the server has none.
 *
 * Kept beside the route so the code and the message cannot disagree — the message tells a
 * host how to fix it, and a mismatched code is the thing a client matches on.
 */
export function unavailableFor(route: OperationalRoute): { code: string; detail: string } {
  return unavailable(
    route.unavailableCode ?? "NOT_AVAILABLE",
    route.unavailableDetail ?? "This server was not configured for this route."
  );
}

/**
 * The extra paths and schemas to merge into a served document.
 *
 * Built from the same table the router matches against, so a route described here is a route
 * that is served, and neither can be added without the other.
 */
export function operationalOpenAPI(withQueues: boolean): {
  paths: Record<string, unknown>;
  schemas: Record<string, unknown>;
} {
  const paths: Record<string, unknown> = {};

  for (const route of servedRoutes(withQueues)) {
    const existing = (paths[route.path] ?? {}) as Record<string, unknown>;
    const parameters = route.path.includes("{")
      ? [param((/\{(\w+)\}/.exec(route.path) as RegExpExecArray)[1] as string, route.tag)]
      : undefined;

    const responses: Record<string, unknown> = {};
    if (route.path === "/api/events" || route.path === "/api/effects") {
      responses["200"] = list(route.path === "/api/events" ? "events" : "effects");
    } else if (route.path === "/api/mcp/tools") {
      responses["200"] = {
        description: "The tools this server offers.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["tools"],
              properties: {
                tools: { type: "array", items: { type: "object", additionalProperties: true } }
              }
            }
          }
        }
      };
    } else if (route.path === "/api/mcp/call") {
      responses["200"] = {
        description: "The tool result.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["content"],
              properties: {
                content: { type: "array", items: { type: "object", additionalProperties: true } },
                isError: { type: "boolean" }
              }
            }
          }
        }
      };
    } else if (route.tag === "host") {
      const what = route.path.startsWith("/api/events") ? "event" : "effect";
      responses["200"] = single(what);
    }

    for (const [status, description] of Object.entries(route.errorResponses ?? {})) {
      responses[status] = problem(description);
    }

    const operation: Record<string, unknown> = {
      operationId: route.operationId,
      summary: route.summary,
      description: route.description,
      tags: [route.tag],
      responses
    };
    if (route.requestBody) operation.requestBody = route.requestBody;
    if (parameters) existing.parameters = parameters;
    existing[route.method.toLowerCase()] = operation;
    paths[route.path] = existing;
  }

  return {
    paths,
    schemas: {
      CloudEvent: {
        type: "object",
        description: "A CloudEvent 1.0 envelope; unknown members are extension attributes.",
        required: ["specversion", "id", "source", "type", "time", "datacontenttype", "data"],
        properties: {
          specversion: { type: "string", const: "1.0" },
          id: { type: "string" },
          source: { type: "string" },
          type: { type: "string" },
          time: { type: "string", format: "date-time" },
          datacontenttype: { type: "string", const: "application/json" },
          data: { type: "object", additionalProperties: true }
        },
        additionalProperties: true
      },
      ...(withQueues ? { OutboxEntry: outboxEntry, HostEffectEntry: hostEffectEntry } : {})
    }
  };
}

const problem = (description: string) => ({
  description,
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/ProblemDetails" }
    }
  }
});
