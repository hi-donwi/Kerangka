/**
 * Kerangka stdio JSON-RPC 2.0 transport
 *
 * L1 of PLAN.md §11: the engine over HTTP/JSON and stdio JSON-RPC, callable from any
 * language. This module only maps the Runtime API (§10) onto JSON-RPC; it never
 * re-implements engine behaviour.
 *
 * One request per line in, one response per line out. A domain refusal
 * (`ok: false`, `GUARD_FAILED`, `DECISION_NO_MATCH`) is a successful response;
 * a malformed request or an unknown method is a protocol error.
 */

import { Engine } from "@kerangka/engine-ts";
import { SessionStore } from "./session-store.js";

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const ENGINE_ERROR = -32000;

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

export type JsonRpcDispatcher = (line: string) => string | null;

interface RpcFailure {
  code: number;
  message: string;
  data?: unknown;
}

function failure(code: number, message: string, data?: unknown): RpcFailure {
  return { code, message, ...(data === undefined ? {} : { data }) };
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw failure(INVALID_PARAMS, `Missing required parameter '${key}'`);
  }
  return value;
}

function optionalObject(params: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw failure(INVALID_PARAMS, `Parameter '${key}' must be an object`);
  }
  return value as Record<string, unknown>;
}

/** `app.describe()` from PLAN.md §10 — the metadata adapters and tooling read. */
export function describeApp(engine: Engine): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ir = (engine.ir ?? {}) as any;
  const entities: Record<string, any> = ir.entities ?? {};

  const actions: string[] = [];
  for (const [entityName, entity] of Object.entries(entities)) {
    for (const opName of Object.keys(entity.actions ?? {})) {
      actions.push(`${entityName}.${opName}`);
    }
    for (const opName of Object.keys(entity.workflow?.transitions ?? {})) {
      actions.push(`${entityName}.${opName}`);
    }
  }

  return {
    app: ir.app,
    kerangka: ir.kerangka ?? ir.$schema,
    roles: ir.roles ?? [],
    contexts: (ir.contexts ?? []).map((c: any) => (typeof c === "string" ? c : c.name)),
    entities: Object.keys(entities).sort(),
    actions: actions.sort(),
    decisions: Object.keys(ir.decisions ?? {}).sort(),
    queries: Object.keys(ir.queries ?? {}).sort(),
    events: Object.keys(ir.events ?? {}).sort(),
  };
}

/**
 * A client may name an aggregate by `id` alone. The session store fills the record in,
 * so a client does not ship the whole aggregate back and forth, and a run always operates
 * on what was last stored. Anything more than an `id` is taken as written.
 */
function hydrate(
  store: SessionStore,
  action: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const id = record.id;
  if (typeof id !== "string" || id.length === 0 || Object.keys(record).length !== 1) {
    return record;
  }
  // An action may be `Entity.operation` or the bare operation on one entity.
  const [maybeEntity, maybeOperation] = action.split(".");
  if (maybeOperation && maybeEntity) {
    const stored = store.get(maybeEntity, id);
    if (stored) return stored;
  }
  for (const entity of store.entities()) {
    const stored = store.get(entity, id);
    if (stored) return stored;
  }
  return record;
}

