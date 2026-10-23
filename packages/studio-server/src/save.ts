import { randomBytes } from "node:crypto";
import { open, lstat, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  PROJECT_BYTES,
  SOURCE_BYTES,
  SOURCE_COUNT,
  StudioError,
  sourcePath,
  type SaveRequest,
  type SourceSnapshot,
  type SourceText,
  type StudioDiagnostic,
} from "./contracts.js";
import { sourceDiagnostics } from "./draft.js";
import type { StudioProject } from "./project.js";
import { sourceRevision } from "./revision.js";

export interface SaveResult {
  /** `saved` carries the new snapshot; the other two describe the disk that was left alone. */
  status: "saved" | "conflict" | "invalid";
  snapshot: SourceSnapshot;
  /** Paths replaced on disk; empty unless the status is `saved`. */
  saved: string[];
  diagnostics: StudioDiagnostic[];
}

const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

const utf8 = (text: string) => Buffer.from(text, "utf8").toString("utf8") === text;
const saveQueues = new Map<string, Promise<void>>();

/**
 * Replace one existing source with new text, atomically.
 *
 * The text is written to a temporary file beside the target, fsynced, and renamed over it,
 * so a crash either leaves the previous file intact or leaves the whole new file — never
 * a half-written model. The directory is fsynced afterwards on a best-effort basis; a
 * filesystem that refuses that does not undo the rename.
 */
async function replaceFile(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path);
  const canonical = await realpath(target);
  if (!inside(root, canonical)) throw new StudioError("STUDIO_SOURCE_UNSAFE");
  const before = await lstat(target);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1)
    throw new StudioError("STUDIO_SOURCE_UNSAFE");
  if (before.size > SOURCE_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");

  const directory = dirname(target);
  const temporary = join(directory, `.${path.split("/").pop()}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temporary, "w", before.mode & 0o777);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  try {
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Directory fsync is unsupported on some filesystems; the rename already replaced the file.
  }
}

/**
 * Write an operator's source set back to the project.
 *
 * The save is compare-and-swap: it only writes when the file on disk still has the
 * revision the draft was based on, so an edit made outside Studio is never overwritten.
 * A conflict returns the winning file so both versions stay recoverable. Only sources
 * that already exist are written, one atomic replace each, and a model that does not
 * compile is refused with its diagnostics instead of being left broken on disk.
 */
export async function saveSources(project: StudioProject, request: SaveRequest): Promise<SaveResult> {
  const previous = saveQueues.get(project.root) ?? Promise.resolve();
  let release!: () => void;
  const queued = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => queued);
  saveQueues.set(project.root, tail);
  await previous;
  try {
    return await saveSourcesUnlocked(project, request);
  } finally {
    release();
    if (saveQueues.get(project.root) === tail) saveQueues.delete(project.root);
  }
}

async function saveSourcesUnlocked(project: StudioProject, request: SaveRequest): Promise<SaveResult> {
  const current = await project.read();
  if (request.expectedRevision !== current.revision) {
    return {
      status: "conflict",
      snapshot: current,
      saved: [],
      diagnostics: [
        {
          severity: "error",
          code: "STUDIO_REVISION_CONFLICT",
          source: project.entry,
          message: "The model changed on disk since this draft was opened.",
          hint: "Both versions are available; reload the file that won and reapply the edit.",
        },
      ],
    };
  }

  const sources: Record<string, SourceText> = { ...current.sources };
  const changed: Array<{ path: string; text: string }> = [];
  let requested = 0;
  for (const [path, source] of Object.entries(request.sources)) {
    if (!sourcePath(path)) throw new StudioError("STUDIO_SAVE_REQUEST");
    if (!source || typeof source !== "object" || typeof source.text !== "string") throw new StudioError("STUDIO_SAVE_REQUEST");
    if (source.format !== "json" && source.format !== "yaml") throw new StudioError("STUDIO_SAVE_REQUEST");
    const bytes = Buffer.byteLength(source.text);
    if (bytes > SOURCE_BYTES || !utf8(source.text)) throw new StudioError("STUDIO_SAVE_REQUEST");
    requested += bytes;
    if (requested > PROJECT_BYTES) throw new StudioError("STUDIO_SAVE_REQUEST");

    const existing = current.sources[path];
    if (!existing) throw new StudioError("STUDIO_SAVE_UNSUPPORTED");
    if (source.text === existing.text) continue;
    // YAML round-trips verbatim through the compiler; a visual edit would reformat the file
    // out from under the operator, so only JSON sources are written in this version.
    if (source.format !== "json" || existing.format !== "json") throw new StudioError("STUDIO_SAVE_UNSUPPORTED");
    sources[path] = { format: "json", text: source.text };
    changed.push({ path, text: source.text });
  }
  if (Object.keys(sources).length > SOURCE_COUNT) throw new StudioError("STUDIO_SOURCE_LIMIT");

  const diagnostics = sourceDiagnostics(project.entry, sources[project.entry]!.text);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "invalid", snapshot: current, saved: [], diagnostics };
  }

  const saved: string[] = [];
  for (const { path, text } of changed) {
    await replaceFile(project.root, path, text);
    saved.push(path);
  }
  return {
    status: "saved",
    snapshot: { entry: project.entry, revision: sourceRevision(sources), sources, excluded: current.excluded },
    saved,
    diagnostics,
  };
}
