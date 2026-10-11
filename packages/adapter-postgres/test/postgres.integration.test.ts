import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Client } from "pg";
import { PostgresStore } from "../src/index.js";

const connectionString = process.env.KERANGKA_POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("PostgreSQL Store integration", () => {
  const kir = compile(
    JSON.stringify({
      kerangka: "0.1",
      app: "postgres-integration",
      multitenancy: { strategy: "discriminator", field: "tenantId" },
      entities: {
        Item: {
          key: "id",
          fields: {
            id: "string!",
            qty: "int!",
            label: "string!",
          },
        },
      },
    }),
  );
  let client: Client;
  let store: PostgresStore;

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query("DROP TABLE IF EXISTS item CASCADE");
    store = new PostgresStore({
      kir,
      executor: {
        query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          (await client.query(sql, params)) as unknown as { rows: R[] },
      },
    });
    await store.initSchema();
  });

  afterAll(async () => {
    await client.query("DROP TABLE IF EXISTS item CASCADE");
    await client.end();
  });

  it("filters, searches, sorts, paginates, and isolates tenants against PostgreSQL", async () => {
    await store.create("Item", { id: "a-1", tenantId: "tenant-a", qty: 10, label: "Alpha" }, { tenantId: "tenant-a" });
    await store.create("Item", { id: "a-2", tenantId: "tenant-a", qty: 20, label: "Beta" }, { tenantId: "tenant-a" });
    await store.create("Item", { id: "b-1", tenantId: "tenant-b", qty: 99, label: "Alpha" }, { tenantId: "tenant-b" });

    const result = await store.find("Item", undefined, {
      tenantId: "tenant-a",
      where: [">", ["get", "qty"], 5],
      search: "a",
      sort: { qty: "desc" },
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(["a-2", "a-1"]);
    expect(result.items.every((item) => item.tenantId === "tenant-a")).toBe(true);
  });
});