function invoke(engine: Engine, store: SessionStore, method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "load":
    case "describe":
      return describeApp(engine);

    case "validate": {
      const entity = requireString(params, "entity");
      const record = optionalObject(params, "record") ?? {};
      return engine.validate(entity, record);
    }

    case "compute": {
      const entity = requireString(params, "entity");
      const record = optionalObject(params, "record") ?? {};
      return { record: engine.compute(entity, record) };
    }

    case "can": {
      const operation = requireString(params, "operation");
      const record = optionalObject(params, "record") ?? {};
      const input = optionalObject(params, "input") ?? {};
      const actor = optionalObject(params, "actor");
      const options = optionalObject(params, "options");
      return engine.can(operation, record, input, actor, options);
    }

    case "available": {
      const entity = requireString(params, "entity");
      const record = optionalObject(params, "record") ?? {};
      const actor = optionalObject(params, "actor");
      const now = params.now;
      return { operations: engine.available(entity, record, actor, now as string | undefined) };
    }

    case "plan": {
      const action = requireString(params, "action");
      const record = optionalObject(params, "record") ?? {};
      const input = optionalObject(params, "input") ?? {};
      const actor = optionalObject(params, "actor");
      const options = optionalObject(params, "options");
      return engine.plan(action, record, input, actor, options);
    }

    case "run": {
      const action = requireString(params, "action");
      const raw = optionalObject(params, "record") ?? {};
      const input = optionalObject(params, "input") ?? {};
      const actor = optionalObject(params, "actor");
      const options = optionalObject(params, "options");
      const record = hydrate(store, action, raw);
      const result = engine.run(action, record, input, actor, options);
      if (result.ok) {
        store.applyEffects(action.split(".")[0] ?? "", result.effects, result.events);
      }
      return result;
    }

    case "get": {
      const entity = requireString(params, "entity");
      const id = requireString(params, "id");
      const record = store.get(entity, id);
      return record ? { record } : { record: null };
    }

    case "list": {
      const entity = requireString(params, "entity");
      return { records: store.list(entity) };
    }

    case "events": {
      const type = typeof params.type === "string" ? params.type : undefined;
      return { events: store.events(type) };
    }

    case "put": {
      const entity = requireString(params, "entity");
      const record = optionalObject(params, "record") ?? {};
      const computed = engine.compute(entity, record);
      return { record: store.put(entity, computed).record };
    }

    case "decide": {
      const table = requireString(params, "table");
      const inputs = optionalObject(params, "inputs") ?? {};
      return engine.decide(table, inputs);
    }

    case "schedules": {
      const entity = requireString(params, "entity");
      const record = optionalObject(params, "record") ?? {};
      const now = params.now;
      return { schedules: engine.schedules(entity, record, now as string | undefined) };
    }

    case "readFilter": {
      const entity = requireString(params, "entity");
      const actor = optionalObject(params, "actor");
      return { filter: engine.readFilter(entity, actor as never) };
    }

    case "queryPlan": {
      const query = requireString(params, "query");
      const queryParams = optionalObject(params, "params") ?? {};
      const actor = optionalObject(params, "actor");
      return engine.queryPlan(query, queryParams, actor as never);
    }

    case "react": {
      const event = params.event;
      if (typeof event !== "object" || event === null || Array.isArray(event)) {
        throw failure(INVALID_PARAMS, "Missing required parameter 'event'");
      }
      return engine.react(event as never);
    }

    case "clear": {
      store.clear();
      return { cleared: true };
    }

    default:
      throw failure(METHOD_NOT_FOUND, `Unknown method '${method}'`);
  }
}

/**
 * Build a dispatcher: one request line in, one response line out, `null` for a
 * notification or a blank line.
 */
export function createJsonRpcDispatcher(
  engine: Engine,
  store: SessionStore = new SessionStore(),
): JsonRpcDispatcher {
  return (line: string): string | null => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      return JSON.stringify({ jsonrpc: "2.0", id: null, error: failure(PARSE_ERROR, "Parse error") });
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: failure(INVALID_REQUEST, "Invalid Request"),
      });
    }

    const isNotification = parsed.id === undefined;
    const id = isNotification ? null : parsed.id;

    const invalid = (error: RpcFailure): string =>
      JSON.stringify({ jsonrpc: "2.0", id, error });

    if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
      return invalid(failure(INVALID_REQUEST, "Invalid Request"));
    }
    if (isNotification) {
      // Fire and forget: no response, not even an error.
      return null;
    }

    const params =
      parsed.params === undefined || parsed.params === null
        ? {}
        : (typeof parsed.params === "object" && !Array.isArray(parsed.params)
            ? (parsed.params as Record<string, unknown>)
            : null);
    if (params === null) {
      return invalid(failure(INVALID_PARAMS, "Params must be an object"));
    }

    try {
      const result = invoke(engine, store, parsed.method, params);
      return JSON.stringify({ jsonrpc: "2.0", id, result });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && "message" in err) {
        const rpcError = err as { code?: number; message?: string; data?: unknown };
        // An engine failure that already carries a stable code keeps it.
        const code = typeof rpcError.code === "number" ? rpcError.code : ENGINE_ERROR;
        return invalid(
          code >= ENGINE_ERROR && code !== METHOD_NOT_FOUND
            ? { code: ENGINE_ERROR, message: String(rpcError.message), data: { code } }
            : { code, message: String(rpcError.message), ...(rpcError.data === undefined ? {} : { data: rpcError.data }) },
        );
      }
      return invalid(failure(ENGINE_ERROR, err instanceof Error ? err.message : String(err)));
    }
  };
}

export interface StdioOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Startup banner and diagnostics belong on stderr: stdout is the protocol. */
  log?: (message: string) => void;
}

/** Serve JSON-RPC over stdio until the input stream ends. */
export function serveStdio(engine: Engine, options: StdioOptions = {}): Promise<void> {
  const dispatch = createJsonRpcDispatcher(engine);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));

  return new Promise<void>((resolve, reject) => {
    let buffer = "";
    let pending = "";

    const flush = (chunk: string): void => {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const response = dispatch(line);
        if (response !== null) output.write(`${response}\n`);
        newline = pending.indexOf("\n");
      }
    };

    input.setEncoding?.("utf8");
    input.on("data", (chunk: string | Buffer) => flush(chunk.toString()));
    input.on("end", () => {
      flush("\n");
      const tail = dispatch(buffer);
      if (tail !== null) output.write(`${tail}\n`);
      log("kerangka serve: stdio JSON-RPC closed");
      resolve();
    });
    input.on("error", (err: Error) => {
      log(`kerangka serve: stdio error ${err.message}`);
      reject(err);
    });
  });
}
