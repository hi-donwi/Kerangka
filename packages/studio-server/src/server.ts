import { createServer, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  PROJECT_BYTES,
  StudioError,
  type InspectionResult,
  type StudioBundle,
  type StudioResponse,
} from "./contracts.js";
import { openProject } from "./project.js";
import { inspectProject } from "./inspection.js";
import { serveAsset } from "./assets.js";

export interface StudioOptions {
  target: string;
  port?: number;
  token?: string;
  prefix?: string;
}
export interface StudioHost {
  origin: string;
  token: string;
  url: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > PROJECT_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}

export async function startStudio(options: StudioOptions): Promise<StudioHost> {
  const project = await openProject(options.target);
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (token.length < 32 || token.length > 128) throw new StudioError("STUDIO_FORBIDDEN");
  const prefix = options.prefix ?? "/studio";
  if (!/^\/[a-z][a-z0-9-]{0,47}$/.test(prefix) || ["/api", "/screens", "/uidl"].includes(prefix))
    throw new StudioError("STUDIO_FORBIDDEN");
  let origin = "";
  let cached: { revision: string; result: InspectionResult } | undefined;
  let pending: Promise<StudioResponse> | undefined;
  const load = (): Promise<StudioResponse> => {
    // Coalesce refreshes instead of running multiple untrusted jobs for one project.
    pending ??= (async (): Promise<StudioResponse> => {
      const snapshot = await project.read();
      const result = cached?.revision === snapshot.revision ? cached.result : await inspectProject(snapshot);
      cached = { revision: snapshot.revision, result };
      const diagnostics = [...result.diagnostics];
      const pages: StudioBundle["application"]["pages"] = Object.create(null) as StudioBundle["application"]["pages"];
      const routes: StudioBundle["application"]["routes"] = [];
      for (const screen of result.inspection?.screens ?? []) {
        if (screen.kind === "authored") pages[screen.id] = { mode: "authored", source: screen.source };
        else if (screen.label.length > 0 && screen.label.length <= 128)
          pages[screen.id] = { mode: "recipe", view: screen.label };
        const reserved = [prefix, "/api", "/screens", "/uidl"].some(
          (path) => screen.route === path || screen.route.startsWith(`${path}/`),
        );
        const canonical =
          /^(?:\/|\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*)(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*))*)$/.test(
            screen.route,
          );
        if (pages[screen.id] && canonical && !reserved && !routes.some((route) => route.path === screen.route)) {
          routes.push({ id: `route-${screen.id}`, path: screen.route, page: screen.id, access: "session" });
        } else if (screen.kind !== "authored") {
          diagnostics.push({
            severity: "warning",
            code: "STUDIO_ROUTE_UNSUPPORTED",
            source: screen.source,
            path: screen.pointer,
            message: "This derived route is not installed by the read-only Studio host. Inspect its source.",
          });
        }
      }
      return {
        bundle: {
          kind: "kerangka.studio.source",
          version: "0.1",
          revision: snapshot.revision,
          entry: snapshot.entry,
          sources: snapshot.sources,
          application: { pages, routes, preview: { profile: "read", data: "synthetic" } },
        },
        excluded: snapshot.excluded,
        ...result,
        diagnostics: diagnostics.slice(0, 100),
      };
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
    (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      void (async () => {
        const hostCount = request.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "host").length;
        if (hostCount !== 1 || request.headers.host !== origin.slice(7)) throw new StudioError("STUDIO_FORBIDDEN");
        if (await serveAsset(request, response, prefix, origin)) return;
        if (request.headers.origin !== undefined && request.headers.origin !== origin)
          throw new StudioError("STUDIO_FORBIDDEN");
        if (request.headers["sec-fetch-site"] === "cross-site") throw new StudioError("STUDIO_FORBIDDEN");
        const authorization = request.headers.authorization ?? "";
        const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw new StudioError("STUDIO_FORBIDDEN");
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          response.setHeader("Connection", "close");
          json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts read-only requests only." });
          return;
        }
        if (request.url !== `${prefix}/api/project`) throw new StudioError("STUDIO_NOT_FOUND");
        json(response, 200, await load());
      })().catch((error: unknown) => {
        const safe = error instanceof StudioError ? error : new StudioError("STUDIO_PROJECT_UNAVAILABLE");
        const status = safe.code === "STUDIO_FORBIDDEN" ? 403 : safe.code === "STUDIO_NOT_FOUND" ? 404 : 422;
        if (!response.headersSent) json(response, status, { code: safe.code, message: safe.message });
        else response.destroy();
      });
    },
  );
  server.maxConnections = 16;
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new StudioError("STUDIO_PROJECT_UNAVAILABLE");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    token,
    url: `${origin}${prefix}/#token=${encodeURIComponent(token)}`,
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
