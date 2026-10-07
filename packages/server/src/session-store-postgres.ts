/**
 * Kerangka durable session store (PostgreSQL)
 *
 * The SQLite store proved the protocol survives a restart; this one proves it can share
 * a database with everything else a deployment already runs. It implements the whole
 * protocol in its promise-aware form (`AsyncSessionStoreLike`) over a caller-supplied
 * executor and imports no driver — like `adapter-postgres`, the SQL is the contract and
 * the connection is the caller's. The sync `SessionStoreLike` stays sync: a socket cannot
 * answer before it is asked, and every call site of that form reads its result inline.
 *
 * Where SQLite took a write lock on the whole file, this store locks one row: the
 * revision counter is read `SELECT ... FOR UPDATE` as the first statement inside the
 * commit transaction, so a second writer waits and then reads the first one's number.
 * `pending()` claims with `FOR UPDATE SKIP LOCKED`, so two hosts draining the outbox get
 * disjoint pending sets for as long as their transaction stays open. See ADR-0042.
 *
 * A write that cannot be atomic refuses rather than shrugs: an executor without a
 * `transaction` is an executor whose pool can split a commit across connections, and a
 * split commit is the half-run every other store refuses to hold.
 */

import type { CloudEvent, Effect } from "@kerangka/engine-ts";
import {
  AsyncSessionStoreLike,
  CommitReport,
  EffectApplicationError,
  HostEffectEntry,
  OutboxEntry
} from "./session-store.js";

/**
 * The executor this store runs on. Structural, not imported: `adapter-postgres`'s
 * `PostgresExecutor` satisfies it as-is, and so does any pool wrapper that can pin a
 * connection for `transaction`. See ADR-0042 for why the type travels without a
 * dependency.
 */
export interface PostgresSessionExecutor {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  /**
   * Run `fn` against one connection inside a transaction, committing when it resolves
   * and rolling back when it throws. Optional: reads and `claim` work without it, but
   * every write that must be atomic refuses without it.
   */
  transaction?<R>(fn: (tx: PostgresSessionExecutor) => Promise<R>): Promise<R>;
}

export interface PostgresSessionStoreOptions {
  /** The executor to run on. The store never closes or owns the underlying client. */
  executor: PostgresSessionExecutor;
}

