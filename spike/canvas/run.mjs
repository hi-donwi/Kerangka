import { chromium } from "playwright";
import { build, preview } from "vite";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

/**
 * The NX-02 spike driver.
 *
 * Each candidate is built for production on its own, served from that build, and
 * driven by the same gestures, in the same order, against the same fixture. The build
 * matters: the size of a development bundle with hot reload says nothing about what a
 * user downloads, and a shared chunk between two candidates makes the number
 * meaningless. The output is a JSON file, and the report in
 * `docs/studio/canvas-spike.md` is written from it. Nothing here ships: the spike is
 * evidence for one decision.
 */

const here = import.meta.dirname;
const SELECTIONS = 30;
const DRAGS = 30;
const ZOOMS = 20;
const PANS = 20;

const CANDIDATES = [
  { implementation: "react-flow", entry: "index.html" },
  { implementation: "native-svg", entry: "svg.html" },
];

async function measureBuild(directory) {
  const files = await readdir(directory, { recursive: true });
  const result = [];
  let totalGzip = 0;
  let totalBytes = 0;
  for (const entry of files) {
    const name = String(entry);
    if (!/\.(js|css)$/.test(name)) continue;
    const path = join(directory, name);
    const info = await stat(path);
    if (!info.isFile()) continue;
    const text = await readFile(path);
    const gzipBytes = gzipSync(text, { level: 9 }).length;
    totalGzip += gzipBytes;
    totalBytes += info.size;
    result.push({ file: name.replace(/^dist[^\\/]*[\\/]/, ""), bytes: info.size, gzipBytes });
  }
  return { files: result.sort((a, b) => b.gzipBytes - a.gzipBytes), totalGzip, totalBytes };
}

async function runCandidate(browser, implementation, entry, outDir) {
  const server = await preview({
    root: here,
    configFile: resolve(here, "vite.config.ts"),
    logLevel: "warn",
    preview: { port: 0 },
    build: { outDir },
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Couldn\u2019t create edge")) return;
    if (text.includes("hiding the attribution")) return;
    errors.push(text);
  });
  await page.goto(`${server.resolvedUrls.local[0]}${entry}`);
  await page.waitForFunction(() => window.__spike?.ready() === true, undefined, { timeout: 15000 });

  // The functional checks come first, while the graph is untouched.
  const workflowFacts = await page.evaluate(() => window.__spike.facts());
  const cycle = await page.evaluate(() => window.__spike.attemptConnect("n3", "n1"));
  await page.evaluate(() => window.__spike.useGraph("containment"));
  await page.waitForTimeout(250);
  // n0 is an ancestor of n1 in the containment tree, so linking n1 to n0 is a cycle.
  const containmentCycle = await page.evaluate(() => window.__spike.attemptConnect("n1", "n0"));
  const containmentFacts = await page.evaluate(() => window.__spike.facts());
  await page.evaluate(() => window.__spike.useGraph("workflow"));
  await page.waitForTimeout(250);

  // Targets are the nodes that are actually on screen, read from the layout rather
  // than guessed from the fixture, so a virtualized canvas and a plain one are driven
  // against the same visible set.
  const targets = await page.evaluate(() => {
    const boxes = [];
    for (const element of document.querySelectorAll("[data-spike-node]")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight) continue;
      boxes.push({ id: element.getAttribute("data-spike-node"), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    }
    return boxes;
  });
  if (!targets.length) throw new Error(`${implementation}: no node was rendered inside the viewport`);

  // A node that is on screen in both candidates: a virtualized canvas does not render
  // a node outside the viewport, and focusing one that is absent proves nothing.
  const keyboardTarget = targets[0].id;
  const keyboard = await page.evaluate((id) => {
    const focused = window.__spike.focusNode(id);
    return { focused, id, before: window.__spike.nodePosition(id) };
  }, keyboardTarget);
  // The real user path: focus the node and press the key.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const keyboardAfter = await page.evaluate((id) => window.__spike.nodePosition(id), keyboardTarget);
  const probe = await page.evaluate(() => window.__spike.probe());
  keyboard.delta = keyboard.before && keyboardAfter ? keyboardAfter.x - keyboard.before.x : null;

  // Frame pacing while a drag is in progress, sampled in the page so the number is
  // the browser's own frame cadence and not the automation channel's.
  await page.evaluate(() => {
    window.__frames = [];
    window.__frameStop = false;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      if (!window.__frameStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const dragTarget = targets[1] ?? targets[0];
  await page.mouse.move(dragTarget.x, dragTarget.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(dragTarget.x + step * 6, dragTarget.y + step * 3);
  }
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    window.__frameStop = true;
    return window.__frames;
  });
  const sortedFrames = [...frames].sort((a, b) => a - b);
  const frameP95 = sortedFrames.length ? sortedFrames[Math.ceil(sortedFrames.length * 0.95) - 1] : 0;
  const frameP50 = sortedFrames.length ? sortedFrames[Math.ceil(sortedFrames.length * 0.5) - 1] : 0;

  await page.evaluate(() => window.__spike.resetMetrics());

  // The page records the moment it received each input event. The interaction samples
  // are measured from the last one, so the driver's own channel is not counted.
  await page.evaluate(() => {
    window.__lastInputAt = performance.now();
    for (const type of ["pointerdown", "pointerup", "pointermove", "wheel", "keydown"]) {
      document.addEventListener(type, () => {
        window.__lastInputAt = performance.now();
      }, true);
    }
  });

  for (let index = 0; index < SELECTIONS; index++) {
    const target = targets[index % targets.length];
    await page.evaluate(() => window.__spike.beginInteraction("select"));
    await page.mouse.click(target.x, target.y);
    await page.evaluate(() => window.__spike.endInteraction("select"));
    // A person does not click thirty times inside one frame. Without this pause the
    // next interaction starts before the previous one has been painted, and the
    // samples collapse into each other.
    await page.waitForTimeout(60);
  }

  for (let index = 0; index < DRAGS; index++) {
    const target = targets[index % targets.length];
    await page.evaluate(() => window.__spike.beginInteraction("drag"));
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(target.x + step * 10, target.y + step * 4);
    }
    await page.mouse.up();
    await page.evaluate(() => window.__spike.endInteraction("drag"));
    await page.waitForTimeout(60);
  }

  const centre = targets[0];
  for (let index = 0; index < ZOOMS; index++) {
    await page.evaluate(() => window.__spike.beginInteraction("zoom"));
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, index % 2 === 0 ? -120 : 120);
    await page.evaluate(() => window.__spike.endInteraction("zoom"));
    await page.waitForTimeout(40);
  }

  for (let index = 0; index < PANS; index++) {
    await page.evaluate(() => window.__spike.beginInteraction("pan"));
    await page.mouse.move(30, 30);
    await page.mouse.down();
    await page.mouse.move(60 + index, 50 + index);
    await page.mouse.up();
    await page.evaluate(() => window.__spike.endInteraction("pan"));
    await page.waitForTimeout(40);
  }

  const metrics = await page.evaluate(() => window.__spike.metrics());
  const finalFacts = await page.evaluate(() => window.__spike.facts());
  await page.close();
  await server.close();
  return {
    implementation,
    workflowFacts,
    containmentFacts,
    cycleAccepted: cycle.accepted,
    containmentCycleRefused: containmentCycle.accepted === false,
    containmentCycleReason: containmentCycle.reason ?? null,
    keyboard,
    probe,
    framePacing: { samples: frames.length, p50: Number(frameP50.toFixed(2)), p95: Number(frameP95.toFixed(2)) },
    metrics,
    finalFacts,
    visibleNodes: targets.length,
    errors,
  };
}

