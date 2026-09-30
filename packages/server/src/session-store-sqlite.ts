/**
 * Kerangka durable session store (SQLite)
 *
 * The in-memory `SessionStore` is honest about being a cache: everything a session
 * knows is gone when the process exits, including the events nobody has delivered and
 * the effects nobody has performed. That is fine for a test and wrong for a process
 * that gets restarted — a sidecar that dies mid-run would forget the work it promised
 * to deliver, and the host would never learn it existed.
 *
 * This is the same protocol over a file. The one thing it buys beyond surviving a
 * restart is that a commit is a transaction: aggregates, events, and queued effects are
 * written inside `BEGIN IMMEDIATE`…`COMMIT`, so a crash between them leaves neither
 * half. The in-memory store stages in a Map and cannot be interrupted, so it was never
 * at risk; a database write can be, and now is not.
 *
 * `node:sqlite` is still experimental and prints a warning on first use. In stdio mode
 * the protocol owns stdout and diagnostics go to stderr, so the warning is harmless.
 */

import { DatabaseSync } from "node:sqlite";
import type { CloudEvent, Effect } from "@kerangka/engine-ts";
import {
  CommitReport,
  EffectApplicationError,
  HostEffectEntry,
  OutboxEntry,
  SessionStoreLike,
} from "./session-store.js";

export interface SqliteSessionStoreOptions {
  /** Path to the session file, or `:memory:` for a throwaway one. */
  path?: string;
  /** An already-open database, for a caller that wants to own the handle. */
  database?: DatabaseSync;
}

interface Row {
  id: string;
  entity: string;
  revision: number;
  data: string;
}

export class SqliteSessionStore implements SessionStoreLike {
  readonly db: DatabaseSync;
  private readonly ownsHandle: boolean;

