/**
 * Kerangka CLI - asyncapi command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateAsyncAPI } from "@kerangka/compiler";
import { resolveTargetFile } from "../target.js";

export interface AsyncAPICommandOptions {
  output?: string;
  broker?: "kafka" | "amqp" | "nats" | "websocket";
  host?: string;
  topic?: string;
}

/** `keranga emit asyncapi` — the event contract a consumer subscribes to (PLAN.md §11 L0). */
export function asyncapiCommand(filePath: string, options: AsyncAPICommandOptions = {}): boolean {
  try {
    // A workspace directory resolves to its manifest, the same as every other command.
    const fullPath = resolveTargetFile(filePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourcePath: fullPath });
    const document = generateAsyncAPI(kir, {
      broker: options.broker,
      host: options.host,
      topic: options.topic,
    });
    const formatted = JSON.stringify(document, null, 2);

    if (options.output && options.output !== "-") {
      const outPath = path.resolve(process.cwd(), options.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, formatted, "utf-8");
      console.log(`Generated AsyncAPI 3.0 specification at ${options.output}`);
    } else {
      console.log(formatted);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating AsyncAPI specification: ${err.message}`);
    return false;
  }
}
