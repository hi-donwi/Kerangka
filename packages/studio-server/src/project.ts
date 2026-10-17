import { constants, type Dirent } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  PROJECT_BYTES,
  SOURCE_BYTES,
  SOURCE_COUNT,
  StudioError,
  sourcePath,
  type SourceSnapshot,
  type SourceText,
} from "./contracts.js";
import { sourceRevision } from "./revision.js";

const excludedNames = new Set(["node_modules", "dist", "build", "vendor"]);
const conventional = (name: string) =>
  /(?:\.kerangka\.(?:json|yaml|yml)|\.uidl\.json)$/.test(name) ||
  /^(?:kerangka\.(?:json|yaml|yml)|kerangka\.lock)$/.test(name);
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

async function directoryEntries(path: string, remaining = 10000): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  for await (const entry of await opendir(path)) {
    if (entries.length >= remaining) throw new StudioError("STUDIO_SOURCE_LIMIT");
    entries.push(entry);
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function readSource(root: string, path: string): Promise<string> {
  if (!sourcePath(path)) throw new StudioError("STUDIO_SOURCE_PATH");
  const candidate = join(root, path);
  const canonical = await realpath(candidate);
  if (!inside(root, canonical)) throw new StudioError("STUDIO_SOURCE_UNSAFE");
  const before = await lstat(candidate);
  if (before.isSymbolicLink()) throw new StudioError("STUDIO_SYMLINK_DENIED");
  if (!before.isFile() || before.nlink !== 1) throw new StudioError("STUDIO_SOURCE_UNSAFE");
  if (before.size > SOURCE_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");
  if ((await realpath(candidate)) !== canonical) throw new StudioError("STUDIO_SOURCE_CHANGED");

  const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || !opened.isFile())
      throw new StudioError("STUDIO_SOURCE_CHANGED");
    if ((await realpath(candidate)) !== canonical) throw new StudioError("STUDIO_SOURCE_CHANGED");
    // Bound the descriptor read too: a concurrent writer may grow the file after stat().
    const buffer = Buffer.alloc(SOURCE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > SOURCE_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");
    const after = await file.stat();
    const current = await lstat(candidate);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.isSymbolicLink() ||
      (await realpath(candidate)) !== canonical
    )
      throw new StudioError("STUDIO_SOURCE_CHANGED");
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
    } catch {
      throw new StudioError("STUDIO_SOURCE_ENCODING");
    }
  } finally {
    await file.close();
  }
}

export interface StudioProject {
  readonly entry: string;
  read(): Promise<SourceSnapshot>;
}

export async function openProject(target: string): Promise<StudioProject> {
  try {
    let selected = resolve(target);
    const selection = await lstat(selected);
    if (selection.isSymbolicLink()) throw new StudioError("STUDIO_SYMLINK_DENIED");
    if (selection.isDirectory()) {
      const entries = await directoryEntries(selected);
      const preferred = ["kerangka.json", "kerangka.yaml", "kerangka.yml"].find((name) =>
        entries.some((item) => item.name === name),
      );
      const models = entries.filter((item) => item.isFile() && /\.kerangka\.(json|yaml|yml)$/.test(item.name));
      if (!preferred && models.length !== 1) throw new StudioError("STUDIO_ENTRY_REQUIRED");
      selected = join(selected, preferred ?? models[0]!.name);
    }
    const root = await realpath(dirname(selected));
    const entry = basename(selected);
    if (!sourcePath(entry)) throw new StudioError("STUDIO_SOURCE_PATH");

    return {
      entry,
      async read() {
        try {
          const names: string[] = [];
          let excluded = 0;
          let visited = 0;
          async function discover(dir: string, prefix: string, depth: number): Promise<void> {
            if (depth > 16) throw new StudioError("STUDIO_SOURCE_LIMIT");
            const entries = await directoryEntries(dir, 10000 - visited);
            visited += entries.length;
            for (const item of entries) {
              if (item.name.startsWith(".") || excludedNames.has(item.name)) {
                excluded++;
                continue;
              }
              const path = prefix ? `${prefix}/${item.name}` : item.name;
              if (item.isSymbolicLink()) throw new StudioError("STUDIO_SYMLINK_DENIED");
              if (item.isDirectory()) {
                if (!inside(root, await realpath(join(root, path)))) throw new StudioError("STUDIO_SOURCE_UNSAFE");
                const nestedRepository = await lstat(join(root, path, ".git")).then(
                  () => true,
                  (error: unknown) => {
                    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
                      return false;
                    throw error;
                  },
                );
                if (nestedRepository) {
                  excluded++;
                  continue;
                }
                await discover(join(root, path), path, depth + 1);
              } else if (item.isFile() && (path === entry || conventional(item.name))) {
                if (!sourcePath(path)) throw new StudioError("STUDIO_SOURCE_PATH");
                names.push(path);
                if (names.length > SOURCE_COUNT) throw new StudioError("STUDIO_SOURCE_LIMIT");
              } else excluded++;
            }
          }
          await discover(root, "", 0);
          if (!names.includes(entry)) throw new StudioError("STUDIO_PROJECT_UNAVAILABLE");
          const sources: Record<string, SourceText> = Object.create(null) as Record<string, SourceText>;
          const aliases = new Set<string>();
          let total = 0;
          for (const path of names.sort()) {
            if (aliases.has(path.toLowerCase())) throw new StudioError("STUDIO_SOURCE_PATH");
            aliases.add(path.toLowerCase());
            const text = await readSource(root, path);
            const bytes = Buffer.byteLength(text);
            total += bytes;
            if (total > PROJECT_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");
            sources[path] = { format: /\.(yaml|yml)$/.test(path) ? "yaml" : "json", text };
          }
          return { entry, sources, revision: sourceRevision(sources), excluded };
        } catch (error) {
          throw error instanceof StudioError ? error : new StudioError("STUDIO_PROJECT_UNAVAILABLE");
        }
      },
    };
  } catch (error) {
    throw error instanceof StudioError ? error : new StudioError("STUDIO_PROJECT_UNAVAILABLE");
  }
}
