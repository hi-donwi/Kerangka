import type {
  DraftRequest,
  DraftResponse,
  SaveRequest,
  SaveResponse,
  SourceText,
  StudioDiagnostic,
  StudioResponse,
} from "../../../packages/studio-server/src/contracts.js";

export const studioBase = () => new URL(".", window.location.href).pathname;

async function post<T>(path: string, payload: unknown, token: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${studioBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body.message === "string" ? body.message : "The request could not be completed.";
    if (response.status === 409)
      throw new StudioConflict(
        typeof body?.revision === "string" ? body.revision : "",
        message,
        body?.sources && typeof body.sources === "object" ? (body.sources as Record<string, SourceText>) : undefined,
      );
    if (response.status === 422 && body?.code === "STUDIO_SAVE_INVALID")
      throw new StudioSaveRefused(
        message,
        typeof body?.revision === "string" ? body.revision : "",
        Array.isArray(body?.diagnostics) ? (body.diagnostics as StudioDiagnostic[]) : [],
      );
    throw new Error(message);
  }
  return body as T;
}

/** A stale revision, so the caller can refresh instead of losing an edit. */
export class StudioConflict extends Error {
  constructor(
    readonly revision: string,
    message: string,
    /** The winning file for each path the save tried to change; absent on draft conflicts. */
    readonly sources?: Record<string, SourceText>,
  ) {
    super(message);
    this.name = "StudioConflict";
  }
}

/** A save the server refused to write, with the diagnostics that explain why. */
export class StudioSaveRefused extends Error {
  constructor(
    message: string,
    readonly revision: string,
    readonly diagnostics: StudioDiagnostic[],
  ) {
    super(message);
    this.name = "StudioSaveRefused";
  }
}

export async function readProject(token: string, signal: AbortSignal): Promise<StudioResponse> {
  const response = await fetch(`${studioBase()}api/project`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    const problem: unknown = await response.json();
    const message =
      typeof problem === "object" && problem !== null && "message" in problem && typeof problem.message === "string"
        ? problem.message
        : "The selected project could not be read.";
    throw new Error(message);
  }
  return (await response.json()) as StudioResponse;
}

export function submitDraft(token: string, request: DraftRequest, signal?: AbortSignal): Promise<DraftResponse> {
  return post<DraftResponse>("api/draft", request, token, signal);
}

export function saveProject(token: string, request: SaveRequest, signal?: AbortSignal): Promise<SaveResponse> {
  return post<SaveResponse>("api/save", request, token, signal);
}

export function runScenarioRequest(
  token: string,
  payload: { source: string; entity: string; operation: string; record: Record<string, unknown>; actor?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<unknown> {
  return post<unknown>("api/scenario", payload, token, signal);
}

export async function exportBundleRequest(token: string): Promise<unknown> {
  const response = await fetch(`${studioBase()}api/export`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Export failed.");
  return response.json();
}

export function importBundleRequest(token: string, bundle: unknown): Promise<unknown> {
  return post<unknown>("api/import", bundle, token);
}
