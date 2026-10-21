import { describe, expect, it } from "vitest";
import { pageMoveTarget } from "./page-layout";
import type { UIDLDocument } from "uidl-runtime";

const document: UIDLDocument = { version: "1.0", id: "page", name: "Page", root: { id: "root", type: "Container", children: [
  { id: "a", type: "Text" }, { id: "b", type: "Text" },
  { id: "group", type: "Column", children: [{ id: "nested", type: "Text" }] },
], slots: { footer: [{ id: "footer", type: "Text" }] } } };

describe("page pointer move intents", () => {
  it("uses final indexes after removing the dragged sibling", () => {
    expect(pageMoveTarget(document, "a", "b", "after")).toEqual({ parent: "root", index: 1 });
    expect(pageMoveTarget(document, "b", "a", "before")).toEqual({ parent: "root", index: 0 });
  });
  it("refuses no-op drops and keeps root immovable", () => {
    expect(pageMoveTarget(document, "a", "b", "before")).toBeNull();
    expect(pageMoveTarget(document, "root", "group", "inside")).toBeNull();
  });
  it("permits a compatible nested container but not a leaf or descendant", () => {
    expect(pageMoveTarget(document, "b", "group", "inside")).toEqual({ parent: "group", index: 1 });
    expect(pageMoveTarget(document, "b", "a", "inside")).toBeNull();
    expect(pageMoveTarget(document, "group", "nested", "after")).toBeNull();
  });
  it("preserves the actual destination slot", () => {
    expect(pageMoveTarget(document, "a", "footer", "before")).toEqual({ parent: "root", slot: "footer", index: 0 });
  });
});
