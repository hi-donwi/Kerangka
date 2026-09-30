/**
 * Kerangka AsyncAPI 3.0 Projection Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Events are the contract between contexts and services (PLAN.md §7.6, §11 L0).
 * They travel in the CloudEvents envelope, so the message payload is the CloudEvent
 * and only its `data` is described by the model. A consumer that has this document
 * can subscribe without reading the Kerangka model.
 */

import { normalizeField } from "../shorthand.js";
import { FieldDefinition, KIRDocument } from "../types.js";

export interface AsyncAPIOptions {
  /** Broker the events travel over. Default `kafka`; also `amqp`, `nats`, `websocket`. */
  broker?: "kafka" | "amqp" | "nats" | "websocket";
  /** Broker host. Defaults per broker. */
  host?: string;
  /** Topic or channel name an event is published under. */
  topic?: string;
  /** API version written into `info.version`. Defaults to the model's version. */
  apiVersion?: string;
}

const DEFAULT_HOSTS: Record<string, string> = {
  kafka: "localhost:9092",
  amqp: "localhost:5672",
  nats: "localhost:4222",
  websocket: "localhost:8080",
};

const BROKER_PROTOCOLS: Record<string, string> = {
  kafka: "kafka",
  amqp: "amqp",
  nats: "nats",
  websocket: "ws",
};

export class AsyncAPIGenerator {
  static generate(kir: KIRDocument, options: AsyncAPIOptions = {}): Record<string, unknown> {
    const broker = options.broker ?? "kafka";
    const title = kir.meta?.title || kir.app;
    const version = options.apiVersion || kir.meta?.version || "1.0.0";
    const topic = options.topic ?? `kerangka.${kir.app}.events`;

    // The KIR flattens contexts, so an event is addressed by its name and a deployment
    // that splits contexts maps the address onto a topic in its deploy file. What the
    // model does know is who emits and who listens, and both are worth publishing.
    const events: Record<string, Record<string, unknown>> = {};
    for (const [eventName, declared] of Object.entries(kir.events ?? {})) {
      events[eventName] = declared as Record<string, unknown>;
    }

    const channels: Record<string, unknown> = {};
    const operations: Record<string, unknown> = {};
    const messages: Record<string, unknown> = {};
    const schemas: Record<string, unknown> = {};

    for (const [eventName, fields] of Object.entries(events)) {
      const messageKey = `${eventName}Message`;
      const dataSchema = `${eventName}Data`;

      schemas[dataSchema] = {
        type: "object",
        description: `data of the ${eventName} CloudEvent`,
        properties: this.dataProperties(fields),
        required: this.requiredFields(fields),
      };

      messages[messageKey] = {
        name: eventName,
        title: eventName,
        summary: `${eventName} event`,
        contentType: "application/cloudevents+json",
        // The CloudEvents binding, not a hand-rolled envelope: brokers and serverless
        // platforms understand this as-is (PLAN.md §7.6).
        bindings: { cloudevents: { version: "1.0" } },
        payload: { $ref: `#/components/schemas/${dataSchema}` },
        "x-kerangka-emitted-by": this.emittersOf(kir, eventName),
        "x-kerangka-listeners": this.listenersOf(kir, eventName),
      };

      channels[eventName] = {
        address: eventName,
        title: eventName,
        description: `Published when ${eventName} is emitted.`,
        messages: {
          [messageKey]: { $ref: `#/components/messages/${messageKey}` },
        },
      };

      operations[`on${eventName}`] = {
        action: "receive",
        title: `Receive ${eventName}`,
        summary: `Subscribe to ${eventName}.`,
        channel: { $ref: `#/channels/${eventName}` },
        messages: [{ $ref: `#/channels/${eventName}/messages/${messageKey}` }],
      };
    }

    return {
      asyncapi: "3.0.0",
      info: {
        title: `${title} events`,
        version,
        description:
          "Event contracts emitted by this model. Payloads are CloudEvents; the model " +
          "describes only the data inside them. Channels are addressed by event name, " +
          "because the IR flattens contexts; a deployment that splits a context maps the " +
          "address onto a topic in its deploy file.",
      },
      defaultContentType: "application/json",
      servers: {
        production: {
          host: options.host ?? DEFAULT_HOSTS[broker] ?? "localhost:9092",
          protocol: BROKER_PROTOCOLS[broker] ?? broker,
          description: `${topic} on ${broker}`,
        },
      },
      channels,
      operations,
      components: { messages, schemas },
    };
  }

