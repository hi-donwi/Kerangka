import { createHash } from "node:crypto";
import type { SourceText } from "./contracts.js";

/**
 * The content revision of a source snapshot. `openProject` and the draft change service
 * must agree on this token, so the algorithm lives here once.
 */
export function sourceRevision(sources: Record<string, SourceText>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(sources).sort()) {
    const text = sources[path]!.text;
    hash.update(`${path.length}:${path}:${Buffer.byteLength(text)}:`).update(text);
  }
  return `sha256:${hash.digest("hex")}`;
}
