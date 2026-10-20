export interface SourceText {
  format: "json" | "yaml";
  text: string;
}
export interface SourceSnapshot {
  entry: string;
  revision: string;
  sources: Record<string, SourceText>;
  excluded: number;
}

export interface StudioDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  source: string;
  path?: string;
  line?: number;
  column?: number;
  hint?: string;
}
export interface ScreenInfo {
  id: string;
  label: string;
  kind: "list" | "form" | "dashboard" | "authored";
  route: string;
  source: string;
  pointer: string;
  document: unknown;
}
export interface EntityInfo {
  name: string;
  pointer: string;
  fields: Array<{ name: string; type: string; required: boolean; computed: boolean }>;
  operations: Array<{
    name: string;
    kind: "transition" | "action";
    roles: string[];
    from?: string[];
    to?: string;
    guarded: boolean;
  }>;
}
export interface Inspection {
  app: string;
  title: string;
  roles: string[];
  entities: EntityInfo[];
  screens: ScreenInfo[];
  synthetic: Record<string, Array<Record<string, unknown>>>;
  outputs: { openapi: string; postgres: string; sqlite: string };
  sandbox: { filesystemWrites: boolean; childProcesses: boolean };
}
export interface InspectionResult {
  inspection: Inspection | null;
  diagnostics: StudioDiagnostic[];
}
export interface StudioBundle {
  kind: "kerangka.studio.source";
  version: "0.1";
  revision: string;
  entry: string;
  sources: Record<string, SourceText>;
  application: {
    pages: Record<string, { mode: "recipe"; view: string } | { mode: "authored"; source: string }>;
    routes: Array<{ id: string; path: string; page: string; access: "session" }>;
    preview: { profile: "read"; data: "synthetic" };
  };
}
export interface StudioResponse extends InspectionResult {
  bundle: StudioBundle;
  excluded: number;
  /** True when this host accepts saves. Absent means the session is read-only. */
  writable?: boolean;
}

/** A raw field definition: the Kerangka shorthand string or its object form. */
export type FieldDefinitionInput = string | Record<string, unknown>;

/**
 * Authoring operations Studio can apply to raw JSON source. The union grows as later
 * slices add constructs; an operation outside it is rejected with a diagnostic.
 */
export type DraftOperation =
  | { op: "addEntityField"; entity: string; field: string; definition: FieldDefinitionInput }
  | { op: "setEntityField"; entity: string; field: string; definition: FieldDefinitionInput };

export interface DraftRequest {
  expectedRevision: string;
  operations: readonly DraftOperation[];
  /**
   * Optional unsaved snapshot. Operations apply to these sources instead of the file
   * on disk. The expected revision is still the disk revision, so a stale file conflicts.
   */
  sources?: Record<string, SourceText>;
}

/** A draft preview: the same shape as a project read, plus what was applied. */
export interface DraftResponse extends StudioResponse {
  applied: string[];
}

/**
 * A save request carries the whole source set the operator wants on disk at an expected
 * revision. Only sources that already exist and whose text changed are written.
 */
export interface SaveRequest {
  expectedRevision: string;
  sources: Record<string, SourceText>;
}

/** A save result: the same shape as a project read, plus the paths that were written. */
export interface SaveResponse extends StudioResponse {
  revision: string;
  saved: string[];
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
  STUDIO_DRAFT_REQUEST: "The Studio draft request is not a supported operation.",
  STUDIO_REVISION_CONFLICT: "The draft changed since it was opened. Refresh and retry.",
  STUDIO_SAVE_UNAVAILABLE: "Saving is not enabled for this Studio session.",
  STUDIO_SAVE_REQUEST: "The Studio save request is not a supported write.",
  STUDIO_SAVE_INVALID: "The edited model does not compile; nothing was written.",
  STUDIO_SAVE_UNSUPPORTED: "A save may only rewrite a JSON source the project already has.",
  STUDIO_WRITE_UNSUPPORTED: "Only existing JSON sources can be edited in this version. YAML stays source-only.",
} as const;

export class StudioError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "StudioError";
  }
}

export function sourcePath(path: string): boolean {
  return (
    path.length <= 240 &&
    /^(?:(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:json|yaml|yml)|kerangka\.lock)$/.test(
      path,
    ) &&
    !/(?:^|\/)(?:node_modules|dist|build|vendor)(?:\/|$)/.test(path)
  );
}
