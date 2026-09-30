/**
 * The body a run of an action or transition returns over HTTP.
 *
 * This lives with the contract rather than beside the server because the OpenAPI
 * document is what a client generates code from, and a contract that describes the wrong
 * body is worse than no contract: the generated client compiles, and then reads
 * `record.status` off an object the server never sent.
 *
 * It used to be wrong. Both the transition and the custom-action endpoints declared
 * `200: $ref → #/components/schemas/<Entity>`, while the server has always returned this
 * envelope. `packages/server/test/server.test.ts` compares a live response against the
 * emitted document, so the two cannot drift apart again.
 */

/** The CloudEvents 1.0 envelope a run's events arrive in (ADR-0023). */
export function cloudEventSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "A CloudEvent 1.0 envelope; unknown members are extension attributes.",
    required: ["specversion", "id", "source", "type", "time", "datacontenttype", "data"],
    properties: {
      specversion: { type: "string", const: "1.0" },
      id: { type: "string" },
      source: { type: "string" },
      type: { type: "string" },
      name: { type: "string", description: "Convenience alias for `type`." },
      time: { type: "string", format: "date-time" },
      datacontenttype: { type: "string", const: "application/json" },
      subject: { type: "string" },
      tenantid: { type: "string" },
      traceparent: { type: "string" },
      // The payload shape belongs to the event, and each event declares its own.
      data: { type: "object", additionalProperties: true }
    },
    additionalProperties: true
  };
}

/**
 * The result of running an action or a workflow transition on a record.
 *
 * `record` is the aggregate after the run, not the request body: an action may compute
 * fields, so echoing the input would be a lie about what was stored.
 */
export function actionResultSchema(entityName: string): Record<string, unknown> {
  return {
    type: "object",
    required: ["ok", "action", "record", "events"],
    properties: {
      ok: { type: "boolean", description: "True when the run succeeded and the record was written." },
      action: { type: "string", description: "The action or transition that ran." },
      record: {
        $ref: `#/components/schemas/${entityName}`,
        description: `The ${entityName} as stored after the run.`
      },
      events: {
        type: "array",
        description: "The events the run emitted, in order.",
        items: cloudEventSchema()
      },
      // Absent when everything was delivered, so a clean run's body is unchanged. Present
      // means the aggregate was written and at least one host effect was not performed:
      // the write is not in question, the side effect is.
      effectsFailed: {
        type: "array",
        description:
          "Effects the run asked for and the host could not deliver. Absent when there were none.",
        items: {
          type: "object",
          required: ["index", "type", "code"],
          properties: {
            index: {
              type: "integer",
              minimum: 0,
              description: "Position in the run's effect list, so it lines up with a trace."
            },
            type: {
              type: "string",
              description: "The effect that was not delivered."
            },
            target: {
              type: "string",
              description: "The connector, action, or timer target it was aimed at."
            },
            code: {
              type: "string",
              description:
                "EFFECT_UNHANDLED: nothing in this deployment can perform it. " +
                "EFFECT_NOT_APPLIED: it was attempted and failed. The reason is in the server log, " +
                "not here, because a connector error can carry an endpoint or a response body.",
              enum: ["EFFECT_UNHANDLED", "EFFECT_NOT_APPLIED"]
            }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  };
}
