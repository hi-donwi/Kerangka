/**
 * Kerangka CLI - screens command
 *
 * Emits UIDL screens compiled through uidl-runtime's page recipes (ADR-0045).
 * List screens, create form screens, and dashboard templates are compiled.
 *
 * License: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compile } from "@kerangka/compiler";
import { RecipeProjector } from "@kerangka/uidl-projector";

export function screensCommand(filePath: string, outputDir?: string): boolean {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Error: File not found: ${filePath}`);
      return false;
    }

    const source = fs.readFileSync(fullPath, "utf-8");
    const kir = compile(source, { sourceFile: filePath });
    const projector = new RecipeProjector(kir);
    const screens = projector.views();

    const docs: Record<string, unknown> = {};

    for (const screenView of screens) {
      if (screenView.kind === "list") {
        docs[screenView.id] = projector.list(screenView.id);
      } else if (screenView.kind === "form") {
        docs[screenView.id] = projector.form(screenView.id);
      } else if (screenView.kind === "dashboard") {
        const kpis = projector.kpis(screenView.id);
        docs[screenView.id] = projector.dashboard(
          screenView.id,
          kpis.map(() => ({ error: "Dynamic: computed by server at runtime" }))
        );
      }
    }

    if (outputDir && outputDir !== "-") {
      const targetDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const [docId, doc] of Object.entries(docs)) {
        const outPath = path.join(targetDir, `${docId}.screen.json`);
        fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");
      }
      console.log(`Generated ${Object.keys(docs).length} UIDL screens in ${outputDir}`);
    } else {
      console.log(JSON.stringify(docs, null, 2));
    }

    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error generating screens: ${message}`);
    return false;
  }
}
