export interface SourceText { format: "json" | "yaml"; text: string }
export interface SourceSnapshot {
  entry: string;
  revision: string;
  sources: Record<string, SourceText>;
  excluded: number;
}

export const SOURCE_BYTES = 512 * 1024;
export const PROJECT_BYTES = 4 * 1024 * 1024;
export const SOURCE_COUNT = 128;

const messages = {
  STUDIO_PROJECT_UNAVAILABLE: "The selected project cannot be read. Check the local source and refresh.",
  STUDIO_ENTRY_REQUIRED: "Select an explicit model file when a directory has no unique entry.",
  STUDIO_SYMLINK_DENIED: "Symbolic links are not accepted as project sources.",
  STUDIO_SOURCE_UNSAFE: "A source is not a confined, unlinked regular file.",
  STUDIO_SOURCE_CHANGED: "A source changed during reading. Refresh to read a new snapshot.",
  STUDIO_SOURCE_LIMIT: "The project exceeds the read-only source or response budget.",
  STUDIO_SOURCE_PATH: "A source name is outside the portable source-bundle contract.",
  STUDIO_SOURCE_ENCODING: "A source is not valid UTF-8 and was not normalized.",
  STUDIO_FORBIDDEN: "Studio request denied.",
  STUDIO_NOT_FOUND: "No read-only Studio resource matches this request.",
  STUDIO_READ_ONLY: "Studio accepts read-only requests only.",
} as const;

export class StudioError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "StudioError";
  }
}

export function sourcePath(path: string): boolean {
  return path.length <= 240 &&
    /^(?:(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:json|yaml|yml)|kerangka\.lock)$/.test(path) &&
    !/(?:^|\/)(?:node_modules|dist|build|vendor)(?:\/|$)/.test(path);
}