interface Row {
  id: string;
  entity: string | null;
  revision: number;
  data: string;
  event: string;
  effect: string;
  attempts: number;
  state: string;
  last_error: string | null;
  value: string;
  n: number;
  key: string;
  present: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS _session_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS _session_records (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (entity, id)
  )`,
  `CREATE TABLE IF NOT EXISTS _session_outbox (
    id TEXT PRIMARY KEY,
    event JSONB NOT NULL,
    entity TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,
    last_error TEXT,
    revision INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS _session_effects (
    id TEXT PRIMARY KEY,
    effect JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,
    last_error TEXT,
    revision INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS _session_claims (
    key TEXT PRIMARY KEY
  )`
];

export class PostgresSessionStore implements AsyncSessionStoreLike {
  private readonly executor: PostgresSessionExecutor;
  private schema?: Promise<void>;

  constructor(options: PostgresSessionStoreOptions) {
    this.executor = options.executor;
  }

  /**
   * Construct and create the schema, for a caller that wants the tables in place
   * before the first request. The constructor alone is enough otherwise: the DDL is
   * idempotent and runs lazily once before the first statement that needs it.
   */
  static async open(options: PostgresSessionStoreOptions): Promise<PostgresSessionStore> {
    const store = new PostgresSessionStore(options);
    await store.ensureSchema();
    return store;
  }

  private ensureSchema(): Promise<void> {
    this.schema ??= (async () => {
      for (const ddl of SCHEMA) {
        await this.executor.query(ddl);
      }
    })();
    return this.schema;
  }

  /**
   * Run one atomic write. The refusal comes first and before a single statement — the
   * schema DDL included, because creating five tables on an executor that is about to
   * refuse you is still a statement you had no reason to send. The error says what is
   * missing and why, because the alternative is an aggregate in the database with no
   * event in the outbox, discovered by nobody until a host asks where its invoice email
   * went.
   */
  private async write<R>(op: string, fn: (tx: PostgresSessionExecutor) => Promise<R>): Promise<R> {
    const { executor } = this;
    if (!executor.transaction) {
      throw new Error(
        `PostgresSessionStore cannot run ${op}: the executor offers no transaction(). ` +
          "A commit split across pool connections can write half a run; see ADR-0042."
      );
    }
    await this.ensureSchema();
    // Called as a method rather than destructured, so the executor keeps its receiver:
    // executors are often object literals, and an unbound call would hand the callback a
    // broken `this`.
    return executor.transaction(fn);
  }

  /**
   * The revision counter, read under a row lock inside the caller's transaction.
   * This is the row that serialises writers: the second commit waits here and then
   * reads the first one's number, which is what `BEGIN IMMEDIATE` did on SQLite.
   */
  private async nextRevision(tx: PostgresSessionExecutor): Promise<number> {
    const res = await tx.query<Pick<Row, "value">>(
      "SELECT value FROM _session_meta WHERE key = 'revision' FOR UPDATE"
    );
    return Number(res.rows[0]?.value ?? "0") + 1;
  }

  private async bumpRevision(tx: PostgresSessionExecutor, revision: number): Promise<void> {
    await tx.query("UPDATE _session_meta SET value = $1 WHERE key = 'revision'", [String(revision)]);
  }

  // -- The commit ---------------------------------------------------------------

  /**
   * Aggregates, events, and the host's work, written as one transaction. The staging
   * discipline is the in-memory store's: nothing runs until every persist effect is
   * known addressable, so a bad effect cannot leave half a run behind.
   */
  async applyEffects(
    entity: string,
    effects: Effect[] | undefined,
    events: CloudEvent[] | undefined
  ): Promise<CommitReport> {
    const staged: { entity: string; id: string; record: Record<string, unknown> }[] = [];
    const dispatch: Effect[] = [];

    for (const effect of effects ?? []) {
      if (effect.type !== "persist") {
        if (effect.type !== "emit") dispatch.push(effect);
        continue;
      }
      const target = effect.entity ?? entity;
      const record = effect.record;
      if (!record) continue;
      const id = record.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new EffectApplicationError(
          `Cannot store a ${target}: the aggregate has no string 'id'`,
          "unaddressable"
        );
      }
      staged.push({ entity: target, id, record });
    }

    const queued = events ?? [];
    if (staged.length === 0 && queued.length === 0 && dispatch.length === 0) {
      return { persisted: 0, enqueued: 0, queuedEffects: 0, ids: [] };
    }

    const report = await this.write("applyEffects", async (tx) => {
      const revision = await this.nextRevision(tx);

      for (const row of staged) {
        await tx.query(
          `INSERT INTO _session_records (entity, id, revision, data) VALUES ($1, $2, $3, $4)
           ON CONFLICT (entity, id) DO UPDATE SET revision = excluded.revision,
                                                 data = excluded.data`,
          [row.entity, row.id, revision, JSON.stringify(row.record)]
        );
      }

      for (const [index, event] of queued.entries()) {
        await tx.query(
          `INSERT INTO _session_outbox (id, event, entity, attempts, state, revision)
           VALUES ($1, $2, $3, 0, 'pending', $4)`,
          [event.id ?? `outbox-${revision}-${index}`, JSON.stringify(event), staged[0]?.entity ?? null, revision]
        );
      }

      for (const [index, effect] of dispatch.entries()) {
        await tx.query(
          `INSERT INTO _session_effects (id, effect, attempts, state, revision)
           VALUES ($1, $2, 0, 'pending', $3)`,
          [`effect-${revision}-${index}`, JSON.stringify(effect), revision]
        );
      }

      await this.bumpRevision(tx, revision);
      return {
        persisted: staged.length,
        enqueued: queued.length,
        queuedEffects: dispatch.length,
        ids: staged.map((row) => row.id)
      } satisfies CommitReport;
    });

    return report;
  }

  // -- Aggregates ----------------------------------------------------------------

  async get(entity: string, id: string): Promise<Record<string, unknown> | null> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "data">>(
      "SELECT data FROM _session_records WHERE entity = $1 AND id = $2",
      [entity, id]
    );
    const row = res.rows[0];
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  }

  async has(entity: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "present">>(
      "SELECT 1 AS present FROM _session_records WHERE entity = $1 AND id = $2",
      [entity, id]
    );
    return res.rows.length > 0;
  }

  async list(entity: string): Promise<Record<string, unknown>[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "data">>(
      "SELECT data FROM _session_records WHERE entity = $1 ORDER BY id",
      [entity]
    );
    return res.rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
  }

  async revisionOf(entity: string, id: string): Promise<number | null> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "revision">>(
      "SELECT revision FROM _session_records WHERE entity = $1 AND id = $2",
      [entity, id]
    );
    const row = res.rows[0];
    return row ? row.revision : null;
  }

  /** Write a record directly, for a host seeding the session or a test. */
  async put(
    entity: string,
    record: Record<string, unknown>
  ): Promise<{ entity: string; id: string; record: Record<string, unknown> }> {
    const id = String(record.id ?? record._id ?? "");
    await this.write("put", async (tx) => {
      const revision = await this.nextRevision(tx);
      await tx.query(
        `INSERT INTO _session_records (entity, id, revision, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (entity, id) DO UPDATE SET revision = excluded.revision,
                                               data = excluded.data`,
        [entity, id, revision, JSON.stringify(record)]
      );
      await this.bumpRevision(tx, revision);
    });
    return { entity, id, record };
  }

  async entities(): Promise<string[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "entity">>(
      "SELECT DISTINCT entity FROM _session_records ORDER BY entity"
    );
    return res.rows.map((row) => row.entity).filter((entity): entity is string => entity !== null);
  }

  // -- Outbox ----------------------------------------------------------------------

  /**
   * Events still waiting for a host to deliver them, oldest first. `FOR UPDATE SKIP
   * LOCKED` hands two draining hosts disjoint sets while both transactions stay open;
   * under autocommit the lock is momentary and the protocol stays at-least-once with
   * an idempotent `ack`, exactly as on SQLite.
   */
  async pending(): Promise<OutboxEntry[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Row>(
      `SELECT id, event, entity, attempts, state, last_error, revision
       FROM _session_outbox WHERE state = 'pending'
       ORDER BY revision ASC
       FOR UPDATE SKIP LOCKED`
    );
    return res.rows.map(toOutboxEntry);
  }

  /**
   * A host delivered an event. Kept as history rather than deleted, so a duplicate
   * acknowledgement or a late `nack` is visible instead of silent.
   */
  async ack(id: string): Promise<OutboxEntry | null> {
    if (!(await this.outboxEntry(id))) return null;
    await this.ensureSchema();
    await this.executor.query(
      "UPDATE _session_outbox SET state = 'delivered', last_error = NULL WHERE id = $1",
      [id]
    );
    return this.outboxEntry(id);
  }

  /**
   * Delivery failed. The entry stays pending to be retried, and the attempt is counted
   * so a host can give up or alert. Nothing is lost: the event is still in the outbox.
   */
  async nack(id: string, error?: string): Promise<OutboxEntry | null> {
    if (!(await this.outboxEntry(id))) return null;
    await this.ensureSchema();
    await this.executor.query(
      "UPDATE _session_outbox SET state = 'pending', attempts = attempts + 1, last_error = $2 WHERE id = $1",
      [id, error ?? null]
    );
    return this.outboxEntry(id);
  }

  async outboxEntry(id: string): Promise<OutboxEntry | null> {
    await this.ensureSchema();
    const res = await this.executor.query<Row>(
      "SELECT id, event, entity, attempts, state, last_error, revision FROM _session_outbox WHERE id = $1",
      [id]
    );
    const row = res.rows[0];
    return row ? toOutboxEntry(row) : null;
  }

  /** Every event this session emitted, delivered or not, oldest first. */
  async events(type?: string): Promise<CloudEvent[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Row>(
      "SELECT id, event, entity, attempts, state, last_error, revision FROM _session_outbox ORDER BY revision ASC"
    );
    const events = res.rows.map(toOutboxEntry).map((entry) => entry.event);
    return type ? events.filter((event) => event.type === type) : events;
  }

  // -- Host effects -----------------------------------------------------------------

  /**
   * Queue an effect the host has to perform, outside a commit: an effect that *was*
   * attempted and failed. Its own transaction, because unlike a commit this is not
   * joining a write — the point is that the failure survives the record it belongs to.
   */
  async enqueueEffect(effect: Effect): Promise<HostEffectEntry> {
    return this.write("enqueueEffect", async (tx) => {
      const revision = await this.nextRevision(tx);
      const count = await tx.query<Pick<Row, "n">>("SELECT COUNT(*) AS n FROM _session_effects");
      const id = `failed-effect-${revision}-${count.rows[0]?.n ?? 0}`;
      await tx.query(
        `INSERT INTO _session_effects (id, effect, attempts, state, revision)
         VALUES ($1, $2, 0, 'pending', $3)`,
        [id, JSON.stringify(effect), revision]
      );
      await this.bumpRevision(tx, revision);
      return { id, effect, attempts: 0, state: "pending" as const, enqueuedAtRevision: revision };
    });
  }

  /**
   * Record everything a run owed the outside world, in one transaction — the events it
   * emitted and the effects it could not deliver. A retried run re-emits the same
   * CloudEvent id; `ON CONFLICT DO NOTHING` keeps the first queueing and its attempt
   * count instead of duplicating the delivery.
   */
  async enqueueDelivery(
    events: CloudEvent[] | undefined,
    effects: Effect[] | undefined,
    entity?: string
  ): Promise<{ events: OutboxEntry[]; effects: HostEffectEntry[] }> {
    return this.write("enqueueDelivery", async (tx) => {
      const revision = await this.nextRevision(tx);
      const queued: OutboxEntry[] = [];
      const undelivered: HostEffectEntry[] = [];

      for (const [index, event] of (events ?? []).entries()) {
        const id = event.id ?? `outbox-${revision}-${index}`;
        const inserted = await tx.query<Pick<Row, "id">>(
          `INSERT INTO _session_outbox (id, event, entity, attempts, state, revision)
           VALUES ($1, $2, $3, 0, 'pending', $4)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [id, JSON.stringify(event), entity ?? null, revision]
        );
        if (inserted.rows.length === 0) continue;
        queued.push({ id, event, entity, attempts: 0, state: "pending", enqueuedAtRevision: revision });
      }

      for (const [index, effect] of (effects ?? []).entries()) {
        // `failed-` for the same reason as `enqueueEffect`: a commit mints
        // `effect-<revision>-<index>` at the next revision, and the two must not
        // share an id space.
        const id = `failed-effect-${revision}-${index}`;
        await tx.query(
          `INSERT INTO _session_effects (id, effect, attempts, state, revision)
           VALUES ($1, $2, 0, 'pending', $3)`,
          [id, JSON.stringify(effect), revision]
        );
        undelivered.push({ id, effect, attempts: 0, state: "pending", enqueuedAtRevision: revision });
      }

      await this.bumpRevision(tx, revision);
      return { events: queued, effects: undelivered };
    });
  }

  async pendingEffects(type?: string): Promise<HostEffectEntry[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Row>(
      `SELECT id, effect, attempts, state, last_error, revision
       FROM _session_effects WHERE state = 'pending'
       ORDER BY revision ASC`
    );
    return res.rows.map(toHostEffectEntry).filter((entry) => (type ? entry.effect.type === type : true));
  }

  /** The host performed the effect. Kept as history, like a delivered event. */
  async ackEffect(id: string): Promise<HostEffectEntry | null> {
    if (!(await this.hostEffect(id))) return null;
    await this.ensureSchema();
    await this.executor.query(
      "UPDATE _session_effects SET state = 'delivered', last_error = NULL WHERE id = $1",
      [id]
    );
    return this.hostEffect(id);
  }

  /**
   * The host could not perform the effect. It stays pending to be retried, and the
   * attempt is counted so a host can alert instead of retrying forever in silence.
   */
  async nackEffect(id: string, error?: string): Promise<HostEffectEntry | null> {
    if (!(await this.hostEffect(id))) return null;
    await this.ensureSchema();
    await this.executor.query(
      "UPDATE _session_effects SET state = 'pending', attempts = attempts + 1, last_error = $2 WHERE id = $1",
      [id, error ?? null]
    );
    return this.hostEffect(id);
  }

  async hostEffect(id: string): Promise<HostEffectEntry | null> {
    await this.ensureSchema();
    const res = await this.executor.query<Row>(
      "SELECT id, effect, attempts, state, last_error, revision FROM _session_effects WHERE id = $1",
      [id]
    );
    const row = res.rows[0];
    return row ? toHostEffectEntry(row) : null;
  }

  // -- Claims ------------------------------------------------------------------------

  /**
   * The first claim wins, and it is written immediately: a sidecar that restarts must
   * still know which policy already ran for an event, or at-least-once delivery
   * becomes exactly-once-nobody-knows. One statement, race-free by primary key.
   */
  async claim(idempotencyKey: string): Promise<boolean> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "key">>(
      "INSERT INTO _session_claims (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key",
      [idempotencyKey]
    );
    return res.rows.length > 0;
  }

  async claims(): Promise<string[]> {
    await this.ensureSchema();
    const res = await this.executor.query<Pick<Row, "key">>("SELECT key FROM _session_claims ORDER BY key");
    return res.rows.map((row) => row.key);
  }

  async clear(): Promise<void> {
    await this.write("clear", async (tx) => {
      await tx.query("DELETE FROM _session_records");
      await tx.query("DELETE FROM _session_outbox");
      await tx.query("DELETE FROM _session_effects");
      await tx.query("DELETE FROM _session_claims");
      await tx.query("UPDATE _session_meta SET value = $1 WHERE key = 'revision'", ["0"]);
    });
  }
}

function toOutboxEntry(row: Row): OutboxEntry {
  return {
    id: row.id,
    event: JSON.parse(row.event) as CloudEvent,
    entity: row.entity ?? undefined,
    attempts: row.attempts,
    state: row.state as OutboxEntry["state"],
    lastError: row.last_error ?? undefined,
    enqueuedAtRevision: row.revision
  };
}

function toHostEffectEntry(row: Row): HostEffectEntry {
  return {
    id: row.id,
    effect: JSON.parse(row.effect) as Effect,
    attempts: row.attempts,
    state: row.state as HostEffectEntry["state"],
    lastError: row.last_error ?? undefined,
    enqueuedAtRevision: row.revision
  };
}
