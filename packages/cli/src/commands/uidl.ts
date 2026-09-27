/**
 * Kerangka CLI - uidl command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateUIDL } from "@kerangka/compiler";

export function uidlCommand(filePath: string, outputDir?: string): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const docs = generateUIDL(kir);

    if (outputDir && outputDir !== "-") {
      const targetDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const [docId, doc] of Object.entries(docs)) {
        const filePath = path.join(targetDir, `${docId}.uidl.json`);
        fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf-8");
      }
      console.log(`Generated ${Object.keys(docs).length} UIDL documents in ${outputDir}`);
    } else {
      console.log(JSON.stringify(docs, null, 2));
    }

    return true;
  } catch (err: any) {
    console.error(`Error generating UIDL documents: ${err.message}`);
    return false;
  }
}
