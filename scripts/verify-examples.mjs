/**
 * Verify every shipped example: compile it, verify it, run its declarative examples,
 * and emit every L0 contract from it.
 *
 * PLAN.md §23 task 10 requires `kerangka check` and `kerangka test` on every example
 * in CI. This is that gate, runnable locally with `npm run examples:verify`. The
 * emitters are part of it: a contract that only works on one model is not a contract.
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

/** Contracts a model must be able to emit. `-` writes to stdout, which is discarded. */
const EMIT_TARGETS = ["openapi", "asyncapi", "sql:postgres", "sql:sqlite"];

let failures = 0;
for (const target of targets) {
  const label = target.slice(examplesDir.length + 1);
  const checked = cli.checkCommand(target);
  const verified = cli.verifyCommand(target);
  const tested = cli.testCommand(target);
  const contracts = EMIT_TARGETS.map((emitter) => cli.emitCommand(emitter, target, { output: "-" }));
  // A model against itself must report no changes, and no breaking ones: it proves the
  // differ sees the same structure the compiler produced, for every shipped example.
  const selfDiff = cli.diffCommand(target, target, { checkBreaking: true });

  if (!checked || !verified || !tested || !selfDiff || contracts.some((ok) => !ok)) {
    failures += 1;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

console.log(`\n${targets.length - failures}/${targets.length} examples verified`);
process.exit(failures === 0 ? 0 : 1);
