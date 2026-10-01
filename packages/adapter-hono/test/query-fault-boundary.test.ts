import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { MemoryStore, StorePort } from "@kerangka/ports";
import { createKerangkaHonoApp, QueryEvaluationError } from "../src/index.js";

/**
 * An internal fault is not a bad query.
 *
 * The named-query handler wraps its whole body in one `catch` that answers
 * `422 QUERY_INVALID`. That is right for a predicate the evaluator cannot honour, and wrong for
 * everything else: a store that throws, a null dereference, a missing import. All of them
 * reported as a client error, with the internal message attached.
 *
 * It is not a hypothetical. Renaming an export in `query-eval.ts` without updating the import in
 * `hono-app.ts` produced two failures here, both reading `expected 422 to be 200` — pointing at
 * the HTTP contract rather than at the dangling import. `tsc` caught it; the suite did not.
 *
 * Two properties are asserted, and the second is the one that was missing: a genuine
 * `QueryEvaluationError` is still the caller's fault, and anything else is not.
 */
const docWithQuery = (where: unknown) => ({
  kerangka: "0.1",
  app: "query-faults",
  queries: { list: { from: "Task", where } },
  entities: { Task: { fields: { title: "string!", weight: "int" } } }
});

/** A store that fails the way a real one does: not by validating the query, but by failing. */
const brokenStore = (message: string): StorePort => {
  const inner = new MemoryStore();
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "find") {
        return async () => {
          throw new Error(message);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as StorePort;
};

describe("an internal fault in a named query is not reported as a bad query", () => {
  it("reports a predicate the evaluator cannot honour as the caller's fault", async () => {
    // The property that had to survive. An unknown operator is the model's problem, the
    // evaluator refuses it, and nothing widens the result set.
    const kir = compile(JSON.stringify(docWithQuery(["nonsense", ["get", "weight"], 1])));
    const app = createKerangkaHonoApp(kir, { store: new MemoryStore() });

    const res = await app.request("/api/task/queries/list");

    expect(res.status).toBe(422);
    const problem = await res.json();
    expect(problem.code).toBe("QUERY_INVALID");
    expect(problem.detail).toMatch(/nonsense/);
  });

  it("reports a store that fails as a server fault, not as a bad query", async () => {
    const kir = compile(JSON.stringify(docWithQuery([">=", ["get", "weight"], 10])));
    const app = createKerangkaHonoApp(kir, {
      store: brokenStore("connect ECONNREFUSED 10.0.0.5:5432")
    });

    const res = await app.request("/api/task/queries/list");

    expect(res.status).not.toBe(422);
    expect(res.status).toBe(500);
  });

  it("does not echo an internal message to the client", async () => {
    // The 422 carried `err.message` verbatim. For a store fault that message is a connection
    // string, a file path, or a fragment of SQL, and it was going to the caller.
    const kir = compile(JSON.stringify(docWithQuery([">=", ["get", "weight"], 10])));
    const app = createKerangkaHonoApp(kir, {
      store: brokenStore("connect ECONNREFUSED 10.0.0.5:5432")
    });

    const res = await app.request("/api/task/queries/list");
    const body = await res.text();

    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("10.0.0.5");
  });

  it("answers an internal fault in the shape every other error uses", async () => {
    // The rethrow lands in `onError`, and this adapter promises RFC 9457 on every response.
    // A bare 500 with no body would break that promise in the one case a client most needs to
    // read something.
    const kir = compile(JSON.stringify(docWithQuery([">=", ["get", "weight"], 10])));
    const app = createKerangkaHonoApp(kir, {
      store: brokenStore("connect ECONNREFUSED 10.0.0.5:5432")
    });

    const res = await app.request("/api/task/queries/list");

    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = await res.json();
    expect(problem.type).toContain("INTERNAL_ERROR");
    expect(problem.status).toBe(500);
    expect(problem.instance).toBe("/api/task/queries/list");
  });

  it("keeps the typed error distinguishable from a plain one", async () => {
    // If this ever stops holding, the handler can no longer tell the two faults apart and the
    // branch that returns 500 has nothing to key on.
    const kir = compile(JSON.stringify(docWithQuery(["nonsense", ["get", "weight"], 1])));
    const app = createKerangkaHonoApp(kir, { store: new MemoryStore() });

    // Reaching the handler at all is the assertion: the error it catches is the typed one.
    const res = await app.request("/api/task/queries/list");
    expect(res.status).toBe(422);

    expect(new QueryEvaluationError("x")).toBeInstanceOf(Error);
    expect(new Error("x")).not.toBeInstanceOf(QueryEvaluationError);
  });
});
