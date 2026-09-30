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
 * The MCP routes are here for the same reason. They were never model-derived either, and
 * leaving them out would keep the "the served document is complete" claim false.
 */

const problem = (description: string) => ({
  description,
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/ProblemDetails" }
    }
  }
});

const json = (schema: Record<string, unknown>, description: string) => ({
  description,
  content: { "application/json": { schema } }
});

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

const idParameter = (what: string) => ({
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: `Identifier of the queued ${what}.`
});

/** `/api/events` and `/api/effects`, with their acknowledgement routes. */
const queuePaths = (what: "event" | "effect", entry: Record<string, unknown>) => {
  const plural = `${what}s`;
  const capitalised = what === "event" ? "Event" : "Effect";
  return {
    [`/api/${plural}`]: {
      get: {
        summary: `List the ${plural} waiting to be delivered`,
        description:
          "Entries a run promised and no host has settled yet. A `nack` keeps an entry here " +
          "with its attempt counted, so nothing is lost by a failed delivery.",
        operationId: `list_pending_${plural}`,
        tags: ["host"],
        responses: {
          "200": json(
            { type: "object", required: [plural], properties: { [plural]: { type: "array", items: entry } } },
            `The pending ${plural}, oldest first.`
          )
        }
      }
    },
    [`/api/${plural}/{id}/ack`]: {
      parameters: [idParameter(what)],
      post: {
        summary: `Record that a host delivered the ${what}`,
        description:
          "Marks the entry delivered. It stays as history rather than being deleted, so a " +
          "duplicate acknowledgement is visible instead of silent.",
        operationId: `ack_${what}`,
        tags: ["host"],
        responses: {
          "200": json(
            { type: "object", required: [what], properties: { [what]: entry } },
            `The ${what} as it now stands.`
          ),
          "404": problem(`No queued ${what} with that id.`)
        }
      }
    },
    [`/api/${plural}/{id}/nack`]: {
      parameters: [idParameter(what)],
      post: {
        summary: `Record that a host could not deliver the ${what}`,
        description:
          "Keeps the entry pending for another attempt and counts it. The optional `error` " +
          "body is the host's reason, for the operator.",
        operationId: `nack_${what}`,
        tags: ["host"],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { type: "string", description: "Why the attempt failed." } }
              }
            }
          }
        },
        responses: {
          "200": json(
            { type: "object", required: [what], properties: { [what]: entry } },
            `The ${what} as it now stands, still pending.`
          ),
          "404": problem(`No queued ${what} with that id.`)
        }
      }
    }
  };
};

/** The MCP routes, which have never been model-derived. */
const mcpPaths = {
  "/api/mcp/tools": {
    get: {
      summary: "List the MCP tools this model exposes",
      description: "One tool per entity action, plus `list_<entity>` and `get_<entity>`.",
      operationId: "list_mcp_tools",
      tags: ["mcp"],
      responses: {
        "200": json(
          {
            type: "object",
            required: ["tools"],
            properties: { tools: { type: "array", items: { type: "object", additionalProperties: true } } }
          },
          "The tools this server offers."
        )
      }
    }
  },
  "/api/mcp/call": {
    post: {
      summary: "Invoke an MCP tool",
      description:
        "Runs a model action through the tool interface. The result is the same envelope an " +
        "HTTP action returns, including `effectsFailed` when a host effect was not delivered.",
      operationId: "call_mcp_tool",
      tags: ["mcp"],
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
      },
      responses: {
        "200": json(
          {
            type: "object",
            required: ["content"],
            properties: {
              content: { type: "array", items: { type: "object", additionalProperties: true } },
              isError: { type: "boolean" }
            }
          },
          "The tool result."
        ),
        "400": problem("The tool call could not be run.")
      }
    }
  }
};

/**
 * The extra paths and schemas to merge into a served document.
 *
 * `withQueues` is false when the server has no session, and then the queue routes are absent
 * rather than present-and-501: a path this deployment cannot serve should not be advertised.
 * A `501` is still what a client gets if it guesses the path, and the README says so.
 */
export function operationalOpenAPI(withQueues: boolean): {
  paths: Record<string, unknown>;
  schemas: Record<string, unknown>;
} {
  return {
    paths: {
      ...mcpPaths,
      ...(withQueues
        ? { ...queuePaths("event", outboxEntry), ...queuePaths("effect", hostEffectEntry) }
        : {})
    },
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
