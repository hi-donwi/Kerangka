import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { startStudio, type StudioHost } from "../src/index.js";

let root: string;
let host: StudioHost;
const token = "synthetic-test-capability-01234567890123456789";
const text = '{"kerangka":"0.1","app":"synthetic","entities":{}}';
const authorization = `Bearer ${token}`;
const forbiddenHeaders: Array<Record<string, string>> = [
  {},
  { authorization: "Bearer wrong" },
  { authorization, origin: "https://evil.invalid" },
  { authorization, origin: "null" },
  { authorization, "sec-fetch-site": "cross-site" },
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kerangka-studio-http-"));
  await writeFile(join(root, "app.kerangka.json"), text);
  host = await startStudio({ target: root, port: 0, token });
});
afterEach(async () => {
  await host?.close();
  await rm(root, { recursive: true, force: true });
});

describe("read-only Studio request boundary", () => {
  it("serves only public built UI assets without a capability, including opaque-frame modules", async () => {
    const page = await fetch(`${host.origin}/studio/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="root"');
    const script = /src="\.\/(assets\/[^\"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeTruthy();
    const asset = await fetch(`${host.origin}/studio/${script}`, { headers: { origin: "null" } });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("access-control-allow-origin")).toBe("*");
    expect(asset.headers.has("access-control-allow-credentials")).toBe(false);
    const notices = await fetch(`${host.origin}/studio/assets/licenses.md`);
    expect(notices.status).toBe(200);
    expect(await notices.text()).toContain("MIT");
    expect((await fetch(`${host.origin}/studio/api/project`)).status).toBe(403);
  });

  it("returns only the chosen project to an authorized caller", async () => {
    const response = await fetch(`${host.origin}/studio/api/project`, {
      headers: { authorization, origin: host.origin },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    const body = await response.json();
    expect(body.bundle.sources[body.bundle.entry].text).toBe(text);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(root);
  });

  it.each(forbiddenHeaders)("denies unauthorized or cross-boundary request %#", async (headers) => {
    const response = await fetch(`${host.origin}/studio/api/project`, { headers });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("synthetic");
  });

  it("denies a forged Host on the actual HTTP wire", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${host.origin}/studio/api/project`,
        { headers: { authorization, host: "evil.invalid" } },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("refuses %s and leaves source untouched", async (method) => {
    const response = await fetch(`${host.origin}/studio/api/project`, {
      method,
      headers: { authorization, origin: host.origin },
    });
    expect(response.status).toBe(405);
    expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(text);
  });

  it.each([
    "/studio/api/project?path=../outside.json",
    "/studio/api/source/../outside",
    "/api/request",
    "/studio/assets/../../app.kerangka.json",
  ])("does not turn %s into filesystem or business access", async (path) => {
    const response = await fetch(`${host.origin}${path}`, { headers: { authorization } });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(text);
  });

  it("does not expose root paths or filesystem errors", async () => {
    await rm(join(root, "app.kerangka.json"));
    const response = await fetch(`${host.origin}/studio/api/project`, { headers: { authorization } });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).not.toMatch(/ENOENT|stack|\/Users\/|node:fs/);
    expect(body).not.toContain(root);
  });
});
