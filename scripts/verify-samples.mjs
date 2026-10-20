import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "samples", "manifest.json");
const schemaPath = path.join(root, "samples", "manifest.schema.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const errors = [];

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function validate(value, schema, path = "$") {
  if (schema.type) {
    const t = schema.type;
    const actual = typeOf(value);
    const ok =
      (t === "object" && isObject(value)) ||
      (t === "array" && Array.isArray(value)) ||
      (t === "string" && typeof value === "string") ||
      (t === "number" && typeof value === "number") ||
      (t === "integer" && Number.isInteger(value)) ||
      (t === "boolean" && typeof value === "boolean") ||
      (t === "null" && value === null);
    if (!ok) {
      errors.push(`${path}: expected ${t}, got ${actual}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}`);
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path}: minLength ${schema.minLength}`);
  }
  if (typeof schema.minItems === "number" && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path}: minItems ${schema.minItems}`);
  }
  if (schema.uniqueItems && Array.isArray(value) && new Set(value.map((x) => JSON.stringify(x))).size !== value.length) {
    errors.push(`${path}: uniqueItems violated`);
  }
  if (schema.required && isObject(value)) {
    for (const k of schema.required) {
      if (!(k in value)) errors.push(`${path}: missing required field ${k}`);
    }
  }
  if (schema.additionalProperties === false && isObject(value) && schema.properties) {
    for (const k of Object.keys(value)) {
      if (!(k in schema.properties)) errors.push(`${path}: unknown property ${k}`);
    }
  }
  if (schema.properties && isObject(value)) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) validate(value[k], sub, `${path}.${k}`);
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  }
}

validate(manifest, schema, "$");

if (!Array.isArray(manifest)) {
  errors.push("$: manifest must be an array");
}

const ids = new Set();
for (const [i, entry] of (manifest || []).entries()) {
  const p = `$.${i}`;
  if (ids.has(entry?.id)) errors.push(`${p}: duplicate id ${entry.id}`);
  ids.add(entry?.id);

  const modelPath = entry?.modelPath;
  if (typeof modelPath === "string") {
    const full = path.join(root, modelPath);
    if (!fs.existsSync(full)) errors.push(`${p}: modelPath does not exist: ${modelPath}`);
  }

  const allowed = new Set(entry?.allowedModes || []);
  if (entry?.inputs && entry?.expected?.outcomes) {
    const names = new Set(entry.inputs.map((x) => x.name));
    for (const o of entry.expected.outcomes) {
      if (!names.has(o.input)) errors.push(`${p}.expected.outcomes: unknown input ${o.input}`);
    }
  }
}

if (errors.length) {
  console.error("samples:verify FAILED");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`samples:verify passed (${manifest.length} sample(s))`);
