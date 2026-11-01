import { describe, expect, it } from "vitest";
import { summarizeUidlDocument } from "./context-uidl.js";

describe("UIDL context summaries", () => {
  it("shows nested component types, ids, slots, events, and the declared route", () => {
    const summary = summarizeUidlDocument({
      version: "1.0",
      route: "/requests",
      state: { record: "PRIVATE_STATE_VALUE" },
      root: {
        id: "request-root",
        type: "Container",
        props: { title: "PRIVATE_PROP_VALUE" },
        children: [
          { id: "request-title", type: "Heading", props: { value: "PRIVATE_TEXT_VALUE" } },
          {
            id: "submit-request",
            type: "Button",
            events: { onClick: [{ api: { url: "PRIVATE_API_URL" } }] },
            slots: { icon: [{ id: "send-icon", type: "Icon" }] },
          },
        ],
      },
    });

    expect(summary.route).toBe("/requests");
    expect(summary.notes).toContain("UIDL: Container [request-root]");
    expect(summary.notes).toContain("UIDL:   Heading [request-title]");
    expect(summary.notes).toContain("UIDL:   Button [submit-request]");
    expect(summary.notes).toContain("UIDL:     events: onClick");
    expect(summary.notes).toContain("UIDL:     slot icon: Icon [send-icon]");
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_");
  });

  it("bounds deep or oversized documents", () => {
    let node: Record<string, unknown> = { id: "end", type: "Text" };
    for (let index = 0; index < 100; index += 1) {
      node = { id: `node-${index}`, type: "Container", children: [node] };
    }

    const summary = summarizeUidlDocument({ root: node });
    expect(summary.notes.length).toBeLessThanOrEqual(82);
    expect(summary.notes.some((note) => note.includes("additional nested elements omitted"))).toBe(true);
  });
});
