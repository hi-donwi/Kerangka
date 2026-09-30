/**
 * Kerangka JSON Schema field mapper (shared)
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Every JSON-shaped projection needs the same type mapping, and three copies of the
 * same switch had already drifted apart: one knew `format: uuid`, another did not;
 * one inlined a list of references, another did not. This is the one mapping, and the
 * projections supply only where their `$ref` pointers point.
 *
 * Facts JSON Schema cannot express — a reference target, uniqueness — are published
 * as `x-kerangka-*` rather than dropped or hidden in prose, so a form generator or a
 * validator can act on them.
 */

import { FieldDefinition } from "../types.js";

export interface JsonSchemaFieldOptions {
  /** Where a `$ref` points, e.g. `#/components/schemas` or `#/$defs`. */
  refBase: string;
  /**
   * Entities stored inline. A reference to one of these *is* the document, so it
   * resolves through `$ref`; a reference to anything else is a key, so it is a string.
   */
  embeddedTargets?: ReadonlySet<string>;
}

/** The targets of the model's embedded entities, from the compiled IR. */
export function embeddedTargetsOf(entities: Record<string, { embedded?: boolean }>): Set<string> {
  return new Set(
    Object.entries(entities)
      .filter(([, entity]) => entity?.embedded)
      .map(([name]) => name)
  );
}

export function toJsonSchemaField(
  field: FieldDefinition,
  options: JsonSchemaFieldOptions
): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  const type = (field?.type ?? "string").toLowerCase();

  switch (type) {
    case "string":
    case "text":
      schema.type = "string";
      break;
    case "uuid":
      schema.type = "string";
      schema.format = "uuid";
      break;
    case "email":
      schema.type = "string";
      schema.format = "email";
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
    case "time":
      schema.type = "string";
      schema.format = "time";
      break;
    case "int":
    case "integer":
      schema.type = "integer";
      break;
    case "float":
      schema.type = "number";
      schema.format = "float";
      break;
    case "decimal":
    case "numeric":
    case "money":
    case "number":
    case "double":
      schema.type = "number";
      // JSON numbers are binary floats; the exactness of decimal(p,s) is the
      // database's job, and saying so beats a precision no JSON reader can honour.
      if (field.precision !== undefined && field.scale !== undefined) {
        schema["x-kerangka-decimal"] = `decimal(${field.precision},${field.scale})`;
      }
      break;
    case "bool":
    case "boolean":
      schema.type = "boolean";
      break;
    case "enum":
      schema.type = "string";
      if (field.values && field.values.length > 0) schema.enum = field.values;
      break;
    case "ref": {
      const target = field.target || "entity";
      if (options.embeddedTargets?.has(target)) {
        return { ...schema, $ref: `${options.refBase}/${target}` };
      }
      schema.type = "string";
      schema["x-kerangka-ref"] = target;
      schema.description = `Reference to ${target}`;
      break;
    }
    case "list":
      schema.type = "array";
      schema.items = field.element
        ? toJsonSchemaField(field.element, options)
        : {};
      break;
    case "json":
      schema.type = "object";
      break;
    default:
      schema.type = "string";
  }

  // A bound only means something to a number. On a string it would be an ignored
  // keyword, so it is published rather than dropped.
  if (schema.type === "number" || schema.type === "integer") {
    if (field.min !== undefined) schema.minimum = field.min;
    if (field.max !== undefined) schema.maximum = field.max;
  } else {
    if (field.min !== undefined) schema["x-kerangka-min"] = field.min;
    if (field.max !== undefined) schema["x-kerangka-max"] = field.max;
  }

  if (field.default !== undefined) {
    // A default may be a call — `= today()` — and a form generator would prefill the
    // literal text "today()". A value the engine computes is an annotation, not a
    // default: the annotation says what the model said, and the schema stays valid.
    if (isJsonValue(field.default)) {
      schema.default = field.default;
    } else {
      schema["x-kerangka-default"] = field.default;
    }
  }
  if (field.unique) schema["x-kerangka-unique"] = true;
  if (field.compute) schema.readOnly = true;
  if (field.description) schema.description = field.description;

  return schema;
}

/**
 * Whether a default is a value JSON can carry. `draft`, `0`, and `true` are; `today()`
 * and an expression AST are not, and quoting makes even a parenthesised string safe.
 */
function isJsonValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean" || value === null) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.startsWith('"') || text.startsWith("'")) return true;
  return !text.includes("(");
}
