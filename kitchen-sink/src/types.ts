export interface ManifestInput {
  name: string;
  run: string;
  record: Record<string, unknown>;
  input?: Record<string, unknown>;
  actor?: Record<string, unknown>;
}

export interface ManifestOutcome {
  input: string;
  status: "ok" | "denied" | "error";
  error?: string;
  record?: Record<string, unknown>;
}

export interface ManifestEntry {
  id: string;
  title: string;
  modelPath: string;
  docsPath: string;
  sourcePath?: string;
  allowedModes: Array<"preview" | "run" | "export">;
  inputs: ManifestInput[];
  expected: { outcomes: ManifestOutcome[] };
  support: "supported" | "partial" | "planned";
  version: string;
}
