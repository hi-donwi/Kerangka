/**
 * Kerangka CLI - serve command
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile } from "@kerangka/compiler";
import { KerangkaServer } from "@kerangka/server";
import { MemoryStore } from "@kerangka/ports";

export interface ServeOptions {
  port?: number;
  host?: string;
  quiet?: boolean;
}

export async function serveCommand(filePath: string, options: ServeOptions = {}): Promise<boolean> {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });

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
