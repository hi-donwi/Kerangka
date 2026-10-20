import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_BYTES, type InspectionResult, type SourceSnapshot } from "./contracts.js";

const packageRoot = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);

function trustedModuleRoots(): string[] {
  let dir = packageRoot;
  const roots = new Set([packageRoot]);
  while (dir !== dirname(dir)) {
    if (basename(dir) === "node_modules") {
      roots.add(realpathSync(dir));
      break;
    }
    if (existsSync(join(dir, "node_modules"))) {
      roots.add(realpathSync(join(dir, "node_modules")));
      break;
    }
    dir = dirname(dir);
  }
  for (const name of ["compiler", "k1", "std", "uidl-projector"]) {
    roots.add(realpathSync(join(dirname(require.resolve(`@kerangka/${name}`)), "..")));
  }
  return [...roots];
}

export async function inspectProject(snapshot: SourceSnapshot): Promise<InspectionResult> {
  const failure = (code: string): InspectionResult => ({
    inspection: null,
    diagnostics: [
      {
        severity: "error",
        code,
        source: snapshot.entry,
        message: "The bounded inspection job could not complete. Source remains read-only and available.",
        hint: "Check source complexity and supported features, then refresh. Build Studio before running it.",
      },
    ],
  });
  const input = JSON.stringify(snapshot);
  if (Buffer.byteLength(input) > PROJECT_BYTES) return failure("STUDIO_JOB_LIMIT");
  let roots: string[];
  try {
    roots = trustedModuleRoots();
  } catch {
    return failure("STUDIO_JOB_UNAVAILABLE");
  }
  return new Promise((resolve) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const child = spawn(
      process.execPath,
      [
        "--permission",
        "--max-old-space-size=128",
        ...roots.map((root) => `--allow-fs-read=${root}`),
        fileURLToPath(new URL("../dist/worker.js", import.meta.url)),
      ],
      { cwd: packageRoot, env: { TZ: "UTC", LANG: "C", NODE_NO_WARNINGS: "1" }, stdio: ["pipe", "pipe", "pipe"] },
    );
    const finish = (result: InspectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(failure("STUDIO_JOB_TIMEOUT"));
    }, 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(failure("STUDIO_JOB_LIMIT"));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => finish(failure("STUDIO_JOB_UNAVAILABLE")));
    child.stdin.on("error", () => finish(failure("STUDIO_JOB_FAILED")));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(failure("STUDIO_JOB_FAILED"));
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as InspectionResult;
        if (
          !Array.isArray(result.diagnostics) ||
          !(result.inspection === null || typeof result.inspection === "object")
        )
          throw new Error("Invalid job result");
        finish(result);
      } catch {
        finish(failure("STUDIO_JOB_FAILED"));
      }
    });
    child.stdin.end(input);
  });
}
