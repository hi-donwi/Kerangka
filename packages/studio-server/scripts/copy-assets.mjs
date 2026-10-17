import { cp, rm, stat } from "node:fs/promises";

const source = new URL("../../../apps/studio/dist/", import.meta.url);
const destination = new URL("../dist/public/", import.meta.url);
if (!(await stat(new URL("index.html", source))).isFile()) throw new Error("Build Studio before packaging its assets.");
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
