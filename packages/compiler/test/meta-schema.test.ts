/**
 * The model meta-schema, and the two descriptions of it that can drift apart.
 *
 * There are two: the checks in `meta-schema.ts`, which is what the compiler runs, and the
 * JSON Schema it publishes, which is what an editor or any existing validator uses. Nothing
 * forces them to agree, so these tests do. Everything here is about the pair rather than
 * about either one alone.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/index.js";
import { CompilerError } from "../src/types.js";
import {
  validateModelStructure,
  modelSchema,
  ROOT_KEYS,
  ENTITY_KEYS,
  FIELD_KEYS,
  MODEL_SCHEMA_URI
} from "../src/meta-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

/** The keys of an interface, read from `types.ts` rather than from a list kept beside it. */
function interfaceKeys(interfaceName: string): string[] {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/types.ts"), "utf-8");
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found in types.ts`).toBeGreaterThan(-1);

  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  return [...new Set([...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1] as string))].sort();
}

const codes = (doc: unknown): string[] => validateModelStructure(doc).map((d) => d.code);
const messages = (doc: unknown): string[] => validateModelStructure(doc).map((d) => d.message);

/** Wrap a document in the smallest thing that compiles, so only the mutation is at fault. */
const minimal = () => ({
  kerangka: "0.1",
  app: "probe",
  entities: { Thing: { fields: { name: "string" } } }
});

describe("the model meta-schema", () => {
  describe("the key lists are derived from the types, not remembered", () => {
    it("knows every key EntityDefinition declares", () => {
      // The list was written from memory first and said `computed` where the language says
      // `compute`, which made every computed field in every shipped example an error. This
      // is the test that stops that recurring: the interface is the authority.
      const declared = interfaceKeys("EntityDefinition");
      const known = ENTITY_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `ENTITY_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key FieldDefinition declares", () => {
      const declared = interfaceKeys("FieldDefinition");
      const known = FIELD_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `FIELD_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("lists no key the compiler does not honour", () => {
      // The other direction, and it is the one that changes behaviour. The vocabulary is
      // closed — `toJsonSchemaField` reads one key at a time — so a key that is neither
      // declared nor read does nothing whatever. A padded list accepts `"indexed": true` on a
      // field and drops it, which is the exact defect this layer exists to report.
      const honoured = (interfaceName: string, mapper: string) => {
        const declared = new Set(interfaceKeys(interfaceName));
        const source = fs.readFileSync(path.resolve(__dirname, mapper), "utf-8");
        const read = new Set([...source.matchAll(/field\.([a-zA-Z]+)/g)].map((m) => m[1] as string));
        // `js` comes from a `field.js` string in a code example; not a field key.
        read.delete("js");
        return new Set([...declared, ...read]);
      };

      const entityHonoured = honoured("EntityDefinition", "../src/types.ts");
      const entityExtras = (ENTITY_KEYS as readonly string[]).filter((k) => !entityHonoured.has(k));
      expect(
        entityExtras,
        `ENTITY_KEYS has keys nothing reads: ${entityExtras.join(", ")}`
      ).toEqual([]);

      const fieldHonoured = honoured("FieldDefinition", "../src/projections/json-schema-field.ts");
      const fieldExtras = (FIELD_KEYS as readonly string[]).filter((k) => !fieldHonoured.has(k));
      expect(
        fieldExtras,
        `FIELD_KEYS has keys nothing reads: ${fieldExtras.join(", ")}`
      ).toEqual([]);
    });

    it("reports a field key the language does not honour, rather than dropping it", () => {
      // What the trimmed list buys. `indexed` reads nothing anywhere in the compiler, so
      // writing it used to succeed and do nothing — the silent half of a typo.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: "string", indexed: true } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("UNKNOWN_KEY");
      const reported = diagnostics.find((d) => d.path?.endsWith("/indexed"));
      expect(reported?.message).toMatch(/'indexed'/);
    });
  });

  describe("it does not reject Kerangka's own examples", () => {
    // The first version of this file flagged every entity in every example, because it
    // checked that a field's value was an object and the field shorthand writes it as a
    // string. A meta-schema that rejects the shipped models is not a meta-schema.
    for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith(".json"))) {
      it(`accepts ${file}`, () => {
        const source = fs.readFileSync(path.join(examplesDir, file), "utf-8");
        const doc = JSON.parse(source);
        const diagnostics = validateModelStructure(doc);
        expect(
          diagnostics.map((d) => `${d.code} ${d.path}: ${d.message}`)
        ).toEqual([]);
      });
    }
  });

  describe("a malformed document is a diagnostic, not a crash or a silent success", () => {
    /**
     * Each of these passed through the compiler untouched before. A typo'd key dropped every
     * field on the entity and compiled clean, which is the worst outcome available: a model
     * that means something other than what was written, with no error to say so.
     */
    it("rejects an unknown root key, and says what it might have been", () => {
      const doc = { ...minimal(), totallyUnknownKey: { a: 1 } };
      expect(codes(doc)).toContain("UNKNOWN_KEY");
      const diagnostic = validateModelStructure(doc).find((d) => d.code === "UNKNOWN_KEY");
      expect(diagnostic?.path).toBe("/totallyUnknownKey");
      expect(diagnostic?.hint).toMatch(/Did you mean|Valid root keys/);
    });

    it("suggests the right key for a near miss", () => {
      // `fieds` is the typo this whole layer exists for, and the suggestion is the part that
      // saves the author's afternoon.
      const doc = { ...minimal(), entities: { Thing: { fieds: { name: "string" } } } };
      const diagnostic = validateModelStructure(doc).find((d) => d.code === "UNKNOWN_KEY");
      expect(diagnostic?.hint).toBe("Did you mean 'fields'?");
    });

    it("rejects an entity that is not an object, instead of dropping it", () => {
      const doc = { ...minimal(), entities: { Thing: "Thing" } };
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const diagnostic = validateModelStructure(doc).find((d) => d.path === "/entities/Thing");
      expect(diagnostic?.message).toMatch(/must be an object, not a string/);
    });

    it("rejects a field with no type, which used to throw a TypeError", () => {
      // Before this layer, a field declared `{ "required": true }` reached the semantic
      // validator as `undefined` and produced `Cannot read properties of undefined (reading
      // 'length')` — a stack trace in a user's face instead of a diagnostic with a pointer.
      const doc = { ...minimal(), entities: { Thing: { fields: { nickname: { required: true } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_FIELD_TYPE");
      const diagnostic = diagnostics.find((d) => d.code === "MISSING_FIELD_TYPE");
      expect(diagnostic?.path).toBe("/entities/Thing/fields/nickname");
      expect(diagnostic?.message).toMatch(/Thing\.nickname/);
    });

    it("rejects fields declared as a list", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: [] } } };
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/fields' must be an object of field declarations/);
    });

    it("rejects a non-string type rather than passing it to the resolver", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: 42 } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("SCHEMA_INVALID");
      expect(diagnostics.find((d) => d.path?.endsWith("/type"))?.message).toMatch(/non-string type/);
    });

    it("leaves an unresolvable type to the semantic validator", () => {
      // `"type": "NotAType"` is well-formed and does not resolve. It is not this layer's
      // job, and duplicating the resolver here would mean two places to keep in step.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: "NotAType" } } } } };
      expect(codes(doc)).toEqual([]);
      // And it is still caught, by the layer that owns it.
      expect(() => compile(JSON.stringify(doc))).toThrow(CompilerError);
    });

    it("rejects a root key that should be a list but is a scalar", () => {
      const doc = { ...minimal(), roles: "admin" };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("SCHEMA_INVALID");
      const reported = diagnostics.find((d) => d.path === "/roles");
      expect(reported?.message).toMatch(/'roles' must be an array/);
    });
  });

  describe("the compiler runs it before anything else touches the document", () => {
    it("reports a structural error as a diagnostic with a pointer, not a TypeError", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: { nickname: { required: true } } } } };
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CompilerError);
      const diagnostics = (thrown as CompilerError).diagnostics ?? [];
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_FIELD_TYPE");
      const reported = diagnostics.find((d) => d.code === "MISSING_FIELD_TYPE");
      expect(reported?.path).toBe("/entities/Thing/fields/nickname");
    });

    it("collects every structural error rather than stopping at the first", () => {
      // One error per run is a worse experience than a list, and a structural layer that
      // bails early makes the author fix-and-rerun once per mistake.
      const doc = {
        ...minimal(),
        bogusRoot: 1,
        entities: { Thing: { fieds: {}, fields: { a: { required: true } } } }
      };
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      const diagnostics: Array<{ code: string }> = (thrown as CompilerError).diagnostics ?? [];
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    });

    it("still compiles a sound document", () => {
      expect(compile(JSON.stringify(minimal())).app).toBe("probe");
    });
  });

  describe("the published schema and the checks describe the same shape", () => {
    const schema = modelSchema() as {
      required: string[];
      properties: Record<string, unknown>;
      $id: string;
    };

    it("is a 2020-12 document with a stable id", () => {
      expect((schema as Record<string, unknown>).$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema"
      );
      expect(schema.$id).toBe(MODEL_SCHEMA_URI);
    });

    it("requires the same root keys the checks do", () => {
      // `app` is checked by the compiler's own MISSING_APP_NAME, and `kerangka` here; the
      // schema has to agree or an editor will accept a document the compiler refuses.
      expect(schema.required).toEqual(expect.arrayContaining(["kerangka", "app"]));
    });

    it("names every root key the checks know", () => {
      // Not `additionalProperties: false` — see below — but a key the schema is silent about
      // is a key an editor will grey out or mis-complete.
      for (const key of ROOT_KEYS) {
        expect(schema.properties, `the schema is silent about '${key}'`).toHaveProperty(key);
      }
    });

    it("permits unknown root keys, and says why in the schema itself", () => {
      // The checks report an unknown key as a diagnostic. A validator that *rejected* one
      // would be wrong the moment the language gains a key, and the language gains them
      // faster than schemas get updated. So the schema is permissive and the compiler is
      // strict: a human reads the diagnostic, a tool is not blocked by a stale schema.
      expect((schema as Record<string, unknown>).additionalProperties).toBe(true);
    });

    it("agrees with the checks about a field needing a type", () => {
      const entity = schema.properties.entities as {
        additionalProperties: { properties: { fields: { additionalProperties: { required: string[] } } } }
      };
      expect(entity.additionalProperties.properties.fields.additionalProperties.required).toEqual([
        "type"
      ]);
      // And the checks agree: both reject a field with no type.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { required: true } } } } };
      expect(codes(doc)).toContain("MISSING_FIELD_TYPE");
    });
  });
});

describe("the published schema file", () => {
  const schemaPath = path.resolve(__dirname, "../schemas/kerangka.model.schema.json");

  it("exists, so an editor has something to point $schema at", () => {
    // The schema is only useful if it is reachable. `modelSchema()` is what the tests
    // check; this is what a human's editor reads, and the two drifting is the whole risk.
    expect(fs.existsSync(schemaPath), `${schemaPath} is missing`).toBe(true);
  });

  it("is the same document the compiler validates against", () => {
    const published = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    expect(published).toEqual(modelSchema());
  });
});
