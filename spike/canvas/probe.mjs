import { chromium } from "playwright";
import { preview } from "vite";
import { resolve } from "node:path";

const here = import.meta.dirname;
const server = await preview({
  root: here,
  configFile: resolve(here, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 0 },
  build: { outDir: "dist-react-flow" },
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${server.resolvedUrls.local[0]}/index.html`);
await page.waitForFunction(() => window.__spike?.ready() === true, undefined, { timeout: 15000 });
const report = await page.evaluate(() => {
  const wrapper = document.querySelector(".react-flow__node");
  const html = wrapper ? wrapper.outerHTML.slice(0, 400) : null;
  const wrappers = document.querySelectorAll(".react-flow__node");
  const withDataId = document.querySelectorAll(".react-flow__node[data-id]");
  const withTabIndex = document.querySelectorAll(".react-flow__node[tabindex]");
  const first = wrappers[0];
  let focusResult = null;
  if (first) {
    first.focus();
    focusResult = {
      activeTag: document.activeElement?.tagName ?? null,
      activeClass: document.activeElement?.getAttribute("class") ?? null,
      isFirst: document.activeElement === first,
    };
  }
  return {
    html,
    wrappers: wrappers.length,
    withDataId: withDataId.length,
    withTabIndex: withTabIndex.length,
    tabIndexValue: first?.getAttribute("tabindex") ?? null,
    focusResult,
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
await server.close();
