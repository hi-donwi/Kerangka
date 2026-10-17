import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export const studioBase = () => new URL(".", window.location.href).pathname;

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
