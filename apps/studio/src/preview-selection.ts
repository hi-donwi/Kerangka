/**
 * The selection channel between the trusted console and the isolated preview frame.
 *
 * The preview frame is opaque and sandboxed, so the console cannot reach into it. A
 * person clicking a node in the preview is a real editing gesture, and the console has
 * to learn which node was clicked. That exchange happens over the same channel the
 * render already uses, with a closed vocabulary: the frame sends one message type, the
 * console sends one, and both are bound to the frame's channel and the document
 * revision they belong to.
 *
 * A selection is not a mutation. Nothing in the preview changes, nothing is written,
 * and the message carries an identifier and nothing else.
 */

export const PREVIEW_SELECT = "studio.preview.select";
export const PREVIEW_HIGHLIGHT = "studio.preview.highlight";

/** The longest node identifier the protocol accepts. */
export const MAX_NODE_ID_LENGTH = 256;

const SAFE_NODE_ID = /^[A-Za-z0-9_.:-]+$/;

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** True when an identifier is safe to use as an attribute selector and a message value. */
export function safeNodeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NODE_ID_LENGTH &&
    SAFE_NODE_ID.test(value) &&
    !RESERVED.has(value)
  );
}

export interface PreviewSelectionMessage {
  type: typeof PREVIEW_SELECT;
  channel: string;
  revision: string;
  nodeId: string;
}

/** The message the frame sends when a person clicks a node. */
export function previewSelectionMessage(
  channel: string,
  revision: string,
  nodeId: string,
): PreviewSelectionMessage {
  return { type: PREVIEW_SELECT, channel, revision, nodeId };
}

/** The message the console sends to mark the selected node in the frame. */
export function previewHighlightMessage(
  channel: string,
  revision: string,
  nodeId: string | null,
): { type: typeof PREVIEW_HIGHLIGHT; channel: string; revision: string; nodeId: string | null } {
  return { type: PREVIEW_HIGHLIGHT, channel, revision, nodeId };
}

/**
 * Read a selection message.
 *
 * The channel and the revision must both match, so a message from a stale frame, a
 * different frame, or a previous revision of the document is refused rather than
 * applied. A frame that sends anything else is ignored.
 */
export function readPreviewSelection(
  data: unknown,
  channel: string,
  revision: string,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== PREVIEW_SELECT) return null;
  if (message.channel !== channel) return null;
  if (message.revision !== revision) return null;
  if (!safeNodeId(message.nodeId)) return null;
  return message.nodeId;
}

/**
 * Read a highlight message from the console.
 *
 * The frame accepts a highlight only from the frame's own parent, on the frame's own
 * channel, for the revision it is currently showing.
 */
export function readPreviewHighlight(
  data: unknown,
  channel: string,
  revision: string,
): string | null | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const message = data as Record<string, unknown>;
  if (message.type !== PREVIEW_HIGHLIGHT) return undefined;
  if (message.channel !== channel) return undefined;
  if (message.revision !== revision) return undefined;
  if (message.nodeId === null) return null;
  if (!safeNodeId(message.nodeId)) return undefined;
  return message.nodeId;
}
