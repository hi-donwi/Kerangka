/**
 * Kerangka CLI - json-schema command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateJSONSchema } from "@kerangka/compiler";
import { resolveTargetFile } from "../target.js";

export interface JSONSchemaCommandOptions {
  output?: string;
  /** Root the document at one entity, for a form generator. */
  entity?: string;
  /** Root the document at one event's payload. */
  event?: string;
  /** `additionalProperties: false` on every definition. */
  strict?: boolean;
  id?: string;
}

/**
 * `keranga emit json-schema` — the data shape and form contract L0 promises
 * (PLAN.md §11 L0, §8). Entities and event payloads come out as one document, so a
 * generator resolves every `$ref` from a single file.
 */
export function jsonSchemaCommand(filePath: string, options: JSONSchemaCommandOptions = {}): boolean {
  try {
    // A workspace directory resolves to its manifest, the same as every other command.
    const fullPath = resolveTargetFile(filePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    if (options.entity && options.event) {
      console.error("Error: --entity and --event are alternatives; pass one of them.");
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourcePath: fullPath });
    const document = generateJSONSchema(kir, {
      entity: options.entity,
      event: options.event,
      strict: options.strict,
      id: options.id,
    });
    const formatted = JSON.stringify(document, null, 2);

    if (options.output && options.output !== "-") {
      const outPath = path.resolve(process.cwd(), options.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, formatted, "utf-8");
      console.log(`Generated JSON Schema 2020-12 document at ${options.output}`);
    } else {
      console.log(formatted);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating JSON Schema document: ${err.message}`);
    return false;
  }
}
