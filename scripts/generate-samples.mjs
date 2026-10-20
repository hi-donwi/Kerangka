import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "samples", "manifest.json"), "utf8"));
const cli = path.join(root, "packages", "cli", "dist", "bin", "kerangka.js");
const outRoot = path.join(root, "generated");

if (!fs.existsSync(cli)) {
  console.error("Sample generation needs the built CLI. Run npm ci && npm run build at the repository root first.");
  process.exit(1);
}

for (const entry of manifest) {
  const modelPath = path.join(root, entry.modelPath);
  const sampleId = entry.id;
  const outDir = path.join(outRoot, sampleId);
  fs.mkdirSync(outDir, { recursive: true });

  const kir = spawnSync("node", [cli, "build", entry.modelPath, "-o", path.join(outDir, "kir.json")], { cwd: root, encoding: "utf8" });
  const openapi = spawnSync("node", [cli, "emit", "openapi", entry.modelPath, "-o", path.join(outDir, "openapi.json")], { cwd: root, encoding: "utf8" });
  const schema = spawnSync("node", [cli, "emit", "json-schema", entry.modelPath, "-o", path.join(outDir, "json-schema.json")], { cwd: root, encoding: "utf8" });
  const uidlDir = path.join(outDir, "uidl");
  fs.mkdirSync(uidlDir, { recursive: true });
  const uidl = spawnSync("node", [cli, "uidl", entry.modelPath, "-o", uidlDir], { cwd: root, encoding: "utf8" });

  if (kir.status !== 0 || openapi.status !== 0 || schema.status !== 0 || uidl.status !== 0) {
    console.error(`generate-samples FAILED for ${sampleId}`);
    console.error(kir.stderr || openapi.stderr || schema.stderr || uidl.stderr);
    process.exit(1);
  }
  console.log(`generated ${sampleId}: kir.json, openapi.json, json-schema.json, uidl/`);
}
console.log(`\ngenerate-samples: ${manifest.length} sample(s) generated under generated/`);
