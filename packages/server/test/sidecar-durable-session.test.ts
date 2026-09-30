import { describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import {
  createJsonRpcDispatcher,
  SessionLockedError,
  SqliteSessionStore
} from "../src/index.js";

/**
 * The in-memory session is honest about being a cache: a process that exits takes
 * unacknowledged events and unperformed effects with it. This store is the same
 * protocol over a file, so the promise a run makes survives the process that made it.
 *
 * The tests below are the feature: they close the store and open a new one, which is
 * what a restart is.
 */
const invoicing = loadEngine(
  compile(readFileSync(resolve(__dirname, "../../../examples/invoicing.kerangka.json"), "utf8"))
);

const billing = { id: "u-1", roles: ["billing"] };
const draft = {
  id: "inv-durable-1",
  number: "INV-DURABLE-1",
  customer: "cust-1",
  issuedOn: "2026-09-01",
  dueDate: "2026-10-01",
  status: "draft",
  lines: [{ description: "Consulting", qty: 1, unitPrice: 100 }],
};

function workspace(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kerangka-session-"));
  return { path: join(dir, "session.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A dispatcher over a store at `path`, as a process would build it. */
function sidecar(path: string) {
  const store = new SqliteSessionStore({ path });
  let id = 0;
  const dispatch = createJsonRpcDispatcher(invoicing, store);
  const call = (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    const response = JSON.parse(line as string) as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    expect(response.error, `${method}: ${JSON.stringify(response.error)}`).toBeUndefined();
    return response.result as never;
  };
  return { store, call, close: () => store.close() };
}

const send = (call: (method: string, params?: Record<string, unknown>) => never) =>
  call("run", { action: "Invoice.send", record: draft, actor: billing }) as unknown as {
    commit: { persisted: number; enqueued: number; queuedEffects: number };
  };

describe("a durable sidecar session", () => {
  it("keeps the aggregate, the event, and the host's work across a restart", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      const commit = send(first.call);
      expect(commit.commit).toMatchObject({ persisted: 1, enqueued: 1, queuedEffects: 1 });
      first.close();

      // A different store object, as a restarted process would build.
      const second = sidecar(path);
      const record = (second.call("get", { entity: "Invoice", id: "inv-durable-1" }) as unknown as {
        record: { status: string };
      }).record;
      expect(record.status).toBe("sent");

      const outbox = (second.call("outbox", {}) as unknown as { entries: Array<{ event: { type: string } }> })
        .entries;
      expect(outbox.map((entry) => entry.event.type)).toEqual(["InvoiceSent"]);

      const effects = (
        second.call("pendingEffects", {}) as unknown as {
          entries: Array<{ effect: { extension?: string; input?: Record<string, unknown> } }>;
        }
      ).entries;
      expect(effects[0]!.effect).toMatchObject({
        extension: "sendInvoiceEmail",
        input: { invoice: "inv-durable-1" },
      });
      second.close();
    } finally {
      cleanup();
    }
  });

  it("remembers a delivery that was acknowledged before the restart", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const entry = (first.call("outbox", {}) as unknown as { entries: Array<{ id: string }> }).entries[0]!;
      first.call("ack", { id: entry.id });
      first.close();

      const second = sidecar(path);
      expect((second.call("outbox", {}) as unknown as { entries: unknown[] }).entries).toHaveLength(0);
      // History survives, so a host can still see what it already delivered.
      expect((second.call("events", {}) as unknown as { events: unknown[] }).events).toHaveLength(1);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("remembers a failed delivery, so the retry outlives the process", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const entry = (first.call("outbox", {}) as unknown as { entries: Array<{ id: string }> }).entries[0]!;
      (first.call("nack", { id: entry.id, error: "broker unreachable" }) as unknown as {
        entry: { attempts: number; lastError?: string };
      }).entry.attempts;
      first.close();

      const second = sidecar(path);
      const retried = (second.call("outbox", {}) as unknown as {
        entries: Array<{ attempts: number; lastError?: string; state: string }>;
      }).entries[0]!;
      expect(retried.state).toBe("pending");
      expect(retried.attempts).toBe(1);
      expect(retried.lastError).toBe("broker unreachable");
      second.close();
    } finally {
      cleanup();
    }
  });

  it("writes neither half when one aggregate cannot be stored", () => {
    const { path, cleanup } = workspace();
    try {
      const store = new SqliteSessionStore({ path });
      expect(() =>
        store.applyEffects(
          "Invoice",
          [
            { type: "call", extension: "sendInvoiceEmail", input: {} },
            { type: "persist", entity: "Invoice", record: { number: "no id" } },
          ] as never,
          [
            {
              specversion: "1.0",
              id: "evt-unstorable",
              source: "kerangka/test",
              type: "InvoiceSent",
              time: "2026-09-30T00:00:00.000Z",
              data: {},
            } as never,
          ]
        )
      ).toThrow(/no string 'id'/);

      // The transaction rolled back: no event, no effect, no revision spent.
      expect(store.pending()).toHaveLength(0);
      expect(store.pendingEffects()).toHaveLength(0);
      expect(store.revisionOf("Invoice", "anything")).toBeNull();
      store.close();
    } finally {
      cleanup();
    }
  });

  it("keeps claims across a restart, so a replayed event does not run twice", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      expect(first.store.claim("evt-1:billing.onOrderPlaced")).toBe(true);
      first.close();

      const second = sidecar(path);
      expect(second.store.claim("evt-1:billing.onOrderPlaced")).toBe(false);
      expect(second.store.claims()).toEqual(["evt-1:billing.onOrderPlaced"]);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("keeps a lost update detectable, because the revision is persisted", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      const revision = first.store.revisionOf("Invoice", "inv-durable-1");
      first.close();

      const second = sidecar(path);
      expect(second.store.revisionOf("Invoice", "inv-durable-1")).toBe(revision);
      // A second run advances it, so a host that cached the old one can tell.
      send(second.call);
      expect(second.store.revisionOf("Invoice", "inv-durable-1")).toBeGreaterThan(revision!);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("clears the session without leaving the file unusable", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      first.call("clear", {});
      first.close();

      const second = sidecar(path);
      expect((second.call("list", { entity: "Invoice" }) as unknown as { records: unknown[] }).records)
        .toHaveLength(0);
      expect(second.store.pending()).toHaveLength(0);
      // And the store still works afterwards.
      send(second.call);
      expect(second.store.get("Invoice", "inv-durable-1")?.status).toBe("sent");
      second.close();
    } finally {
      cleanup();
    }
  });

  it("speaks the same protocol as the in-memory store", () => {
    const { path, cleanup } = workspace();
    try {
      const durable = sidecar(path);
      const memory = sidecar(":memory:");
      for (const target of [durable, memory]) {
        send(target.call);
      }

      const shape = (target: ReturnType<typeof sidecar>) => ({
        outbox: (target.call("outbox", {}) as unknown as { entries: unknown[] }),
        record: (target.call("get", { entity: "Invoice", id: "inv-durable-1" }) as unknown as {
          record: unknown;
        }),
        effects: (target.call("pendingEffects", {}) as unknown as { entries: unknown[] }),
        entities: target.store.entities(),
      });

      // The same call sequence produces the same answers, which is what "the protocol
      // does not change" has to mean.
      expect(Object.keys(shape(durable)).sort()).toEqual(Object.keys(shape(memory)).sort());
      expect(durable.store.get("Invoice", "inv-durable-1")).toEqual(
        memory.store.get("Invoice", "inv-durable-1")
      );
      expect(durable.store.pending().map((entry) => entry.event.type)).toEqual(
        memory.store.pending().map((entry) => entry.event.type)
      );
      durable.close();
      memory.close();
    } finally {
      cleanup();
    }
  });
});

/**
 * One sidecar per session file. A shared file would not fail loudly on the first
 * write: two writers would each read the same revision, both write the same effect
 * ids, and one run's writes would disappear without an error. So the file is claimed,
 * and a writer that has lost its claim is refused rather than trusted.
 */
describe("a session file belongs to one sidecar", () => {
  it("refuses a second sidecar while the first still holds the file", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      expect(() => sidecar(path)).toThrow(SessionLockedError);
      first.close();
    } finally {
      cleanup();
    }
  });

  it("names the process that holds the file, so the operator can find it", () => {
    const { path, cleanup } = workspace();
    try {
      const first = new SqliteSessionStore({ path, owner: "sidecar-a" });
      let error: unknown;
      try {
        new SqliteSessionStore({ path, owner: "sidecar-b" });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(SessionLockedError);
      expect((error as SessionLockedError).code).toBe("SESSION_LOCKED");
      expect((error as SessionLockedError).holder?.owner).toBe("sidecar-a");
      expect((error as SessionLockedError).message).toContain("sidecar-a");
      expect((error as SessionLockedError).message).toContain(String(process.pid));
      first.close();
    } finally {
      cleanup();
    }
  });

  it("takes the file over when the sidecar that held it is gone", () => {
    const { path, cleanup } = workspace();
    try {
      // A pid that has already exited: the claim is a crash, not a second writer.
      const dead = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" }).pid;
      const crashed = new SqliteSessionStore({ path, exclusive: false });
      crashed.db
        .prepare(
          "INSERT INTO _session_lock (id, owner, pid, claim_id, acquired_at) VALUES (1, ?, ?, ?, ?)"
        )
        .run("crashed sidecar", dead!, "claim-of-a-dead-process", "2026-09-01T00:00:00.000Z");
      crashed.close();

      const recovered = new SqliteSessionStore({ path, owner: "next sidecar" });
      expect(recovered.lockHolder()?.owner).toBe("next sidecar");
      recovered.close();
    } finally {
      cleanup();
    }
  });

  it("refuses a displaced sidecar to write, instead of losing an update", () => {
    const { path, cleanup } = workspace();
    try {
      const original = sidecar(path);
      const replacement = new SqliteSessionStore({ path, owner: "replacement", force: true });

      expect(() => original.store.put("Invoice", draft)).toThrow(SessionLockedError);
      expect(() => original.store.claim("evt-1:billing.onOrderPlaced")).toThrow(
        SessionLockedError
      );
      expect(() => original.store.clear()).toThrow(SessionLockedError);

      // The replacement, and only the replacement, is writing now.
      replacement.put("Invoice", draft);
      replacement.close();
      const reader = new SqliteSessionStore({ path });
      expect(reader.list("Invoice").map((record) => record.id)).toEqual(["inv-durable-1"]);
      reader.close();
      original.close();
    } finally {
      cleanup();
    }
  });

  it("does not let a displaced sidecar release the claim that replaced it", () => {
    const { path, cleanup } = workspace();
    try {
      const original = sidecar(path);
      const replacement = new SqliteSessionStore({ path, owner: "replacement", force: true });
      original.close();
      expect(replacement.lockHolder()?.owner).toBe("replacement");
      replacement.close();
    } finally {
      cleanup();
    }
  });

  it("hands the file on when a sidecar closes it", () => {
    const { path, cleanup } = workspace();
    try {
      const first = sidecar(path);
      send(first.call);
      first.close();

      const second = sidecar(path);
      expect(second.store.get("Invoice", "inv-durable-1")).not.toBeNull();
      second.close();
    } finally {
      cleanup();
    }
  });

  it("leaves a shared file to a caller that opts out of the claim", () => {
    const { path, cleanup } = workspace();
    try {
      const first = new SqliteSessionStore({ path, exclusive: false });
      const second = new SqliteSessionStore({ path, exclusive: false });
      expect(first.lockHolder()).toBeNull();
      expect(second.lockHolder()).toBeNull();
      first.put("Invoice", draft);
      expect(second.get("Invoice", "inv-durable-1")).not.toBeNull();
      first.close();
      second.close();
    } finally {
      cleanup();
    }
  });
});