  constructor(options: SqliteSessionStoreOptions = {}) {
    this.db = options.database ?? new DatabaseSync(options.path ?? ":memory:");
    this.ownsHandle = !options.database;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _session_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _session_records (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (entity, id)
      );
      CREATE TABLE IF NOT EXISTS _session_outbox (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        entity TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        last_error TEXT,
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _session_effects (
        id TEXT PRIMARY KEY,
        effect TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        last_error TEXT,
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _session_claims (
        key TEXT PRIMARY KEY
      );
      INSERT OR IGNORE INTO _session_meta (key, value) VALUES ('revision', '0');
    `);
  }

  close(): void {
    if (this.ownsHandle) this.db.close();
  }

  // -- The commit -------------------------------------------------------------

  /**
   * Aggregates, events, and the host's work, written as one transaction. A persist
   * effect that cannot be stored aborts it, exactly as it aborts the in-memory commit,
   * so a session never holds half a run.
   */
  applyEffects(
    entity: string,
    effects: Effect[] | undefined,
    events: CloudEvent[] | undefined
  ): CommitReport {
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

    const revision = this.revision() + 1;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of staged) {
        this.db
          .prepare(
            `INSERT INTO _session_records (entity, id, revision, data) VALUES (?, ?, ?, ?)
             ON CONFLICT (entity, id) DO UPDATE SET revision = excluded.revision,
                                                   data = excluded.data`
          )
          .run(row.entity, row.id, revision, JSON.stringify(row.record));
      }

      const enqueue = this.db.prepare(
        `INSERT INTO _session_outbox (id, event, entity, attempts, state, revision)
         VALUES (?, ?, ?, 0, 'pending', ?)`
      );
      (queued as CloudEvent[]).forEach((event, index) => {
        enqueue.run(
          event.id ?? `outbox-${revision}-${index}`,
          JSON.stringify(event),
          staged[0]?.entity ?? null,
          revision
        );
      });

      const enqueueEffect = this.db.prepare(
        `INSERT INTO _session_effects (id, effect, attempts, state, revision)
         VALUES (?, ?, 0, 'pending', ?)`
      );
      dispatch.forEach((effect, index) => {
        enqueueEffect.run(`effect-${revision}-${index}`, JSON.stringify(effect), revision);
      });

      this.db.prepare("UPDATE _session_meta SET value = ? WHERE key = 'revision'").run(String(revision));
      this.db.exec("COMMIT");
    } catch (err) {
      // Nothing is written: SQLite rolls the whole transaction back, so a failed commit
      // cannot leave an aggregate without its event or a queued effect without its write.
      this.db.exec("ROLLBACK");
      throw err;
    }

    return {
      persisted: staged.length,
      enqueued: queued.length,
      queuedEffects: dispatch.length,
      ids: staged.map((row) => row.id),
    };
  }

  // -- Aggregates -------------------------------------------------------------

  get(entity: string, id: string): Record<string, unknown> | null {
    const row = this.db
      .prepare("SELECT data FROM _session_records WHERE entity = ? AND id = ?")
      .get(entity, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  }

  has(entity: string, id: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM _session_records WHERE entity = ? AND id = ?")
      .get(entity, id);
    return row !== undefined;
  }

  list(entity: string): Record<string, unknown>[] {
    const rows = this.db
      .prepare("SELECT data FROM _session_records WHERE entity = ? ORDER BY id")
      .all(entity) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
  }

  revisionOf(entity: string, id: string): number | null {
    const row = this.db
      .prepare("SELECT revision FROM _session_records WHERE entity = ? AND id = ?")
      .get(entity, id) as { revision: number } | undefined;
    return row ? row.revision : null;
  }

  put(
    entity: string,
    record: Record<string, unknown>
  ): { entity: string; id: string; record: Record<string, unknown> } {
    const id = String(record.id ?? record._id ?? "");
    const revision = this.revision() + 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO _session_records (entity, id, revision, data) VALUES (?, ?, ?, ?)
           ON CONFLICT (entity, id) DO UPDATE SET revision = excluded.revision,
                                                 data = excluded.data`
        )
        .run(entity, id, revision, JSON.stringify(record));
      this.db.prepare("UPDATE _session_meta SET value = ? WHERE key = 'revision'").run(String(revision));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return { entity, id, record };
  }

  entities(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT entity FROM _session_records ORDER BY entity")
      .all() as Array<{ entity: string }>;
    return rows.map((row) => row.entity);
  }

  // -- Outbox -----------------------------------------------------------------

  pending(): OutboxEntry[] {
    return this.outboxEntries().filter((entry) => entry.state === "pending");
  }

  ack(id: string): OutboxEntry | null {
    const entry = this.outboxEntry(id);
    if (!entry) return null;
    this.db
      .prepare("UPDATE _session_outbox SET state = 'delivered', last_error = NULL WHERE id = ?")
      .run(id);
    return this.outboxEntry(id);
  }

  nack(id: string, error?: string): OutboxEntry | null {
    const entry = this.outboxEntry(id);
    if (!entry) return null;
    this.db
      .prepare(
        "UPDATE _session_outbox SET state = 'pending', attempts = attempts + 1, last_error = ? WHERE id = ?"
      )
      .run(error ?? null, id);
    return this.outboxEntry(id);
  }

  outboxEntry(id: string): OutboxEntry | null {
    return this.outboxEntries().find((entry) => entry.id === id) ?? null;
  }

  /** Every event this session emitted, delivered or not, oldest first. */
  events(type?: string): CloudEvent[] {
    const all = this.outboxEntries()
      .sort((a, b) => a.enqueuedAtRevision - b.enqueuedAtRevision)
      .map((entry) => entry.event);
    return type ? all.filter((event) => event.type === type) : all;
  }

  private outboxEntries(): OutboxEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, event, entity, attempts, state, last_error, revision FROM _session_outbox"
      )
      .all() as Array<{
      id: string;
      event: string;
      entity: string | null;
      attempts: number;
      state: string;
      last_error: string | null;
      revision: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      event: JSON.parse(row.event) as CloudEvent,
      entity: row.entity ?? undefined,
      attempts: row.attempts,
      state: row.state as OutboxEntry["state"],
      lastError: row.last_error ?? undefined,
      enqueuedAtRevision: row.revision,
    }));
  }

  // -- Host effects -----------------------------------------------------------

  pendingEffects(type?: string): HostEffectEntry[] {
    return this.effectEntries()
      .filter((entry) => entry.state === "pending")
      .filter((entry) => (type ? entry.effect.type === type : true));
  }

  ackEffect(id: string): HostEffectEntry | null {
    if (!this.hostEffect(id)) return null;
    this.db
      .prepare("UPDATE _session_effects SET state = 'delivered', last_error = NULL WHERE id = ?")
      .run(id);
    return this.hostEffect(id);
  }

  nackEffect(id: string, error?: string): HostEffectEntry | null {
    if (!this.hostEffect(id)) return null;
    this.db
      .prepare(
        "UPDATE _session_effects SET state = 'pending', attempts = attempts + 1, last_error = ? WHERE id = ?"
      )
      .run(error ?? null, id);
    return this.hostEffect(id);
  }

  hostEffect(id: string): HostEffectEntry | null {
    return this.effectEntries().find((entry) => entry.id === id) ?? null;
  }

  private effectEntries(): HostEffectEntry[] {
    const rows = this.db
      .prepare("SELECT id, effect, attempts, state, last_error, revision FROM _session_effects")
      .all() as Array<{
      id: string;
      effect: string;
      attempts: number;
      state: string;
      last_error: string | null;
      revision: number;
    }>;
    return rows
      .map((row) => ({
        id: row.id,
        effect: JSON.parse(row.effect) as Effect,
        attempts: row.attempts,
        state: row.state as HostEffectEntry["state"],
        lastError: row.last_error ?? undefined,
        enqueuedAtRevision: row.revision,
      }))
      .sort((a, b) => a.enqueuedAtRevision - b.enqueuedAtRevision);
  }

  // -- Claims -----------------------------------------------------------------

  /**
   * The first claim wins, and it is written immediately: a sidecar that restarts must
   * still know which policy already ran for an event, or at-least-once delivery
   * becomes exactly-once-nobody-knows.
   */
  claim(idempotencyKey: string): boolean {
    const existing = this.db
      .prepare("SELECT 1 AS present FROM _session_claims WHERE key = ?")
      .get(idempotencyKey);
    if (existing !== undefined) return false;
    this.db.prepare("INSERT INTO _session_claims (key) VALUES (?)").run(idempotencyKey);
    return true;
  }

  claims(): string[] {
    const rows = this.db.prepare("SELECT key FROM _session_claims ORDER BY key").all() as Array<{
      key: string;
    }>;
    return rows.map((row) => row.key);
  }

  clear(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM _session_records; DELETE FROM _session_outbox; DELETE FROM _session_effects; DELETE FROM _session_claims; UPDATE _session_meta SET value = '0' WHERE key = 'revision';");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private revision(): number {
    const row = this.db
      .prepare("SELECT value FROM _session_meta WHERE key = 'revision'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }
}
