import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile, generateAsyncAPI } from "@kerangka/compiler";

/**
 * Events are the contract between contexts and services (PLAN.md §7.6, §11 L0). A
 * consumer that has this document must be able to subscribe without reading the model.
 */
const examplesDir = resolve(__dirname, "../../../examples");
const invoicing = compile(
  readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8"),
  { sourceFile: "invoicing.kerangka.json" }
);
const commerce = compile(readFileSync(resolve(examplesDir, "commerce/kerangka.json"), "utf8"), {
  sourcePath: resolve(examplesDir, "commerce/kerangka.json"),
});

describe("AsyncAPI 3.0 projection", () => {
  it("declares the document version AsyncAPI expects", () => {
    const doc = generateAsyncAPI(invoicing) as Record<string, unknown>;

    expect(doc.asyncapi).toBe("3.0.0");
    expect((doc.info as { title: string }).title).toContain("Invoicing");
    expect((doc.servers as Record<string, { protocol: string } | undefined>).production?.protocol).toBe(
      "kafka"
    );
  });

  it("gives every declared event a channel and a receive operation", () => {
    const doc = generateAsyncAPI(invoicing) as {
      channels: Record<string, { address: string }>;
      operations: Record<string, { action: string; channel: { $ref: string } }>;
    };

    expect(Object.keys(doc.channels)).toEqual(["InvoiceSent"]);
    expect(doc.channels.InvoiceSent?.address).toBe("InvoiceSent");
    expect(doc.operations.onInvoiceSent?.action).toBe("receive");
    expect(doc.operations.onInvoiceSent?.channel.$ref).toBe("#/channels/InvoiceSent");
  });

  it("uses the CloudEvents binding rather than a hand-rolled envelope", () => {
    const doc = generateAsyncAPI(invoicing) as {
      components: { messages: Record<string, { contentType: string; bindings: { cloudevents: { version: string } } }> };
    };

    const message = doc.components.messages.InvoiceSentMessage;
    expect(message?.contentType).toBe("application/cloudevents+json");
    expect(message?.bindings.cloudevents.version).toBe("1.0");
  });

  it("describes only the data inside the envelope", () => {
    const doc = generateAsyncAPI(invoicing) as {
      components: {
        messages: Record<string, { payload: { $ref: string } }>;
        schemas: Record<string, { properties: Record<string, { type: string }>; required?: string[] }>;
      };
    };

    expect(doc.components.messages.InvoiceSentMessage?.payload.$ref).toBe(
      "#/components/schemas/InvoiceSentData"
    );
    const data = doc.components.schemas.InvoiceSentData;
    expect(Object.keys(data?.properties ?? {})).toEqual(["invoice"]);
    expect(data?.required).toEqual(["invoice"]);
  });

  it("names who emits an event and who listens for it", () => {
    const doc = generateAsyncAPI(invoicing) as {
      components: {
        messages: Record<
          string,
          { "x-kerangka-emitted-by": string[]; "x-kerangka-listeners": string[] }
        >;
      };
    };

    const message = doc.components.messages.InvoiceSentMessage;
    expect(message?.["x-kerangka-emitted-by"]).toEqual(["Invoice.send"]);
    expect(message?.["x-kerangka-listeners"]).toEqual([]);
  });

  it("maps event field types to JSON Schema", () => {
    const model = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "evented",
        entities: {
          Thing: { fields: { id: "string!" } },
        },
        events: {
          ThingHappened: {
            at: "datetime!",
            day: "date",
            count: "int!",
            amount: "decimal(12,2)",
            ok: "bool",
            state: "enum(draft, done)",
            thingId: "ref(Thing)!",
            tags: "list<string>",
          },
        },
      })
    );
    const doc = generateAsyncAPI(model) as {
      components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> };
    };
    const props = doc.components.schemas.ThingHappenedData?.properties ?? {};

    expect(props.at).toMatchObject({ type: "string", format: "date-time" });
    expect(props.day).toMatchObject({ type: "string", format: "date" });
    expect(props.count).toMatchObject({ type: "integer" });
    expect(props.amount).toMatchObject({ type: "number" });
    expect(props.ok).toMatchObject({ type: "boolean" });
    expect(props.state).toMatchObject({ type: "string", enum: ["draft", "done"] });
    expect(props.thingId).toMatchObject({ type: "string", description: "Reference to Thing" });
    expect(props.tags).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("lists the policies that consume a cross-context event", () => {
    const doc = generateAsyncAPI(commerce) as {
      channels: Record<string, unknown>;
      components: {
        messages: Record<string, { "x-kerangka-listeners": string[]; "x-kerangka-emitted-by": string[] }>;
      };
    };

    const message = doc.components.messages.OrderPlacedMessage;
    // Both contexts react to the orders context's event; a consumer can see that here.
    expect(message?.["x-kerangka-listeners"].sort()).toEqual([
      "billing.onOrderPlaced",
      "inventory.onOrderPlaced",
    ]);
    expect(message?.["x-kerangka-emitted-by"]).toEqual(["Order.place"]);
  });

  it("takes a broker, a host, and a topic", () => {
    const doc = generateAsyncAPI(invoicing, {
      broker: "nats",
      host: "events.internal:4222",
      topic: "billing.events",
    }) as {
      servers: Record<string, { host: string; protocol: string; description: string } | undefined>;
    };
    const server = doc.servers.production;

    expect(server?.host).toBe("events.internal:4222");
    expect(server?.protocol).toBe("nats");
    expect(server?.description).toContain("billing.events");
  });

  it("emits an empty document for a model with no events", () => {
    const model = compile(JSON.stringify({ kerangka: "0.1", app: "quiet", entities: {} }));
    const doc = generateAsyncAPI(model) as {
      channels: Record<string, unknown>;
      operations: Record<string, unknown>;
    };

    expect(doc.channels).toEqual({});
    expect(doc.operations).toEqual({});
  });
});
