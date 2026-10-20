import { describe, expect, it } from "vitest";
import { preparePreview, previewPayload, readOnlyAdapter } from "./preview-policy";
import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";

const screen = (document: unknown): ScreenInfo => ({
  id: "help",
  label: "Help",
  kind: "authored",
  route: "",
  source: "help.uidl.json",
  pointer: "/root",
  document,
});
const doc = () => ({
  version: "1.0",
  id: "help",
  name: "Help",
  root: { id: "root", type: "Container", children: [{ id: "text", type: "Text", props: { value: "Synthetic help" } }] },
});

describe("synthetic static preview admission", () => {
  it("removes authored state/inline records and handlers without modifying source", () => {
    const input = screen({
      ...doc(),
      state: { secret: "PRIVATE_RECORD_MARKER" },
      dataSources: { rows: [{ name: "PRIVATE_RECORD_MARKER" }] },
      root: { ...doc().root, events: { onMount: [{ api: { url: "https://outside.invalid" } }] } },
    });
    const before = structuredClone(input);
    const prepared = preparePreview(input);
    expect(JSON.stringify(prepared)).not.toContain("PRIVATE_RECORD_MARKER");
    expect(JSON.stringify(prepared)).not.toContain("outside.invalid");
    expect(input).toEqual(before);
  });

  it("admits the standard recipe popover without enabling its event handlers", () => {
    const input = screen({
      ...doc(),
      root: { id: "popover", type: "Popover", props: { open: false }, children: doc().root.children },
    });
    expect(preparePreview(input).root.type).toBe("Popover");
  });

  it("sends only admitted document data across the preview boundary", () => {
    const input = screen({
      ...doc(),
      state: { record: "PRIVATE_RECORD_MARKER" },
      root: { ...doc().root, events: { onMount: [{ api: { url: "https://outside.invalid" } }] } },
    });
    const before = structuredClone(input);
    const payload = previewPayload(input, "revision-1", {}, "frame-channel");
    expect(Object.keys(payload.screen).sort()).toEqual(["document", "kind"]);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_RECORD_MARKER");
    expect(JSON.stringify(payload)).not.toContain("outside.invalid");
    expect(payload.channel).toBe("frame-channel");
    expect(input).toEqual(before);
  });

  it.each([
    { id: "node", type: "Image", props: { src: "https://outside.invalid/image" } },
    { id: "node", type: "Button", props: { href: "https://outside.invalid" } },
    { id: "node", type: "Text", style: { backgroundImage: "url(https://outside.invalid)" } },
    { id: "node", type: "Container", componentId: "recursive" },
    { id: "node", type: "Text", repeat: { dataSource: [] } },
  ])("refuses an unsupported or network-bearing node %#", (root) => {
    expect(() => preparePreview(screen({ ...doc(), root }))).toThrow();
  });

  it("refuses unknown majors, component definitions, and excessive node counts", () => {
    expect(() => preparePreview(screen({ ...doc(), version: "2.0" }))).toThrow();
    expect(() => preparePreview(screen({ ...doc(), definitions: { unsafe: doc().root } }))).toThrow();
    expect(() =>
      preparePreview(
        screen({
          ...doc(),
          root: {
            id: "root",
            type: "Container",
            children: Array.from({ length: 501 }, (_, i) => ({ id: `n-${i}`, type: "Text" })),
          },
        }),
      ),
    ).toThrow();
  });

  it("allows synthetic reads but refuses all adapter writes", async () => {
    const adapter = readOnlyAdapter({ Request: [{ id: "preview-1", title: "Synthetic Request" }] });
    expect((await adapter.query({ collection: "Request" })).rows).toHaveLength(1);
    await expect(adapter.create({ collection: "Request" })).rejects.toThrow("read-only");
    await expect(adapter.update({ collection: "Request", id: "preview-1" })).rejects.toThrow("read-only");
    await expect(adapter.remove("Request", "preview-1")).rejects.toThrow("read-only");
    await expect(adapter.transition({ collection: "Request", transition: "approve" })).rejects.toThrow("read-only");
  });
});
