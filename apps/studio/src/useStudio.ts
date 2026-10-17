import { useEffect, useState } from "react";
import { readProject } from "./studio-api";
import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export function useStudio() {
  const [token, authenticate] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ response: StudioResponse | null; loading: boolean; error: string | null }>({
    response: null,
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    void readProject(token, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setState({ response, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "Project inspection failed.",
          }));
      });
    return () => controller.abort();
  }, [token, refresh]);
  return { ...state, authorized: Boolean(token), authenticate, reload: () => setRefresh((value) => value + 1) };
}
