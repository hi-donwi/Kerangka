import { describe, expect, it } from "vitest";
import { compile, generateJSONSchema, JSON_SCHEMA_DIALECT } from "@kerangka/compiler";

/**
 * L0 promises a JSON Schema emitter, and §8 names its two readers: data shape and
 * forms. The document therefore has to be valid JSON Schema that a generator can use
 * without reading the Kerangka model — which is why facts the dialect cannot express
 * are published as annotations rather than dropped.
 */
const model = compile(
  JSON.stringify({
    kerangka: "0.1",
    app: "shapes",
    meta: { title: "Shapes" },
    entities: {
      Customer: {
        fields: {
          name: "string!",
          email: "email!",
          creditLimit: "decimal(12,2) >= 0 = 0"
        }
      },
      Invoice: {
        fields: {
          number: "string! unique",
          customer: "ref(Customer)!",
          issuedOn: "date! = today()",
          status: "enum(draft, sent) = draft",
          lines: "list(Line)",
          note: "string",
          total: { type: "decimal", scale: 2, precision: 12, compute: "sum(lines.qty * lines.unitPrice)" }
        }
      },
      Line: { embedded: true, fields: { qty: "int! >= 1" } }
    },
    events: {
      InvoiceSent: { invoice: "ref(Invoice)!" },
      InvoiceVoided: { invoice: "ref(Invoice)!" }
    }
  })
);

const defs = (options = {}) => generateJSONSchema(model, options).$defs as Record<string, any>;

describe("JSON Schema document", () => {
  it("declares the 2020-12 dialect and an id", () => {
    const document = generateJSONSchema(model);

    expect(document.$schema).toBe(JSON_SCHEMA_DIALECT);
    expect(document.$id).toBe("https://kerangka.dev/schemas/shapes.json");
    expect(document.title).toBe("Shapes data shape");
  });

  it("publishes one definition per entity and one per event payload", () => {
    expect(Object.keys(defs())).toEqual(["Customer", "Invoice", "Line", "InvoiceSent", "InvoiceVoided"]);
    expect(defs().InvoiceSent.description).toBe("payload of the InvoiceSent event");
  });

  it("lists required fields and leaves the rest optional", () => {
    expect(defs().Customer.required).toEqual(["name", "email"]);
    // A default does not make a field required: `status` has one and is still optional.
    expect(defs().Invoice.required).toEqual(["number", "customer", "issuedOn"]);
    expect(defs().Invoice.properties.note).toEqual({ type: "string" });
  });

  it("maps formats, bounds, and exact decimals", () => {
    const customer = defs().Customer.properties;

    expect(customer.email).toMatchObject({ type: "string", format: "email" });
    expect(customer.creditLimit).toMatchObject({
      type: "number",
      minimum: 0,
      default: 0,
      "x-kerangka-decimal": "decimal(12,2)"
    });
  });

  it("publishes uniqueness and a reference target as annotations", () => {
    expect(defs().Invoice.properties.number["x-kerangka-unique"]).toBe(true);
    expect(defs().Invoice.properties.customer).toMatchObject({
      type: "string",
      "x-kerangka-ref": "Customer"
    });
  });

  it("resolves a reference to an embedded entity through $ref, and a key through a string", () => {
    // Line is stored inline, so a list of it is a list of documents. Customer is not,
    // so a reference to it is a key.
    expect(defs().Invoice.properties.lines).toEqual({
      type: "array",
      items: { $ref: "#/$defs/Line" }
    });
    expect(defs().Invoice.properties.customer.$ref).toBeUndefined();
  });

  it("marks a computed field readOnly", () => {
    expect(defs().Invoice.properties.total.readOnly).toBe(true);
  });

  it("keeps an engine-computed default out of `default`", () => {
    // A form generator would prefill the literal text "today()".
    expect(defs().Invoice.properties.issuedOn).toMatchObject({
      type: "string",
      format: "date",
      "x-kerangka-default": "today()"
    });
    expect(defs().Invoice.properties.issuedOn.default).toBeUndefined();
    // A value JSON can carry stays a default.
    expect(defs().Invoice.properties.status).toMatchObject({ enum: ["draft", "sent"], default: "draft" });
  });

  it("is permissive by default and strict on request", () => {
    expect(defs().Invoice.additionalProperties).toBeUndefined();
    expect(defs({ strict: true }).Invoice.additionalProperties).toBe(false);
  });
});

describe("rooting the document", () => {
  it("roots at an entity for a form generator", () => {
    const document = generateJSONSchema(model, { entity: "Invoice" });

    expect(document.$ref).toBe("#/$defs/Invoice");
    // Every ref still resolves, because the whole catalogue travels with it.
    expect(document.$defs).toHaveProperty("Line");
  });

  it("roots at an event payload", () => {
    expect(generateJSONSchema(model, { event: "InvoiceSent" }).$ref).toBe("#/$defs/InvoiceSent");
  });

  it("leaves the catalogue unrooted when nothing is asked for", () => {
    expect(generateJSONSchema(model).$ref).toBeUndefined();
  });

  it("names what does not exist, and suggests the right spelling", () => {
    expect(() => generateJSONSchema(model, { entity: "invoice" })).toThrow(/Did you mean 'Invoice'/);
    expect(() => generateJSONSchema(model, { event: "Nothing" })).toThrow(
      /defines: Customer, Invoice, Line, InvoiceSent, InvoiceVoided/
    );
  });

  it("accepts a custom id", () => {
    expect(generateJSONSchema(model, { id: "https://example.test/shapes.json" }).$id).toBe(
      "https://example.test/shapes.json"
    );
  });
});

describe("a document a generator can consume", () => {
  /** The classic emitter bug: a `$ref` that points at nothing. */
  it("has no dangling $ref", () => {
    const document = generateJSONSchema(model);
    const pointers: string[] = [];
    JSON.stringify(document, (_key, value) => {
      if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          if (key === "$ref" && typeof nested === "string") pointers.push(nested);
        }
      }
      return value;
    });

    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      const name = pointer.replace("#/$defs/", "");
      expect(document.$defs).toHaveProperty([name]);
    }
  });

  it("names every definition, so a generator can label a field", () => {
    const document = generateJSONSchema(model);
    for (const [name, definition] of Object.entries(document.$defs as Record<string, any>)) {
      expect(definition.description).toBe(
        name.endsWith("Sent") || name.endsWith("Voided")
          ? `payload of the ${name} event`
          : `${name} record`
      );
      expect(definition.type).toBe("object");
    }
  });
});