  /** The entities and operations whose `emit` produces this event, so a consumer sees the producer. */
  private static emittersOf(kir: KIRDocument, eventName: string): string[] {
    const emitters: string[] = [];
    for (const [entityName, entity] of Object.entries(kir.entities ?? {})) {
      for (const [transitionName, transition] of Object.entries(entity.workflow?.transitions ?? {})) {
        if (this.emits(transition.then, eventName)) {
          emitters.push(`${entityName}.${transitionName}`);
        }
      }
      for (const [actionName, action] of Object.entries(entity.actions ?? {})) {
        const declared = action as { emit?: unknown; then?: unknown };
        if (this.emits(declared.then, eventName) || this.emits(declared.emit, eventName)) {
          emitters.push(`${entityName}.${actionName}`);
        }
      }
    }
    return emitters;
  }

  /** The policies that listen for it, named as the KIR names them: `context.policy`. */
  private static listenersOf(kir: KIRDocument, eventName: string): string[] {
    const listeners: string[] = [];
    for (const [policyName, policy] of Object.entries(kir.policies ?? {})) {
      const declared = policy as { on?: unknown };
      const pattern = typeof declared.on === "string" ? declared.on : "";
      const bare = pattern.includes(".") ? pattern.slice(pattern.lastIndexOf(".") + 1) : pattern;
      if (pattern === eventName || bare === eventName) {
        listeners.push(policyName);
      }
    }
    return listeners;
  }

  private static emits(statements: unknown, eventName: string): boolean {
    if (!Array.isArray(statements)) return false;
    return statements.some((raw) => {
      if (!raw || typeof raw !== "object") return false;
      const statement = raw as Record<string, unknown>;
      if (statement.emit === eventName) return true;
      if (statement.emit && typeof statement.emit === "object") {
        const named = statement.emit as { event?: string; name?: string };
        if (named.event === eventName || named.name === eventName) return true;
      }
      return (
        this.emits(statement.then, eventName) || this.emits(statement.else, eventName)
      );
    });
  }

  private static dataProperties(fields: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [fieldName, declared] of Object.entries(fields ?? {})) {
      out[fieldName] = this.mapFieldToJsonSchema(this.normalizeField(declared));
    }
    return out;
  }

  private static requiredFields(fields: Record<string, unknown>): string[] | undefined {
    const required = Object.entries(fields ?? {})
      .filter(([, declared]) => this.normalizeField(declared).required)
      .map(([name]) => name);
    return required.length > 0 ? required : undefined;
  }

  /**
   * An event's fields are stored as written, so `"ref(Invoice)!"` is still a string
   * here. Every other projection normalises before it maps; so does this one.
   */
  private static normalizeField(declared: unknown): FieldDefinition {
    if (typeof declared === "string") {
      return normalizeField(declared);
    }
    return normalizeField((declared ?? {}) as FieldDefinition);
  }

  private static mapFieldToJsonSchema(field: FieldDefinition): Record<string, unknown> {
    const schema: Record<string, unknown> = {};
    const type = (field?.type ?? "string").toLowerCase();

    switch (type) {
      case "string":
      case "uuid":
      case "email":
      case "text":
        schema.type = "string";
        if (type === "uuid") schema.format = "uuid";
        if (type === "email") schema.format = "email";
        if (field?.unique) schema.description = "unique";
        break;
      case "int":
      case "integer":
        schema.type = "integer";
        break;
      case "decimal":
      case "numeric":
      case "money":
      case "number":
      case "float":
      case "double":
        schema.type = "number";
        break;
      case "bool":
      case "boolean":
        schema.type = "boolean";
        break;
      case "date":
        schema.type = "string";
        schema.format = "date";
        break;
      case "datetime":
      case "timestamp":
        schema.type = "string";
        schema.format = "date-time";
        break;
      case "enum":
        schema.type = "string";
        if (field.values && field.values.length > 0) schema.enum = field.values;
        break;
      case "ref":
        schema.type = "string";
        schema.description = `Reference to ${field.target || "entity"}`;
        break;
      case "list":
        schema.type = "array";
        schema.items = field.element ? this.mapFieldToJsonSchema(field.element) : {};
        break;
      case "json":
        schema.type = "object";
        break;
      default:
        schema.type = "string";
    }

    if (field?.min !== undefined) schema.minimum = field.min;
    if (field?.max !== undefined) schema.maximum = field.max;
    if (field?.default !== undefined) schema.default = field.default;
    if (field?.description) schema.description = field.description;

    return schema;
  }
}
