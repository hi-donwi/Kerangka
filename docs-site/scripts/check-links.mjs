import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const distRoot = path.join(siteRoot, "dist", "docs", "preview");

if (!fs.existsSync(distRoot)) {
  console.error("check-links: dist not found; run npm run build first");
  process.exit(1);
}

const missing = [];

function resolveTarget(fromFile, url) {
  let target;
  if (url.startsWith("/")) target = path.join(siteRoot, "dist", url);
  else target = path.resolve(path.dirname(fromFile), url);

  if (target.endsWith("/")) target += "index.html";
  else if (!target.endsWith(".html") && !fs.existsSync(target)) {
    if (fs.existsSync(target + ".html")) target += ".html";
    else if (fs.existsSync(path.join(target, "index.html"))) target = path.join(target, "index.html");
  }
  return target;
}

function scan(file) {
  const html = fs.readFileSync(file, "utf8");
  const re = /<a[^>]+href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("javascript:")) continue;
    if (url.startsWith("http://") || url.startsWith("https://")) continue;

    const target = resolveTarget(file, url);
    if (!fs.existsSync(target)) {
      missing.push({ from: path.relative(distRoot, file), url });
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (entry.endsWith(".html")) scan(full);
  }
}

walk(distRoot);

if (missing.length) {
  console.error(`check-links FAILED: ${missing.length} broken internal link(s)`);
  for (const m of missing) console.error(`  ${m.from} -> ${m.url}`);
  process.exit(1);
}
console.log("check-links: all internal links resolved");