/**
 * The claim has to be enforced across a process boundary, not merely between two
 * objects in one process. These tests run a real second process against the same file
 * — one that exits cleanly and one that is killed — because a claim that only works
 * in-process would be a lock on a JavaScript object rather than on the file.
 *
 * They need the built package, since the child runs the real store. Without a build
 * they are skipped rather than passing quietly: `npm test` resolves workspace imports
 * through `dist`, and a false green here would be worse than a visible skip.
 */
const serverDist = resolve(__dirname, "../dist/index.js");
const built = existsSync(serverDist);

const holder = (path: string) => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      // The handler is installed before readiness is announced. Announcing first
      // races it: a SIGTERM that lands before Node owns the signal takes the default
      // action and kills the process, which is indistinguishable from a crash.
      `const { SqliteSessionStore } = require(${JSON.stringify(serverDist)});
       const store = new SqliteSessionStore({ path: ${JSON.stringify(path)}, owner: "holder process" });
       process.on("SIGTERM", () => { store.close(); process.exit(0); });
       setInterval(() => {}, 1 << 30);
       process.stdout.write("claimed\\n");`
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const exited = new Promise<void>((resolveExit) => {
    child.once("exit", () => resolveExit());
  });
  const claimed = new Promise<number>((resolveClaim) => {
    child.stdout!.once("data", () => resolveClaim(child.pid!));
  });
  return { child, claimed, exited };
};

