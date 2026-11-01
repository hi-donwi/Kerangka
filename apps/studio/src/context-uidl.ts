export interface UidlStructureSummary {
  route?: string;
  notes: string[];
}

type JsonObject = Record<string, unknown>;

const maxNodes = 80;
const maxDepth = 8;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, limit = 120): string | undefined {
  return typeof value === "string" && value.length ? value.slice(0, limit) : undefined;
}

/** Summarize the authored UIDL shape without reading props, state, bindings, or action values. */
export function summarizeUidlDocument(document: unknown): UidlStructureSummary {
  if (!isRecord(document) || !isRecord(document.root)) return { notes: [] };
  const route = stringValue(document.route, 256);
  const notes: string[] = [];
  let visited = 0;
  let truncated = false;

  const visit = (value: unknown, depth: number, relation: string) => {
    if (!isRecord(value)) return;
    if (visited >= maxNodes) {
      truncated = true;
      return;
    }
    const id = stringValue(value.id);
    const type = stringValue(value.type) ?? "Unknown";
    const prefix = `${"  ".repeat(depth)}${relation ? `${relation} ` : ""}`;
    notes.push(`UIDL: ${prefix}${type}${id ? ` [${id}]` : ""}`);
    visited += 1;

    if (isRecord(value.events)) {
      const events = Object.keys(value.events).filter((name) => name.length <= 80).sort();
      if (events.length) notes.push(`UIDL: ${"  ".repeat(depth + 1)}events: ${events.join(", ")}`);
    }

    if (depth >= maxDepth) {
      if ((Array.isArray(value.children) && value.children.length) || isRecord(value.slots)) truncated = true;
      return;
    }
    if (Array.isArray(value.children)) {
      for (const child of value.children) visit(child, depth + 1, "");
    }
    if (isRecord(value.slots)) {
      for (const [slot, children] of Object.entries(value.slots).sort(([left], [right]) => left.localeCompare(right))) {
        if (!Array.isArray(children)) continue;
        for (const child of children) visit(child, depth + 1, `slot ${slot}:`);
      }
    }
  };

  visit(document.root, 0, "");
  if (truncated) notes.push("UIDL: additional nested elements omitted from this summary.");
  return { ...(route ? { route } : {}), notes };
}
