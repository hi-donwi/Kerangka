import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../../../packages/studio-server/dist/index.js";

/**
 * Start the Studio on a real project, locally.
 *
 * The fixtures are copied into a scratch directory first, so the project on disk is
 * never the one the console writes to. The URL is printed, with the token, because
 * the control plane refuses a request that does not carry it.
 */

const args = process.argv.slice(2);
const writable = args.includes("--writable");
const target = args.find((argument) => !argument.startsWith("--"));

const root = await mkdtemp(join(tmpdir(), "kerangka-studio-local-"));
if (target) {
  await cp(target, root, { recursive: true });
} else {
  const model = await readFile(
    new URL("../../../packages/cli/test/fixtures/studio/approval.kerangka.json", import.meta.url),
    "utf8",
  );
  await writeFile(join(root, "app.kerangka.json"), model);
  await writeFile(
    join(root, "help.uidl.json"),
    JSON.stringify({
      version: "1.0",
      id: "help",
      name: "Synthetic Help",
      root: {
        id: "help-root",
        type: "Container",
        children: [
          { id: "help-text", type: "Text", props: { value: "Synthetic help" } },
          { id: "help-note", type: "Text", props: { value: "Click a node in the preview to select it." } },
        ],
      },
    }),
  );
}

const host = await startStudio({ target: root, port: 0, writable });
console.log(`studio: ${host.url}`);
console.log(`project: ${root}`);
console.log(`writable: ${writable}`);
console.log("press ctrl-c to stop");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await host.close();
    process.exit(0);
  });
}
