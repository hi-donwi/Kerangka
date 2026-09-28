/**
 * Kerangka Compiler Diagnostics Support
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * JSON pointers, source positions, and "did you mean" suggestions for diagnostics.
 */

import { LineCounter, parseDocument } from "yaml";

export interface SourcePosition {
  line: number;
  column: number;
}

/** Builds an RFC 6901 JSON pointer from path segments. */
export function pointer(...segments: (string | number)[]): string {
  return segments.map((s) => "/" + String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}

function pointerSegments(path: string): string[] {
  if (path === "") return [];
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Converts a character offset in `text` to a 1-based line and column. */
export function offsetToPosition(text: string, offset: number): SourcePosition {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}

/**
 * Maps JSON pointers to line and column in the document text. JSON is valid YAML flow
 * syntax, so one YAML parse locates nodes in both formats. A pointer to a node that does
 * not exist in the source (a field inlined from a trait, a missing key) resolves to its
 * nearest existing ancestor.
 */
export class SourceLocator {
  private constructor(
    private readonly doc: ReturnType<typeof parseDocument>,
    private readonly lines: LineCounter
  ) {}

  static fromText(text: string): SourceLocator | undefined {
    try {
      const lines = new LineCounter();
      const doc = parseDocument(text, { lineCounter: lines, keepSourceTokens: false });
      return new SourceLocator(doc, lines);
    } catch {
      return undefined;
    }
  }

  locate(path: string): SourcePosition | undefined {
    const segments = pointerSegments(path);
    for (let depth = segments.length; depth >= 0; depth--) {
      const node = depth === 0 ? this.doc.contents : this.doc.getIn(segments.slice(0, depth), true);
      const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
      if (range) {
        const pos = this.lines.linePos(range[0]);
        return { line: pos.line, column: pos.col };
      }
    }
    return undefined;
  }
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(above + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length]!;
}

/** Returns the candidate closest to `name`, if one is close enough to be a likely typo. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance =
      candidate.toLowerCase() === name.toLowerCase() ? 0 : editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** "Did you mean 'x'?" when a candidate is close, otherwise the list of valid names. */
export function suggestion(name: string, candidates: readonly string[], listLabel: string): string {
  const match = closest(name, candidates);
  if (match) return `Did you mean '${match}'?`;
  if (candidates.length === 0) return `No ${listLabel} are declared.`;
  return `Valid ${listLabel}: ${candidates.join(", ")}.`;
}
