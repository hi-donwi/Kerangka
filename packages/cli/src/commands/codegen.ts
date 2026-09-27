/**
 * Kerangka CLI - codegen command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateCode, TargetLanguage } from "@kerangka/compiler";

export interface CodegenCommandOptions {
  target?: string;
  output?: string;
  packageName?: string;
}

export function codegenCommand(filePath: string, options: CodegenCommandOptions = {}): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const target = (options.target || "ts") as TargetLanguage;
    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const code = generateCode(kir, target, { packageName: options.packageName });

    if (options.output && options.output !== "-") {
      const outPath = path.resolve(process.cwd(), options.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, code, "utf-8");
      console.log(`Generated ${target.toUpperCase()} code at ${options.output}`);
    } else {
      console.log(code);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating code: ${err.message}`);
    return false;
  }
}
