/**
 * The HTTP path honours role-map permissions (PLAN.md §5.1). Before this, `canOperate` read a
 * role map as "not a list" and allowed every caller: a viewer could PUT an invoice that the
 * model said only admin and billing (on drafts) may change.
 */

import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { createKerangkaHonoApp } from "../src/index.js";

const kir = compile({
  kerangka: "0.1",
  app: "perms",
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
    },
    Note: {
      fields: { text: "string!", ownerId: "string!" },
      permissions: { read: { admin: true, viewer: "ownerId == actor.id" } },
    },
  },
} as never);

async function setup() {
  const app = createKerangkaHonoApp(kir, { store: new MemoryStore() });
  const as = (roles: string, id = "u-1") => ({ "Content-Type": "application/json", "X-Actor-Roles": roles, "X-Actor-Id": id });
  for (const [id, status] of [["inv-draft", "draft"], ["inv-sent", "sent"]]) {
    const res = await app.request("/api/invoice", { method: "POST", headers: as("admin"), body: JSON.stringify({ id, number: id, status }) });
    expect(res.status).toBe(201);
  }
  await app.request("/api/note", { method: "POST", headers: as("admin"), body: JSON.stringify({ id: "n-1", text: "x", ownerId: "u-1" }) });
  return { app, as };
}

describe("role-map permissions on the HTTP path", () => {
  it("refuses an update to a role the map does not grant", async () => {
    const { app, as } = await setup();
    const res = await app.request("/api/invoice/inv-draft", { method: "PUT", headers: as("viewer"), body: JSON.stringify({ number: "X" }) });
    expect(res.status).toBe(403);
  });

  it("decides a conditional update against the stored record", async () => {
    const { app, as } = await setup();
    const draft = await app.request("/api/invoice/inv-draft", { method: "PUT", headers: as("billing"), body: JSON.stringify({ number: "D-2" }) });
    expect(draft.status).toBe(200);
    const sent = await app.request("/api/invoice/inv-sent", { method: "PUT", headers: as("billing"), body: JSON.stringify({ number: "S-2" }) });
    expect(sent.status).toBe(403);
  });

  it("refuses a delete granted to no role, even to admin", async () => {
    const { app, as } = await setup();
    const res = await app.request("/api/invoice/inv-draft", { method: "DELETE", headers: as("admin") });
    expect(res.status).toBe(403);
  });

  it("decides a conditional read of one record against it", async () => {
    const { app, as } = await setup();
    expect((await app.request("/api/note/n-1", { headers: as("viewer", "u-1") })).status).toBe(200);
    expect((await app.request("/api/note/n-1", { headers: as("viewer", "u-2") })).status).toBe(403);
  });

  it("refuses to list under a conditional read, and says to use a readFilter", async () => {
    const { app, as } = await setup();
    const res = await app.request("/api/note", { headers: as("viewer", "u-1") });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("readFilter");
    expect((await app.request("/api/note", { headers: as("admin") })).status).toBe(200);
  });
});
