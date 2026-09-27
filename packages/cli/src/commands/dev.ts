/**
 * Kerangka CLI - dev command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile } from "@kerangka/compiler";
import { KerangkaServer } from "@kerangka/server";
import { MemoryStore } from "@kerangka/ports";

export interface DevOptions {
  port?: number;
  host?: string;
}

export async function devCommand(filePath: string, options: DevOptions = {}): Promise<boolean> {
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
      host: options.host || "localhost",
      store: new MemoryStore()
    });

    await server.start();

    // Keep process alive
    await new Promise<void>(() => {});
    return true;
  } catch (err: any) {
    console.error(`Error starting dev server: ${err.message}`);
    return false;
  }
}
