import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const assetsRoot = fileURLToPath(new URL("../dist/public/", import.meta.url));

export async function serveAsset(
  request: IncomingMessage,
  response: ServerResponse,
  prefix: string,
  origin: string,
): Promise<boolean> {
  const url = request.url ?? "";
  if (request.method !== "GET") return false;
  if (url === prefix) {
    response.writeHead(302, { Location: `${prefix}/` });
    response.end();
    return true;
  }
  const preview = url === `${prefix}/preview.html`;
  const html = url === `${prefix}/` || preview;
  const asset = url.startsWith(`${prefix}/assets/`) ? url.slice(`${prefix}/`.length) : "";
  if (!html && !/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|md|woff2|svg)$/.test(asset)) return false;
  if (asset.includes("..")) return false;
  const path = join(assetsRoot, html ? (preview ? "preview.html" : "index.html") : asset);
  try {
    const canonicalRoot = await realpath(assetsRoot);
    const canonical = await realpath(path);
    const part = relative(canonicalRoot, canonical);
    const stat = await lstat(path);
    if (
      isAbsolute(part) ||
      part.startsWith("..") ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 4 * 1024 * 1024
    )
      return false;
    const body = await readFile(path);
    if (html) {
      response.setHeader(
        "Content-Security-Policy",
        preview
          ? `default-src 'none'; script-src ${origin}; style-src ${origin} 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}; sandbox allow-scripts`
          : "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      response.setHeader("Content-Type", "text/html; charset=utf-8");
    } else {
      // Only public, hashed build assets allow opaque-frame CORS; source APIs never do.
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      response.setHeader(
        "Content-Type",
        asset.endsWith(".js")
          ? "application/javascript; charset=utf-8"
          : asset.endsWith(".css")
            ? "text/css; charset=utf-8"
            : asset.endsWith(".svg")
              ? "image/svg+xml"
              : asset.endsWith(".woff2")
                ? "font/woff2"
                : "text/plain; charset=utf-8",
      );
    }
    response.writeHead(200);
    response.end(body);
    return true;
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Studio build assets are unavailable. Build Studio before launching it.");
    return true;
  }
}
