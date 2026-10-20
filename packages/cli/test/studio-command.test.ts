import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

describe("built Studio launcher", () => {
  it("serves the UI and protected source at a custom prefix, then stops cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "kerangka-studio-cli-"));
    const target = join(root, "app.kerangka.json");
    const text = '{"kerangka":"0.1","app":"cli-studio","entities":{}}';
    await writeFile(target, text);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/bin/kerangka.js", import.meta.url)),
        "studio",
        target,
        "--port",
        "0",
        "--studio-prefix",
        "/inspect",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stderr.resume();
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", resolve);
      child.once("error", () => resolve(null));
    });
    let code: number | null = null;
    try {
      const launch = await new Promise<string>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error("Studio bootstrap did not become ready.")), 10000);
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          const match = /http:\/\/127\.0\.0\.1:\d+\/inspect\/#token=[A-Za-z0-9_-]+/.exec(output);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Studio launcher exited before bootstrap."));
        });
        child.once("error", () => {
          clearTimeout(timer);
          reject(new Error("Studio launcher could not start."));
        });
      });
      const url = new URL(launch);
      const token = new URLSearchParams(url.hash.slice(1)).get("token");
      expect((await fetch(`${url.origin}/inspect/`)).status).toBe(200);
      expect((await fetch(`${url.origin}/inspect/api/project`)).status).toBe(403);
      const response = await fetch(`${url.origin}/inspect/api/project`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.inspection.app).toBe("cli-studio");
      expect(JSON.stringify(body)).not.toContain(token);
      const write = await fetch(`${url.origin}/inspect/api/project`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, origin: url.origin },
      });
      expect(write.status).toBe(405);
      expect(await readFile(target, "utf8")).toBe(text);
    } finally {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      code = await exited;
      clearTimeout(timer);
      await rm(root, { recursive: true, force: true });
    }
    expect(code).toBe(0);
  }, 20000);
});
