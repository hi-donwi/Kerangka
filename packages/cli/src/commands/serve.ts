/**
 * Kerangka CLI - serve command
 *
 * The L1 sidecar of PLAN.md §11: the engine over HTTP/JSON, or over stdio JSON-RPC
 * when `--stdio` is given. In stdio mode stdout carries the protocol only; every
 * human-readable line goes to stderr.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, CompilerError } from "@kerangka/compiler";
import { KerangkaServer, serveStdio } from "@kerangka/server";
import { loadEngine } from "@kerangka/engine-ts";
import { MemoryStore } from "@kerangka/ports";
import { resolveTargetFile } from "../target.js";

export interface ServeOptions {
  port?: number;
  host?: string;
  quiet?: boolean;
  /** Serve JSON-RPC 2.0 over stdin/stdout instead of listening on a port. */
  stdio?: boolean;
}

export async function serveCommand(filePath: string, options: ServeOptions = {}): Promise<boolean> {
  try {
    const fullPath = resolveTargetFile(filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    let kir;
    try {
      kir = compile(source, { sourcePath: fullPath });
    } catch (err) {
      if (err instanceof CompilerError) {
        for (const diag of err.diagnostics) {
          console.error(`  - [${diag.code}] ${diag.message}`);
        }
      }
      throw err;
    }

    if (options.stdio) {
      console.error(`kerangka serve: stdio JSON-RPC for '${kir.app}' (${fullPath})`);
      await serveStdio(loadEngine(kir));
      return true;
    }

    const server = new KerangkaServer(kir, {
      port: options.port || 3000,
      host: options.host || "0.0.0.0",
      store: new MemoryStore(),
      quiet: options.quiet ?? false,
    });

    await server.start();
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error starting server: ${message}`);
    return false;
  }
}