const browser = await chromium.launch();
const results = [];
const bundles = [];
try {
  for (const candidate of CANDIDATES) {
    const outDir = `dist-${candidate.implementation}`;
    process.env.SPIKE_ENTRY = candidate.entry;
    process.env.SPIKE_OUT = outDir;
    await build({ root: here, configFile: resolve(here, "vite.config.ts"), logLevel: "warn" });
    bundles.push({ implementation: candidate.implementation, ...(await measureBuild(resolve(here, outDir))) });
    results.push(await runCandidate(browser, candidate.implementation, `/${candidate.entry}`, outDir));
  }
} finally {
  await browser.close();
}

const output = {
  measuredAt: new Date().toISOString(),
  fixture: { nodes: 250, edges: 500, selections: SELECTIONS, drags: DRAGS, zooms: ZOOMS, pans: PANS },
  bundles,
  results,
};
await writeFile(resolve(here, "result.json"), `${JSON.stringify(output, null, 2)}\n`);

for (const result of results) {
  console.log(`\n== ${result.implementation}`);
  console.log(`   visible nodes:        ${result.visibleNodes}`);
  console.log(`   rendered nodes/edges: ${result.finalFacts.renderedNodes}/${result.finalFacts.renderedEdges}`);
  console.log(`   connection handles:   ${result.finalFacts.connectionHandles}`);
  console.log(`   cycle accepted:        ${result.cycleAccepted}`);
  console.log(`   containment refused:   ${result.containmentCycleRefused}`);
  console.log(`   keyboard move delta:   ${result.keyboard.delta} (focused=${result.keyboard.focused})`);
  console.log(`   probe:                 ${JSON.stringify(result.probe)}`);
  console.log(
    `   frame pacing:         p50=${result.framePacing.p50}ms p95=${result.framePacing.p95}ms over ${result.framePacing.samples} frames`,
  );
  for (const [kind, sample] of Object.entries(result.metrics)) {
    console.log(
      `   ${kind.padEnd(10)} n=${String(sample.count).padStart(3)} p50=${String(sample.p50).padStart(7)}ms p95=${String(sample.p95).padStart(7)}ms max=${String(sample.max).padStart(8)}ms`,
    );
  }
  if (result.errors.length) console.log(`   page errors: ${result.errors.slice(0, 3).join(" | ")}`);
}
console.log("\nbundles:");
for (const bundle of bundles) {
  console.log(`   ${bundle.implementation}: ${bundle.totalGzip} B gzip total (${bundle.totalBytes} B raw)`);
  for (const file of bundle.files) console.log(`      ${String(file.gzipBytes).padStart(7)} B  ${file.file}`);
}
