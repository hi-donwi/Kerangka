import { createServer, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { PROJECT_BYTES, StudioError } from "./contracts.js";
import { openProject } from "./project.js";

export interface StudioOptions { target: string; port?: number; token?: string; prefix?: string }
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
  if (!/^\/[a-z][a-z0-9-]{0,47}$/.test(prefix) || ["/api", "/screens", "/uidl"].includes(prefix)) throw new StudioError("STUDIO_FORBIDDEN");
  let origin = "";
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    void (async () => {
      const hostCount = request.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "host").length;
      if (hostCount !== 1 || request.headers.host !== origin.slice(7)) throw new StudioError("STUDIO_FORBIDDEN");
      if (request.headers.origin !== undefined && request.headers.origin !== origin) throw new StudioError("STUDIO_FORBIDDEN");
      if (request.headers["sec-fetch-site"] === "cross-site") throw new StudioError("STUDIO_FORBIDDEN");
      const authorization = request.headers.authorization ?? "";
      const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new StudioError("STUDIO_FORBIDDEN");
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        response.setHeader("Connection", "close");
        json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts read-only requests only." });
        return;
      }
      if (request.url !== `${prefix}/api/project`) throw new StudioError("STUDIO_NOT_FOUND");
      const snapshot = await project.read();
      json(response, 200, {
        bundle: {
          kind: "kerangka.studio.source", version: "0.1", revision: snapshot.revision,
          entry: snapshot.entry, sources: snapshot.sources,
          application: { pages: {}, routes: [], preview: { profile: "read", data: "synthetic" } }
        },
        excluded: snapshot.excluded,
        diagnostics: []
      });
    })().catch((error: unknown) => {
      const safe = error instanceof StudioError ? error : new StudioError("STUDIO_PROJECT_UNAVAILABLE");
      const status = safe.code === "STUDIO_FORBIDDEN" ? 403 : safe.code === "STUDIO_NOT_FOUND" ? 404 : 422;
      if (!response.headersSent) json(response, status, { code: safe.code, message: safe.message });
      else response.destroy();
    });
  });
  server.maxConnections = 16;
  server.on("clientError", (_error, socket) => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new StudioError("STUDIO_PROJECT_UNAVAILABLE");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, token, url: `${origin}${prefix}/#token=${encodeURIComponent(token)}`,
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  };
}
