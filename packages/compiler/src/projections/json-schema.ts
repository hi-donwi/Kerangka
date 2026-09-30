/**
 * Kerangka JSON Schema 2020-12 Projection Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * PLAN.md §11 L0 promises "JSON Schema, OpenAPI 3.1, and SQL DDL from the CLI", and
 * §8 names the two consumers: data shape and forms. One document carries both — a
 * definition per entity, a definition per event payload, `readOnly` on what the
 * engine computes — and a generator can point at any one of them.
 *
 * The IR flattens contexts, so a name is a name; a deployment that splits a context
 * maps a name onto a service. The same is true of the entities' OpenAPI counterparts,
 * and that is a property of the IR rather than of this document.
 */

import { normalizeField } from "../shorthand.js";
import { FieldDefinition, KIRDocument } from "../types.js";
import { embeddedTargetsOf, toJsonSchemaField } from "./json-schema-field.js";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export interface JSONSchemaOptions {
  /** Root the document at one entity, so a form is handed a single schema. */
  entity?: string;
  /** Root the document at one event's payload. */
  event?: string;
  /** `additionalProperties: false` on every definition. */
  strict?: boolean;
  /** `$id` written into the document. */
  id?: string;
}

export class JSONSchemaGenerator {
  static generate(kir: KIRDocument, options: JSONSchemaOptions = {}): Record<string, unknown> {
    const entities = (kir.entities ?? {}) as Record<string, { fields?: Record<string, unknown>; embedded?: boolean }>;
    const events = (kir.events ?? {}) as Record<string, Record<string, unknown>>;
    const embedded = embeddedTargetsOf(entities);
    const fieldOptions = { refBase: "#/$defs", embeddedTargets: embedded };

    const defs: Record<string, unknown> = {};

    for (const [entityName, entity] of Object.entries(entities)) {
      defs[entityName] = this.objectSchema(
        this.normalizeFields(entity.fields),
        `${entityName} record`,
        options,
        fieldOptions
      );
    }

    // The payload of an event is the contract a consumer subscribes to (PLAN.md §7.6),
    // so it is a first-class definition rather than a copy of a message wrapper.
    for (const [eventName, fields] of Object.entries(events)) {
      defs[eventName] = this.objectSchema(
        this.normalizeFields(fields),
        `payload of the ${eventName} event`,
        options,
        fieldOptions
      );
    }

    const title = kir.meta?.title || kir.app;
    const document: Record<string, unknown> = {
      $schema: JSON_SCHEMA_DIALECT,
      $id: options.id ?? `https://kerangka.dev/schemas/${kir.app}.json`,
      title: `${title} data shape`,
      description:
        "Entity and event payload contracts emitted from a Kerangka model. Fields the " +
        "engine computes are readOnly; a field the model cannot express in JSON Schema " +
        "(a reference target, uniqueness, exact decimal precision) is published as an " +
        "x-kerangka- annotation.",
    };

    const root = this.rootOf(kir, options);
    if (root) document.$ref = `#/$defs/${root}`;

    if (Object.keys(defs).length > 0) document.$defs = defs;

    return document;
  }

  /** The definition the document is rooted at, and an error when it does not exist. */
  private static rootOf(kir: KIRDocument, options: JSONSchemaOptions): string | undefined {
    const wanted = options.entity ?? options.event;
    if (!wanted) return undefined;

    const entities = (kir.entities ?? {}) as Record<string, unknown>;
    const events = (kir.events ?? {}) as Record<string, unknown>;
    if (entities[wanted] || events[wanted]) return wanted;

    const known = [...Object.keys(entities), ...Object.keys(events)];
    const suggestion = known.find((name) => name.toLowerCase() === wanted.toLowerCase());
    const hint = suggestion
      ? `Did you mean '${suggestion}'?`
      : `This model defines: ${known.length > 0 ? known.join(", ") : "(nothing)"}.`;
    throw new Error(`No entity or event named '${wanted}' is defined. ${hint}`);
  }

  private static objectSchema(
    fields: Record<string, FieldDefinition>,
    description: string,
    options: JSONSchemaOptions,
    fieldOptions: { refBase: string; embeddedTargets: ReadonlySet<string> }
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [fieldName, field] of Object.entries(fields)) {
      properties[fieldName] = toJsonSchemaField(field, fieldOptions);
    }

    const required = Object.entries(fields)
      .filter(([, field]) => field.required)
      .map(([fieldName]) => fieldName);

    const schema: Record<string, unknown> = {
      type: "object",
      description,
      properties,
    };
    if (required.length > 0) schema.required = required;
    // Off by default: an engine may add audit or extension fields the model does not
    // declare, and a strict schema would reject records it wrote itself.
    if (options.strict) schema.additionalProperties = false;

    return schema;
  }

  private static normalizeFields(
    fields: Record<string, unknown> | undefined
  ): Record<string, FieldDefinition> {
    const out: Record<string, FieldDefinition> = {};
    for (const [fieldName, declared] of Object.entries(fields ?? {})) {
      out[fieldName] = normalizeField(declared as string | FieldDefinition);
    }
    return out;
  }
}
