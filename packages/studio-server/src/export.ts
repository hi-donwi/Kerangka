import { StudioError, type SourceSnapshot, type SourceText } from "./contracts.js";

export interface ExportedBundle {
  kind: "kerangka.studio.bundle";
  version: "0.1";
  entry: string;
  sources: Record<string, SourceText>;
  revision: string;
}

export function exportBundle(snapshot: SourceSnapshot): ExportedBundle {
  const sources: Record<string, SourceText> = Object.create(null) as Record<string, SourceText>;
  for (const [path, source] of Object.entries(snapshot.sources)) {
    if (source.format !== "json" && source.format !== "yaml") throw new StudioError("STUDIO_SAVE_UNSUPPORTED");
    sources[path] = { format: source.format, text: source.text };
  }
  return {
    kind: "kerangka.studio.bundle",
    version: "0.1",
    entry: snapshot.entry,
    sources,
    revision: snapshot.revision,
  };
}

export function parseImportedBundle(value: unknown): { entry: string; sources: Record<string, SourceText> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "kerangka.studio.bundle" || candidate.version !== "0.1") throw new StudioError("STUDIO_DRAFT_REQUEST");
  const entry = candidate.entry;
  if (typeof entry !== "string" || entry.length < 1 || entry.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const sources = candidate.sources;
  if (typeof sources !== "object" || sources === null || Array.isArray(sources)) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const parsed: Record<string, SourceText> = Object.create(null) as Record<string, SourceText>;
  for (const [path, raw] of Object.entries(sources as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new StudioError("STUDIO_DRAFT_REQUEST");
    const source = raw as Record<string, unknown>;
    if (source.format !== "json" && source.format !== "yaml") throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof source.text !== "string" || source.text.length < 1) throw new StudioError("STUDIO_DRAFT_REQUEST");
    parsed[path] = { format: source.format, text: source.text };
  }
  return { entry, sources: parsed };
}
