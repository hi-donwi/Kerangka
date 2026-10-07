import { describe, expect, it } from "vitest";
import type { CloudEvent, Effect } from "@kerangka/engine-ts";
import { PostgresSessionStore } from "../src/session-store-postgres.js";
import type { PostgresSessionExecutor } from "../src/session-store-postgres.js";

/**
 * The Postgres session store is tested against a scripted executor, not a live
 * database: CI has no Postgres, and the suite's job is the store's decisions —
 * what runs inside a transaction, what locks, what dedupes, what refuses —
 * not the driver's. Every statement is recorded so the assertions name the SQL
 * the store chose to send, in the order it chose to send it.
 *
 * The fake emulates exactly the semantics the store relies on: one connection
 * per transaction, rollback discarding writes, ON CONFLICT ... RETURNING
 * reporting whether a row was inserted, and nothing else. Where it is simpler
 * than Postgres (no MVCC, no types), the tests do not depend on the difference.
 */

type Row = Record<string, unknown>;

interface Recorded {
  sql: string;
  values: unknown[];
  inTx: boolean;
}

const recordKey = (entity: string, id: string) => `${entity}\u0000${id}`;

class FakeExecutor implements PostgresSessionExecutor {
  readonly log: Recorded[] = [];
  private meta = new Map<string, string>([["revision", "0"]]);
  private records = new Map<string, Row>();
  private outbox = new Map<string, Row>();
  private effects = new Map<string, Row>();
  private claims = new Set<string>();
  private inTx = false;
  private ddlRuns = 0;
  /** When set, the next plain INSERT fails, as a constraint or connection would. */
  failInserts = false;

  get ddlCount(): number {
    return this.ddlRuns;
  }

  sql(): string[] {
    return this.log.map((entry) => entry.sql);
  }

  statementsInTransaction(): string[] {
    return this.log.filter((entry) => entry.inTx).map((entry) => entry.sql);
  }

  revision(): number {
    return Number(this.meta.get("revision"));
  }

  recordRows(): Row[] {
    return [...this.records.values()];
  }

