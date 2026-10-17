/**
 * A minimal JSON concrete-syntax editor.
 *
 * The draft operations of ST-08 must change one construct and leave every other byte
 * exactly as the author wrote it. Parsing to a value and re-serializing cannot do that,
 * so this module keeps each node's source span and splices text instead. Only JSON is
 * accepted here; a YAML write path stays source-only until it is proved separately.
 */

export class JsonEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonEditError";
  }
}

export interface JsonScalar {
  kind: "string" | "number" | "boolean" | "null";
  start: number;
  end: number;
}
export interface JsonEntry {
  key: string;
  keyStart: number;
  keyEnd: number;
  start: number;
  end: number;
  value: JsonNode;
}
export interface JsonObject {
  kind: "object";
  start: number;
  end: number;
  entries: JsonEntry[];
}
export interface JsonArray {
  kind: "array";
  start: number;
  end: number;
  items: JsonNode[];
}
export type JsonNode = JsonScalar | JsonObject | JsonArray;

interface Cursor {
  text: string;
  at: number;
}

function skipSpace(cursor: Cursor): void {
  const { text } = cursor;
  while (cursor.at < text.length && /\s/.test(text[cursor.at]!)) cursor.at++;
}

function stringEnd(cursor: Cursor, start: number): number {
  const { text } = cursor;
  let at = start + 1;
  while (at < text.length) {
    const ch = text[at];
    if (ch === "\\") {
      at += 2;
      continue;
    }
    if (ch === '"') return at + 1;
    if (ch === "\n" || ch === "\r") throw new JsonEditError(`Unterminated string at ${start}`);
    at++;
  }
  throw new JsonEditError(`Unterminated string at ${start}`);
}

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

function parseValue(cursor: Cursor): JsonNode {
  skipSpace(cursor);
  const { text } = cursor;
  const start = cursor.at;
  const ch = text[start];
  if (ch === "{") return parseObject(cursor);
  if (ch === "[") return parseArray(cursor);
  if (ch === '"') {
    const end = stringEnd(cursor, start);
    cursor.at = end;
    return { kind: "string", start, end };
  }
  if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
    const match = numberPattern.exec(text.slice(start))?.[0];
    if (!match) throw new JsonEditError(`Invalid number at ${start}`);
    cursor.at = start + match.length;
    return { kind: "number", start, end: cursor.at };
  }
  if (text.startsWith("true", start)) {
    cursor.at = start + 4;
    return { kind: "boolean", start, end: cursor.at };
  }
  if (text.startsWith("false", start)) {
    cursor.at = start + 5;
    return { kind: "boolean", start, end: cursor.at };
  }
  if (text.startsWith("null", start)) {
    cursor.at = start + 4;
    return { kind: "null", start, end: cursor.at };
  }
  throw new JsonEditError(`Unexpected token at ${start}`);
}

function parseObject(cursor: Cursor): JsonObject {
  const start = cursor.at;
  cursor.at++;
  const entries: JsonEntry[] = [];
  skipSpace(cursor);
  if (cursor.text[cursor.at] === "}") {
    cursor.at++;
    return { kind: "object", start, end: cursor.at, entries };
  }
  for (;;) {
    skipSpace(cursor);
    if (cursor.text[cursor.at] !== '"') throw new JsonEditError(`Expected a key string at ${cursor.at}`);
    const keyStart = cursor.at;
    const keyEnd = stringEnd(cursor, keyStart);
    const key = JSON.parse(cursor.text.slice(keyStart, keyEnd)) as string;
    cursor.at = keyEnd;
    skipSpace(cursor);
    if (cursor.text[cursor.at] !== ":") throw new JsonEditError(`Expected ':' at ${cursor.at}`);
    cursor.at++;
    const value = parseValue(cursor);
    entries.push({ key, keyStart, keyEnd, start: keyStart, end: value.end, value });
    skipSpace(cursor);
    const ch = cursor.text[cursor.at];
    if (ch === ",") {
      cursor.at++;
      continue;
    }
    if (ch === "}") {
      cursor.at++;
      break;
    }
    throw new JsonEditError(`Expected ',' or '}' at ${cursor.at}`);
  }
  return { kind: "object", start, end: cursor.at, entries };
}

function parseArray(cursor: Cursor): JsonArray {
  const start = cursor.at;
  cursor.at++;
  const items: JsonNode[] = [];
  skipSpace(cursor);
  if (cursor.text[cursor.at] === "]") {
    cursor.at++;
    return { kind: "array", start, end: cursor.at, items };
  }
  for (;;) {
    items.push(parseValue(cursor));
    skipSpace(cursor);
    const ch = cursor.text[cursor.at];
    if (ch === ",") {
      cursor.at++;
      continue;
    }
    if (ch === "]") {
      cursor.at++;
      break;
    }
    throw new JsonEditError(`Expected ',' or ']' at ${cursor.at}`);
  }
  return { kind: "array", start, end: cursor.at, items };
}

export function parseJson(text: string): JsonNode {
  const cursor: Cursor = { text, at: 0 };
  const node = parseValue(cursor);
  skipSpace(cursor);
  if (cursor.at !== text.length) throw new JsonEditError(`Unexpected trailing content at ${cursor.at}`);
  return node;
}

export function findPath(root: JsonNode, path: ReadonlyArray<string | number>): JsonNode | undefined {
  let node: JsonNode | undefined = root;
  for (const segment of path) {
    if (!node) return undefined;
    if (typeof segment === "number") node = node.kind === "array" ? node.items[segment] : undefined;
    else node = node.kind === "object" ? node.entries.find((entry) => entry.key === segment)?.value : undefined;
  }
  return node;
}

/**
 * Insert `key: valueText` into an existing object, matching the surrounding style. The
 * returned text is identical to the input outside the inserted span.
 */
export function insertEntry(text: string, node: JsonNode, key: string, valueText: string): string {
  if (node.kind !== "object") throw new JsonEditError("Insert target is not a JSON object");
  const open = node.start;
  const close = node.end - 1;
  const keyJson = JSON.stringify(key);
  const { entries } = node;
  if (entries.length === 0) {
    const inner = text.slice(open + 1, close);
    return `${text.slice(0, open + 1)}${inner}${keyJson}: ${valueText}${inner}${text.slice(close)}`;
  }
  const first = entries[0]!;
  const colon = text.slice(first.keyEnd, first.value.start);
  const last = entries[entries.length - 1]!;
  const gap = text.slice(last.end, close);
  if (gap.includes("\n")) {
    const newline = gap.includes("\r\n") ? "\r\n" : "\n";
    const closeIndent = gap.slice(gap.lastIndexOf(newline) + newline.length);
    const lead = text.slice(open + 1, first.start);
    const entryIndent = lead.includes("\n") ? lead.slice(lead.lastIndexOf("\n") + 1) : `${closeIndent}  `;
    return `${text.slice(0, last.end)},${newline}${entryIndent}${keyJson}${colon}${valueText}${text.slice(last.end)}`;
  }
  return `${text.slice(0, last.end)}, ${keyJson}${colon}${valueText}${text.slice(last.end)}`;
}

/** Replace a value's span with `valueText`; no other byte changes. */
export function setValue(text: string, node: JsonNode, valueText: string): string {
  return `${text.slice(0, node.start)}${valueText}${text.slice(node.end)}`;
}
