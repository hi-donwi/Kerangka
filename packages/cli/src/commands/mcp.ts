/**
 * Kerangka CLI - mcp command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateMcpTools } from "@kerangka/compiler";

export function mcpCommand(filePath: string, output?: string): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const tools = generateMcpTools(kir);
    const formatted = JSON.stringify({ tools }, null, 2);

    if (output && output !== "-") {
      const outPath = path.resolve(process.cwd(), output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, formatted, "utf-8");
      console.log(`Generated ${tools.length} MCP tool definitions at ${output}`);
    } else {
      console.log(formatted);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating MCP tool definitions: ${err.message}`);
    return false;
  }
}
