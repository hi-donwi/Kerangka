import { useEffect, useState } from "react";
import { readProject, saveProject, submitDraft } from "./studio-api";
import type {
  DraftRequest,
  SaveRequest,
  SaveResponse,
  StudioResponse,
} from "../../../packages/studio-server/src/contracts.js";

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
  // A draft is a preview: it replaces the shown snapshot, never the file on disk.
  const applyDraft = async (request: DraftRequest) => {
    const next = await submitDraft(token, request);
    setState({ response: next, loading: false, error: null });
    return next;
  };
  // A save response is a full snapshot; adopt it instead of re-reading the project.
  const adopt = (response: SaveResponse) => setState({ response, loading: false, error: null });
  const saveDraft = async (request: SaveRequest) => {
    const next = await saveProject(token, request);
    adopt(next);
    return next;
  };
  return {
    ...state,
    authorized: Boolean(token),
    applyDraft,
    saveDraft,
    authenticate,
    reload: () => setRefresh((value) => value + 1),
  };
}
