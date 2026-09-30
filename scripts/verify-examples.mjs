/**
 * Verify every shipped example: compile it, then run its declarative examples.
 *
 * PLAN.md §23 task 10 requires `kerangka check` and `kerangka test` on every example
 * in CI. This is that gate, runnable locally with `npm run examples:verify`.
 *
 * Usage: node scripts/verify-examples.mjs [examplesDir]
 * Requires a build first (`npm run build`).
 */

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const examplesDir = resolve(process.argv[2] ?? "examples");
const cli = await import(pathToFileURL(resolve("packages/cli/dist/index.js")).href);

const targets = [];
for (const entry of readdirSync(examplesDir).sort()) {
  const full = join(examplesDir, entry);
  if (statSync(full).isDirectory()) {
    targets.push(full);
  } else if (entry.endsWith(".kerangka.json")) {
    targets.push(full);
  }
}

if (targets.length === 0) {
  console.error(`No examples found in ${examplesDir}`);
  process.exit(1);
}

let failures = 0;
for (const target of targets) {
  const label = target.slice(examplesDir.length + 1);
  const checked = cli.checkCommand(target);
  const verified = cli.verifyCommand(target);
  const tested = cli.testCommand(target);
  if (!checked || !verified || !tested) {
    failures += 1;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

console.log(`\n${targets.length - failures}/${targets.length} examples verified`);
process.exit(failures === 0 ? 0 : 1);
