/**
 * Kerangka CLI - graphql command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateGraphQL } from "@kerangka/compiler";

export function graphqlCommand(filePath: string, output?: string): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const sdl = generateGraphQL(kir);

    if (output && output !== "-") {
      const outPath = path.resolve(process.cwd(), output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, sdl, "utf-8");
      console.log(`Generated GraphQL SDL schema at ${output}`);
    } else {
      console.log(sdl);
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating GraphQL schema: ${err.message}`);
    return false;
  }
}
