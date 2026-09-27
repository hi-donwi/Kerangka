/**
 * Kerangka CLI - compose command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, emitDockerCompose, type ComposeOptions } from "@kerangka/compiler";

export interface ComposeCommandOptions extends ComposeOptions {
  output?: string;
}

export function composeCommand(filePath: string, options: ComposeCommandOptions = {}): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const result = emitDockerCompose(kir, options);

    if (options.output && options.output !== "-") {
      const outPath = path.resolve(process.cwd(), options.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, result.yaml, "utf-8");
      console.log(`Generated Docker Compose infrastructure (${result.services.join(", ")}) at ${options.output}`);
    } else {
      console.log(result.yaml);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating Docker Compose file: ${err.message}`);
    return false;
  }
}
