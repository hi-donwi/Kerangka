import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sampleId = process.argv[2];
if (!sampleId) {
  console.error("usage: node scripts/run-sample.mjs <sample-id>");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, "samples", "manifest.json"), "utf8"));
const entry = manifest.find((s) => s.id === sampleId);
if (!entry) {
  console.error(`unknown sample: ${sampleId}`);
  process.exit(2);
}
const modelPath = path.join(root, entry.modelPath);
const cli = path.join(root, "packages", "cli", "dist", "bin", "kerangka.js");

console.log(`== ${entry.title} (${entry.id}) ==`);
console.log(`model: ${entry.modelPath}`);
console.log(`mode:  ${entry.allowedModes.join(", ")}`);
console.log("");

const test = spawnSync("node", [cli, "test", entry.modelPath], { cwd: root, encoding: "utf8" });
process.stdout.write(test.stdout || "");
if (test.stderr) process.stderr.write(test.stderr);
if (test.status !== 0) {
  console.error(`\nFAIL: kerangka test exited ${test.status}`);
  process.exit(test.status || 1);
}
console.log("\nAll declarative examples passed.");