const stopped = (child: ChildProcess) =>
  new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
    child.once("exit", () => resolveExit());
  });

describe.skipIf(!built)("a session file is claimed across processes", () => {
  it("refuses a sidecar in another process, naming that process", async () => {
    const { path, cleanup } = workspace();
    const other = holder(path);
    try {
      const pid = await other.claimed;
      expect(pid).not.toBe(process.pid);

      let error: unknown;
      try {
        new SqliteSessionStore({ path, owner: "this process" });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(SessionLockedError);
      expect((error as SessionLockedError).holder?.owner).toBe("holder process");
      expect((error as SessionLockedError).holder?.pid).toBe(pid);
      other.child.kill("SIGKILL");
      await other.exited;
    } finally {
      cleanup();
    }
  });

  it("takes the file over when the other sidecar is killed", async () => {
    const { path, cleanup } = workspace();
    const other = holder(path);
    try {
      await other.claimed;
      other.child.kill("SIGKILL");
      await other.exited;

      const recovered = new SqliteSessionStore({ path, owner: "this process" });
      expect(recovered.lockHolder()?.owner).toBe("this process");
      recovered.put("Invoice", draft);
      recovered.close();
    } finally {
      cleanup();
    }
  });

  it("finds the claim already released when the other sidecar exits cleanly", async () => {
    const { path, cleanup } = workspace();
    const other = holder(path);
    try {
      await other.claimed;
      other.child.kill("SIGTERM");
      await stopped(other.child);
      expect(other.child.signalCode).toBeNull();
      expect(other.child.exitCode).toBe(0);

      const next = new SqliteSessionStore({ path, owner: "this process" });
      expect(next.lockHolder()?.owner).toBe("this process");
      next.close();
    } finally {
      cleanup();
    }
  });
});
