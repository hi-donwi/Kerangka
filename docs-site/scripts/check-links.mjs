import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");
const release = JSON.parse(fs.readFileSync(path.join(siteRoot, "release.json"), "utf8"));
const distRoot = path.resolve(siteRoot, release.outDir);

if (!fs.existsSync(distRoot)) {
  console.error("check-links: dist not found; run npm run build first");
  process.exit(1);
}

const missing = [];

function resolveTarget(fromFile, url) {
  let target;
  if (url.startsWith("/")) target = path.join(siteRoot, "dist", url);
  else target = path.resolve(path.dirname(fromFile), url);

  if (target.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, "index.html");
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

const manifest = JSON.parse(fs.readFileSync(path.resolve(siteRoot, "../samples/manifest.json"), "utf8"));
for (const entry of manifest) {
  const route = entry.docsPath;
  let valid = false;
  if (typeof route === "string" && route.startsWith(`${release.basePath.replace(/\/$/, "")}/`) && !/[\\%?#]/.test(route)) {
    const url = new URL(route, "https://docs.invalid");
    if (url.origin === "https://docs.invalid" && url.pathname === route) {
      const target = resolveTarget(path.join(distRoot, "index.html"), route);
      const relative = path.relative(distRoot, target);
      valid = !relative.startsWith("..") && !path.isAbsolute(relative) && target.endsWith(".html") &&
        fs.existsSync(target) && fs.statSync(target).isFile();
    }
  }
  if (!valid) missing.push({ from: `samples/manifest.json (${entry.id})`, url: route });
}

if (missing.length) {
  console.error(`check-links FAILED: ${missing.length} broken internal link(s)`);
  for (const m of missing) console.error(`  ${m.from} -> ${m.url}`);
  process.exit(1);
}
console.log(`check-links: all internal links and ${manifest.length} sample destinations resolved`);