  async query(rawSql: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.log.push({ sql: rawSql, values, inTx: this.inTx });
    // The needles below are matched against a whitespace-normalised form, so the store's
    // multi-line SQL and a one-line needle mean the same statement.
    const sql = rawSql.replace(/\s+/g, " ").trim();

    if (sql.includes("CREATE TABLE")) {
      this.ddlRuns += 1;
      return { rows: [] };
    }
    if (sql.includes("SELECT value FROM _session_meta")) {
      return { rows: [{ value: this.meta.get("revision")! }] };
    }
    if (sql.includes("UPDATE _session_meta")) {
      this.meta.set("revision", String(values[0]));
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM")) {
      if (sql.includes("_session_records")) this.records.clear();
      if (sql.includes("_session_outbox")) this.outbox.clear();
      if (sql.includes("_session_effects")) this.effects.clear();
      if (sql.includes("_session_claims")) this.claims.clear();
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO _session_records")) {
      if (this.failInserts) throw new Error("_session_records: insert failed");
      const [entity, id, revision, data] = values as [string, string, number, string];
      this.records.set(recordKey(entity, id), { entity, id, revision, data });
      return { rows: [] };
    }
    if (sql.includes("SELECT data FROM _session_records WHERE entity = $1 AND id = $2")) {
      const row = this.records.get(recordKey(String(values[0]), String(values[1])));
      return row ? { rows: [{ data: row.data }] } : { rows: [] };
    }
    if (sql.includes("SELECT 1 AS present FROM _session_records")) {
      const row = this.records.get(recordKey(String(values[0]), String(values[1])));
      return row ? { rows: [{ present: 1 }] } : { rows: [] };
    }
    if (sql.includes("SELECT data FROM _session_records WHERE entity = $1 ORDER BY id")) {
      const rows = [...this.records.values()]
        .filter((row) => row.entity === values[0])
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((row) => ({ data: row.data }));
      return { rows };
    }
    if (sql.includes("SELECT revision FROM _session_records")) {
      const row = this.records.get(recordKey(String(values[0]), String(values[1])));
      return row ? { rows: [{ revision: row.revision }] } : { rows: [] };
    }
    if (sql.includes("SELECT DISTINCT entity FROM _session_records")) {
      return { rows: [...new Set([...this.records.values()].map((row) => row.entity))].sort().map((entity) => ({ entity })) };
    }

    if (sql.includes("INSERT INTO _session_outbox") && sql.includes("ON CONFLICT (id) DO NOTHING RETURNING id")) {
      const [id, event, entity, revision] = values as [string, string, string | null, number];
      if (this.outbox.has(id)) return { rows: [] };
      this.outbox.set(id, { id, event, entity, attempts: 0, state: "pending", last_error: null, revision });
      return { rows: [{ id }] };
    }
    if (sql.includes("INSERT INTO _session_outbox")) {
      if (this.failInserts) throw new Error("_session_outbox: insert failed");
      const [id, event, entity, revision] = values as [string, string, string | null, number];
      this.outbox.set(id, { id, event, entity, attempts: 0, state: "pending", last_error: null, revision });
      return { rows: [] };
    }
    if (sql.includes("SELECT id, event, entity, attempts, state, last_error, revision FROM _session_outbox")) {
      let rows = [...this.outbox.values()];
      if (sql.includes("WHERE state = 'pending'")) rows = rows.filter((row) => row.state === "pending");
      if (sql.includes("WHERE id = $1")) rows = rows.filter((row) => row.id === values[0]);
      return { rows: rows.sort((a, b) => Number(a.revision) - Number(b.revision)) };
    }
    if (sql.includes("UPDATE _session_outbox SET state = 'delivered'")) {
      const row = this.outbox.get(String(values[0]));
      if (row) this.outbox.set(String(values[0]), { ...row, state: "delivered", last_error: null });
      return { rows: [] };
    }
    if (sql.includes("UPDATE _session_outbox SET state = 'pending'")) {
      const row = this.outbox.get(String(values[0]));
      if (row) {
        this.outbox.set(String(values[0]), {
          ...row,
          state: "pending",
          attempts: Number(row.attempts) + 1,
          last_error: (values[1] as string | null) ?? null
        });
      }
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO _session_effects")) {
      if (this.failInserts) throw new Error("_session_effects: insert failed");
      const [id, effect, revision] = values as [string, string, number];
      this.effects.set(id, { id, effect, attempts: 0, state: "pending", last_error: null, revision });
      return { rows: [] };
    }
    if (sql.includes("SELECT id, effect, attempts, state, last_error, revision FROM _session_effects")) {
      let rows = [...this.effects.values()];
      if (sql.includes("WHERE state = 'pending'")) rows = rows.filter((row) => row.state === "pending");
      if (sql.includes("WHERE id = $1")) rows = rows.filter((row) => row.id === values[0]);
      return { rows: rows.sort((a, b) => Number(a.revision) - Number(b.revision)) };
    }
    if (sql.includes("UPDATE _session_effects SET state = 'delivered'")) {
      const row = this.effects.get(String(values[0]));
      if (row) this.effects.set(String(values[0]), { ...row, state: "delivered", last_error: null });
      return { rows: [] };
    }
    if (sql.includes("UPDATE _session_effects SET state = 'pending'")) {
      const row = this.effects.get(String(values[0]));
      if (row) {
        this.effects.set(String(values[0]), {
          ...row,
          state: "pending",
          attempts: Number(row.attempts) + 1,
          last_error: (values[1] as string | null) ?? null
        });
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT COUNT(*) AS n FROM _session_effects")) {
      return { rows: [{ n: this.effects.size }] };
    }

    if (sql.includes("INSERT INTO _session_claims") && sql.includes("ON CONFLICT (key) DO NOTHING RETURNING key")) {
      const key = String(values[0]);
      if (this.claims.has(key)) return { rows: [] };
      this.claims.add(key);
      return { rows: [{ key }] };
    }
    if (sql.includes("SELECT key FROM _session_claims")) {
      return { rows: [...this.claims].sort().map((key) => ({ key })) };
    }

    throw new Error(`FakeExecutor has no answer for: ${sql}`);
  }

  async transaction<R>(fn: (tx: PostgresSessionExecutor) => Promise<R>): Promise<R> {
    if (this.inTx) throw new Error("the fake does not nest transactions");
    const saved = {
      meta: new Map(this.meta),
      records: new Map(this.records),
      outbox: new Map(this.outbox),
      effects: new Map(this.effects),
      claims: new Set(this.claims)
    };
    this.inTx = true;
    this.log.push({ sql: "-- BEGIN", values: [], inTx: true });
    try {
      const result = await fn(this);
      this.log.push({ sql: "-- COMMIT", values: [], inTx: true });
      return result;
    } catch (err) {
      this.meta = saved.meta;
      this.records = saved.records;
      this.outbox = saved.outbox;
      this.effects = saved.effects;
      this.claims = saved.claims;
      this.log.push({ sql: "-- ROLLBACK", values: [], inTx: true });
      throw err;
    } finally {
      this.inTx = false;
    }
  }
}

const event = (id: string, type = "invoice.sent"): CloudEvent => ({
  id,
  type,
  source: "kerangka://test",
  subject: "inv-1"
} as CloudEvent);

const persist = (entity: string, id: string, extra: Row = {}): Effect => ({
  type: "persist",
  entity,
  record: { id, ...extra }
} as unknown as Effect);

const call = (name: string): Effect => ({ type: "call", name } as unknown as Effect);

const openStore = () => {
  const executor = new FakeExecutor();
  const store = new PostgresSessionStore({ executor });
  return { executor, store };
};

describe("schema", () => {
  it("creates the five tables once, lazily, before the first statement that needs them", async () => {
    const { executor, store } = openStore();
    await store.get("Invoice", "inv-1");

    expect(executor.ddlCount).toBe(5);
    const sql = executor.sql();
    const firstDdl = sql.findIndex((s) => s.includes("CREATE TABLE"));
    const firstRead = sql.findIndex((s) => s.includes("SELECT data FROM _session_records"));
    expect(firstDdl).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeGreaterThan(firstDdl);

    await store.get("Invoice", "inv-1");
    expect(executor.ddlCount).toBe(5);
  });

  it("opens eagerly for a caller that wants the schema before the first request", async () => {
    const { executor, store } = openStore();
    await PostgresSessionStore.open({ executor: await Promise.resolve(executor) } as never);
    void store;
    expect(executor.ddlCount).toBe(5);
  });
});

describe("the commit path", () => {
  it("writes aggregates, events and the host's work in one transaction", async () => {
    const { executor, store } = openStore();
    const report = await store.applyEffects(
      "Invoice",
      [persist("Invoice", "inv-1", { total: 10 }), call("notify")],
      [event("e-1")]
    );

    expect(report).toEqual({ persisted: 1, enqueued: 1, queuedEffects: 1, ids: ["inv-1"] });
    const inTx = executor.statementsInTransaction();
    // The revision counter is read first, under a row lock, then everything is written.
    expect(inTx[1]).toContain("SELECT value FROM _session_meta");
    expect(inTx[1]).toContain("FOR UPDATE");
    expect(inTx.some((s) => s.includes("INSERT INTO _session_records"))).toBe(true);
    expect(inTx.some((s) => s.includes("INSERT INTO _session_outbox"))).toBe(true);
    expect(inTx.some((s) => s.includes("INSERT INTO _session_effects"))).toBe(true);
    expect(inTx).toContain("-- COMMIT");
    expect(executor.revision()).toBe(1);
  });

  it("mints ids at the revision the commit took", async () => {
    const { store } = openStore();
    await store.applyEffects("Invoice", [persist("Invoice", "inv-1")], [event("e-1")]);
    await store.applyEffects("Invoice", [], [event("e-2")]);
    await store.applyEffects("Invoice", [call("notify")], []);

    const events = await store.events();
    expect(events.map((e) => e.id)).toEqual(["e-1", "e-2"]);
    const effects = await store.pendingEffects();
    expect(effects.map((e) => e.id)).toEqual(["effect-3-0"]);
  });

  it("refuses an unaddressable aggregate before any statement runs", async () => {
    const { executor, store } = openStore();
    await expect(
      store.applyEffects("Invoice", [persist("Invoice", "")] as never, undefined)
    ).rejects.toMatchObject({ code: "EFFECTS_NOT_APPLIED", reason: "unaddressable" });

    expect(executor.sql()).toEqual([]);
  });

  it("answers an empty commit with a zero report and no SQL", async () => {
    const { executor, store } = openStore();
    const report = await store.applyEffects("Invoice", undefined, undefined);

    expect(report).toEqual({ persisted: 0, enqueued: 0, queuedEffects: 0, ids: [] });
    expect(executor.sql()).toEqual([]);
  });

  it("rolls the whole commit back when an insert fails, and the revision survives", async () => {
    const { executor, store } = openStore();
    await store.applyEffects("Invoice", [persist("Invoice", "inv-1")], [event("e-1")]);
    executor.failInserts = true;

    await expect(
      store.applyEffects("Invoice", [persist("Invoice", "inv-2")], [event("e-2")])
    ).rejects.toThrow("insert failed");

    // The log spans every transaction this executor ran, and the first, successful
    // commit of the test logged a COMMIT of its own. The failed one is the statements
    // after its BEGIN: the last transaction the log holds.
    const inTx = executor.statementsInTransaction();
    const lastBegin = inTx.lastIndexOf("-- BEGIN");
    expect(inTx.slice(lastBegin)).toEqual(["-- BEGIN", expect.stringContaining("SELECT value FROM _session_meta"), expect.stringContaining("INSERT INTO _session_records"), "-- ROLLBACK"]);
    expect(executor.revision()).toBe(1);
    expect(await store.get("Invoice", "inv-2")).toBeNull();
  });

  it("refuses a write that cannot be atomic rather than writing half a run", async () => {
    const executor = { query: async () => ({ rows: [] as Row[] }) };
    const store = new PostgresSessionStore({ executor });

    await expect(
      store.applyEffects("Invoice", [persist("Invoice", "inv-1")], [event("e-1")])
    ).rejects.toThrow(/transaction/);
    expect(executor.log ?? []).toHaveLength(0);
  });
});

describe("aggregates", () => {
  it("reads back what a commit wrote, with revisions", async () => {
    const { store } = openStore();
    await store.applyEffects("Invoice", [persist("Invoice", "inv-1", { total: 10 })], []);

    expect(await store.get("Invoice", "inv-1")).toEqual({ id: "inv-1", total: 10 });
    expect(await store.has("Invoice", "inv-1")).toBe(true);
    expect(await store.has("Invoice", "inv-2")).toBe(false);
    expect(await store.revisionOf("Invoice", "inv-1")).toBe(1);
    expect(await store.revisionOf("Invoice", "inv-2")).toBeNull();
    expect(await store.list("Invoice")).toEqual([{ id: "inv-1", total: 10 }]);
    expect(await store.entities()).toEqual(["Invoice"]);
  });

  it("seeds through put, which takes the next revision", async () => {
    const { store } = openStore();
    await store.put("Invoice", { id: "inv-1" });
    await store.put("Invoice", { id: "inv-2" });

    expect(await store.revisionOf("Invoice", "inv-2")).toBe(2);
    expect(await store.list("Invoice")).toEqual([{ id: "inv-1" }, { id: "inv-2" }]);
  });
});

describe("the outbox", () => {
  it("lists pending events oldest first, claiming them with SKIP LOCKED", async () => {
    const { executor, store } = openStore();
    await store.applyEffects("Invoice", [], [event("e-1"), event("e-2")]);

    const pending = await store.pending();
    expect(pending.map((entry) => entry.id)).toEqual(["e-1", "e-2"]);
    const select = executor.sql().find((s) => s.includes("FROM _session_outbox") && s.includes("WHERE state = 'pending'"));
    expect(select).toContain("FOR UPDATE SKIP LOCKED");
    expect(select).toContain("ORDER BY revision ASC");
  });

  it("keeps a delivered event as history, and a nacked one pending with its attempts", async () => {
    const { store } = openStore();
    await store.applyEffects("Invoice", [], [event("e-1")]);

    const acked = await store.ack("e-1");
    expect(acked?.state).toBe("delivered");
    expect((await store.pending()).map((e) => e.id)).toEqual([]);

    const nacked = await store.nack("e-1", "smtp down");
    expect(nacked).toMatchObject({ state: "pending", attempts: 1, lastError: "smtp down" });
    expect((await store.pending()).map((e) => e.id)).toEqual(["e-1"]);
    expect(await store.nack("missing", "x")).toBeNull();
  });

  it("serves the whole event log, filtered by type when asked", async () => {
    const { store } = openStore();
    await store.applyEffects("Invoice", [], [event("e-1", "invoice.sent"), event("e-2", "invoice.paid")]);

    expect((await store.events()).map((e) => e.id)).toEqual(["e-1", "e-2"]);
    expect((await store.events("invoice.paid")).map((e) => e.id)).toEqual(["e-2"]);
    expect((await store.outboxEntry("e-1"))?.state).toBe("pending");
    expect(await store.outboxEntry("missing")).toBeNull();
  });

  it("queues a retried run's event once, by CloudEvent id", async () => {
    const { store } = openStore();
    await store.enqueueDelivery([event("e-1")], undefined, "Invoice");
    const second = await store.enqueueDelivery([event("e-1")], undefined, "Invoice");

    expect(second.events).toEqual([]);
    expect((await store.events()).map((e) => e.id)).toEqual(["e-1"]);
  });

  it("writes the events and the failed effects of one delivery in one transaction", async () => {
    const { executor, store } = openStore();
    const result = await store.enqueueDelivery([event("e-1")], [call("notify")], "Invoice");

    expect(result.events).toHaveLength(1);
    expect(result.effects).toHaveLength(1);
    const inTx = executor.statementsInTransaction();
    expect(inTx).toContain("-- BEGIN");
    expect(inTx).toContain("-- COMMIT");
    expect(inTx.filter((s) => s.includes("INSERT INTO _session_outbox"))).toHaveLength(1);
    expect(inTx.filter((s) => s.includes("INSERT INTO _session_effects"))).toHaveLength(1);
  });
});

describe("host effects", () => {
  it("keeps a standalone failure in its own id namespace", async () => {
    const { store } = openStore();
    await store.applyEffects("Invoice", [call("a")], [event("e-1")]);
    const entry = await store.enqueueEffect(call("b"));

    // A commit mints `effect-<revision>-<index>` at the next revision, which is the
    // one the standalone enqueue takes, so sharing the scheme would collide.
    expect(entry.id).toMatch(/^failed-effect-2-\d+$/);
    expect((await store.pendingEffects()).map((e) => e.id)).toEqual(["effect-1-0", entry.id]);
  });

  it("counts attempts on nack and clears them on ack, like the outbox", async () => {
    const { store } = openStore();
    const entry = await store.enqueueEffect(call("notify"));

    const nacked = await store.nackEffect(entry.id, "extension unreachable");
    expect(nacked).toMatchObject({ state: "pending", attempts: 1, lastError: "extension unreachable" });

    const acked = await store.ackEffect(entry.id);
    expect(acked?.state).toBe("delivered");
    expect(await store.pendingEffects("call")).toEqual([]);
    expect((await store.hostEffect(entry.id))?.state).toBe("delivered");
    expect(await store.hostEffect("missing")).toBeNull();
  });
});

describe("idempotency claims", () => {
  it("lets the first claim win and tells the replay it was handled", async () => {
    const { executor, store } = openStore();
    expect(await store.claim("e-1:policy-a")).toBe(true);
    expect(await store.claim("e-1:policy-a")).toBe(false);
    expect(await store.claims()).toEqual(["e-1:policy-a"]);

    const insert = executor.sql().find((s) => s.includes("INSERT INTO _session_claims"));
    expect(insert).toContain("ON CONFLICT (key) DO NOTHING RETURNING key");
  });
});

describe("clear", () => {
  it("wipes everything the session holds, in one transaction", async () => {
    const { executor, store } = openStore();
    await store.applyEffects("Invoice", [persist("Invoice", "inv-1"), call("notify")], [event("e-1")]);
    await store.claim("e-1:policy-a");

    await store.clear();

    const inTx = executor.statementsInTransaction();
    expect(inTx).toContain("-- BEGIN");
    expect(inTx).toContain("-- COMMIT");
    expect(await store.list("Invoice")).toEqual([]);
    expect(await store.events()).toEqual([]);
    expect(await store.pendingEffects()).toEqual([]);
    expect(await store.claims()).toEqual([]);
    expect(executor.revision()).toBe(0);
  });
});
