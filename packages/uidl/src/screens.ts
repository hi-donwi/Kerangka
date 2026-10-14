/**
 * Screens client for loading dynamic UIDL screens compiled by a Kerangka server (ADR-0045).
 *
 * It consumes:
 * - GET /screens -> { screens: ScreenView[] }
 * - GET /screens/{viewId} -> compiled UIDL document (list, form create, or dynamic dashboard)
 * - GET /screens/{viewId}/{id} -> compiled UIDL document (form edit with data & version)
 *
 * License: Apache-2.0
 */

import { createKerangkaHttp, type KerangkaHttpOptions } from "./http.js";

export interface ScreenView {
  id: string;
  kind: "list" | "form" | "dashboard";
  entity?: string;
  route: string;
}

export interface ScreensClient {
  /** Lists all available screens compiled for this model. */
  list(): Promise<ScreenView[]>;
  /**
   * Fetches a compiled UIDL screen document.
   * - Without `id`: fetches the view screen (list, create form, or dynamic dashboard).
   * - With `id`: fetches the record edit form screen with populated data and optimistic-concurrency version.
   */
  get(viewId: string, id?: string): Promise<Record<string, unknown>>;
  /**
   * Alias for `get`: fetches the screen document for the view, optionally with a record id.
   */
  load(viewId: string, id?: string): Promise<Record<string, unknown>>;
}

export function createScreensClient(options: KerangkaHttpOptions): ScreensClient {
  const { request } = createKerangkaHttp(options);

  return {
    async list(): Promise<ScreenView[]> {
      const res = await request<{ screens: ScreenView[] }>({
        method: "GET",
        path: "/screens",
      });
      return res.screens ?? [];
    },

    async get(viewId: string, id?: string): Promise<Record<string, unknown>> {
      const encodedViewId = encodeURIComponent(viewId);
      const path = id !== undefined
        ? `/screens/${encodedViewId}/${encodeURIComponent(id)}`
        : `/screens/${encodedViewId}`;
      return request<Record<string, unknown>>({
        method: "GET",
        path,
      });
    },

    async load(viewId: string, id?: string): Promise<Record<string, unknown>> {
      return this.get(viewId, id);
    },
  };
}
