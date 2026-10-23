import { describe, expect, it } from "vitest";
import {
  PREVIEW_HIGHLIGHT,
  PREVIEW_SELECT,
  previewHighlightMessage,
  previewSelectionMessage,
  readPreviewHighlight,
  readPreviewSelection,
  safeNodeId,
} from "./preview-selection";

describe("the preview selection channel", () => {
  it("accepts a selection from the frame's own channel and revision", () => {
    const message = previewSelectionMessage("channel-1", "r1", "node-1");
    expect(message.type).toBe(PREVIEW_SELECT);
    expect(readPreviewSelection(message, "channel-1", "r1")).toBe("node-1");
  });

  it("refuses a message from another channel or another revision", () => {
    const message = previewSelectionMessage("channel-1", "r1", "node-1");
    expect(readPreviewSelection(message, "channel-2", "r1")).toBeNull();
    expect(readPreviewSelection(message, "channel-1", "r2")).toBeNull();
  });

  it("refuses anything that is not a selection", () => {
    expect(readPreviewSelection({ type: "studio.preview.render" }, "c", "r")).toBeNull();
    expect(readPreviewSelection("node-1", "c", "r")).toBeNull();
    expect(readPreviewSelection(null, "c", "r")).toBeNull();
  });

  it("refuses an unsafe node identifier", () => {
    for (const nodeId of ["", "__proto__", "constructor", "prototype", "a b", "x".repeat(257)]) {
      expect(safeNodeId(nodeId)).toBe(false);
      const message = { type: PREVIEW_SELECT, channel: "c", revision: "r", nodeId };
      expect(readPreviewSelection(message, "c", "r")).toBeNull();
    }
  });

  it("reads a highlight, including the one that clears it", () => {
    const highlight = previewHighlightMessage("c", "r", "node-1");
    expect(highlight.type).toBe(PREVIEW_HIGHLIGHT);
    expect(readPreviewHighlight(highlight, "c", "r")).toBe("node-1");
    expect(readPreviewHighlight(previewHighlightMessage("c", "r", null), "c", "r")).toBeNull();
  });

  it("refuses a highlight from another channel, another revision, or another kind", () => {
    expect(readPreviewHighlight(previewHighlightMessage("c", "r", "node-1"), "other", "r")).toBeUndefined();
    expect(readPreviewHighlight(previewHighlightMessage("c", "r", "node-1"), "c", "r2")).toBeUndefined();
    expect(readPreviewHighlight({ type: PREVIEW_SELECT, channel: "c", revision: "r" }, "c", "r")).toBeUndefined();
  });
});
