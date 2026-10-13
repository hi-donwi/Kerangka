/**
 * `kerangka serve` and `kerangka dev` run this server. It enforced no entity permissions on
 * REST or MCP, ignored read filters, and ran an action from a caller with no actor as
 * `{ roles: body.roles || ["admin", "billing"] }`: anonymous callers were admin, and could name
 * their own roles. It now authorizes every path the way the Hono adapter does (ADR-0040,
 * ADR-0044), and acting without an actor is a `devActor` the dev command opts into.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { KerangkaServer } from "../src/index.js";

const kir = compile({
  kerangka: "0.1",
  app: "authz",
  roles: ["admin", "billing", "viewer"],
  entities: {
    Invoice: {
      fields: { number: "string!", status: "enum(draft, sent) = draft" },
      permissions: {
        read: ["admin", "billing", "viewer"],
        create: ["admin", "billing"],
        update: { admin: true, billing: "status == 'draft'" },
        delete: [],
      },
      workflow: { transitions: { send: { from: "draft", to: "sent", roles: ["admin", "billing"] } } },
    },
    Note: {
      fields: { text: "string!", ownerId: "string!" },
      readFilter: "ownerId == actor.id",
    },
  },
} as never);

const headers = (roles?: string, id = "u-1"): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(roles !== undefined ? { "X-Actor-Roles": roles, "X-Actor-Id": id } : {}),
});

function serverAt(port: number, devActor?: { id: string; roles: string[] }) {
  const server = new KerangkaServer(kir, { port, store: new MemoryStore(), quiet: true, ...(devActor ? { devActor } : {}) });
  const base = `http://localhost:${port}`;
  const call = (method: string, path: string, roles?: string, body?: unknown, id?: string) =>
    fetch(`${base}${path}`, { method, headers: headers(roles, id), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/mcp/call`, { method: "POST", headers: headers(), body: JSON.stringify({ name, arguments: args }) });
    return (await res.json()) as { isError?: boolean; content: Array<{ text: string }> };
  };
  return { server, call, mcp };
}

describe("a deployed server (no devActor)", () => {
  const { server, call, mcp } = serverAt(3981);

  beforeAll(async () => {
    await server.start();
    for (const [id, status] of [["inv-draft", "draft"], ["inv-sent", "sent"]]) {
      expect((await call("POST", "/api/Invoice", "admin", { id, number: id, status })).status).toBe(201);
    }
    for (const [id, ownerId] of [["n-1", "u-1"], ["n-2", "u-2"]]) {
      expect((await call("POST", "/api/Note", "admin", { id, text: id, ownerId }, ownerId)).status).toBe(201);
    }
  });
  afterAll(async () => {
    await server.stop();
  });

  it("refuses create and update to roles the model does not grant", async () => {
    expect((await call("POST", "/api/Invoice", "viewer", { id: "x", number: "x" })).status).toBe(403);
    expect((await call("PUT", "/api/Invoice/inv-draft", "viewer", { number: "V" })).status).toBe(403);
  });

  it("decides a conditional update against the stored record", async () => {
    expect((await call("PUT", "/api/Invoice/inv-draft", "billing", { number: "D-2" })).status).toBe(200);
    expect((await call("PUT", "/api/Invoice/inv-sent", "billing", { number: "S-2" })).status).toBe(403);
  });

  it("lets no one delete what an empty list grants to no one", async () => {
    expect((await call("DELETE", "/api/Invoice/inv-draft", "admin")).status).toBe(403);
  });

  it("applies a read filter to a list and to a single read", async () => {
    const list = await call("GET", "/api/Note", "", undefined, "u-1");
    expect(list.status).toBe(200);
    expect(((await list.json()) as Array<{ id: string }>).map((n) => n.id)).toEqual(["n-1"]);
    expect((await call("GET", "/api/Note/n-1", "", undefined, "u-1")).status).toBe(200);
    expect((await call("GET", "/api/Note/n-2", "", undefined, "u-1")).status).toBe(403);
  });

  it("does not run a role-guarded action for a caller with no actor, or one naming its own roles", async () => {
    expect((await call("POST", "/api/Invoice/inv-draft/actions/send", undefined, {})).status).toBe(403);
    expect((await call("POST", "/api/Invoice/inv-draft/actions/send", undefined, { roles: ["admin"] })).status).toBe(403);
    expect((await call("POST", "/api/Invoice/inv-draft/actions/send", "billing", {})).status).toBe(200);
  });

  it("authorizes MCP tools with the actor their arguments name, and nothing by default", async () => {
    expect((await mcp("list_note", { actorId: "u-1", roles: [] })).content[0]!.text).not.toContain("n-2");
    expect((await mcp("get_note", { id: "n-2", actorId: "u-1", roles: [] })).isError).toBe(true);
    expect((await mcp("create_invoice", { id: "m-1", number: "m-1", roles: ["viewer"] })).isError).toBe(true);
    expect((await mcp("update_invoice", { id: "inv-sent", patch: { number: "Z" }, roles: ["billing"] })).isError).toBe(true);
    expect((await mcp("transition_invoice_send", { id: "inv-draft" })).isError).toBe(true);
  });

  it("validates what an MCP create would store", async () => {
    const res = await mcp("create_invoice", { id: "m-2", roles: ["admin"] });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("number");
  });
});

describe("the dev server (devActor set)", () => {
  const { server, call } = serverAt(3982, { id: "dev-user", roles: ["admin"] });

  beforeAll(async () => {
    await server.start();
    await call("POST", "/api/Invoice", "admin", { id: "inv-1", number: "inv-1", status: "draft" });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("acts as the dev actor for a request that carries none", async () => {
    expect((await call("POST", "/api/Invoice/inv-1/actions/send", undefined, {})).status).toBe(200);
  });

  it("still refuses what even the dev actor may not do", async () => {
    expect((await call("DELETE", "/api/Invoice/inv-1", undefined)).status).toBe(403);
  });
});
