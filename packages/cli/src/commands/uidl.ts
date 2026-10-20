/**
 * Kerangka CLI - uidl command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile, generateUIDL, UIDLGenerator } from "@kerangka/compiler";

export interface UidlCommandOptions {
  dynamicDashboards?: boolean;
  overlaysDir?: string;
}

export function uidlCommand(filePath: string, outputDir?: string, options?: UidlCommandOptions): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const docs = generateUIDL(kir, { includeDynamicDashboards: options?.dynamicDashboards });
    for (const refused of UIDLGenerator.refusedDashboards(kir, { includeDynamicDashboards: options?.dynamicDashboards })) {
      console.error(refused.message);
    }

    const modelDir = path.dirname(fullPath);

    if (outputDir && outputDir !== "-") {
      const targetDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const [docId, doc] of Object.entries(docs)) {
        let finalDoc = doc;

        // Check for overlay files in overlaysDir, targetDir, or modelDir
        const candidates = [
          options?.overlaysDir ? path.join(path.resolve(process.cwd(), options.overlaysDir), `${docId}.overlay.json`) : null,
          path.join(targetDir, `${docId}.overlay.json`),
          path.join(modelDir, `${docId}.overlay.json`),
        ].filter((p): p is string => Boolean(p));

        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            try {
              const overlay = JSON.parse(fs.readFileSync(candidate, "utf-8"));
              finalDoc = UIDLGenerator.mergeOverlay(finalDoc, overlay);
              break;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`Warning: Failed to parse overlay ${candidate}: ${msg}`);
            }
          }
        }

        const outPath = path.join(targetDir, `${docId}.uidl.json`);
        fs.writeFileSync(outPath, JSON.stringify(finalDoc, null, 2), "utf-8");
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
