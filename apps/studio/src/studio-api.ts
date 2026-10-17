import type { DraftRequest, DraftResponse, StudioResponse } from "../../../packages/studio-server/src/contracts.js";

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
      throw new StudioConflict(typeof body?.revision === "string" ? body.revision : "", message);
    throw new Error(message);
  }
  return body as T;
}

/** A stale revision, so the caller can refresh instead of losing an edit. */
export class StudioConflict extends Error {
  constructor(
    readonly revision: string,
    message: string,
  ) {
    super(message);
    this.name = "StudioConflict";
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
