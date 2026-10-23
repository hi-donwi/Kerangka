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
import { uidlDocument } from "./uidl-document.js";
import { journeyInternalErrors, parseJourney } from "./journey.js";
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
 * The problems of a journey source.
 *
 * A journey that is not a journey is refused before it is written, so a broken file
 * never reaches the disk. The problems that need the project are reported by the
 * inspection, not here.
 */
function journeyDiagnostics(path: string, text: string): StudioDiagnostic[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      {
        severity: "error",
        code: "STUDIO_JOURNEY_PARSE",
        source: path,
        message: "The journey is not valid JSON.",
      },
    ];
  }
  const result = parseJourney(parsed);
  if (!result.ok) return result.diagnostics;
  const internal = journeyInternalErrors(result.journey!);
  return internal.map((message) => ({
    severity: "error" as const,
    code: "STUDIO_JOURNEY_INVALID",
    source: path,
    message,
  }));
}

/**
 * Check that a new source file may be created, and that it holds a UIDL document.
 *
 * The file must not exist, its directory must be a real directory inside the project,
 * and the content must be a document the runtime could render. A file that is not a
 * document is refused here rather than at the next inspection, where the author would
 * find out about it from a broken preview.
 */
async function assertCreatable(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path);
  const parent = dirname(target);
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch {
    // The directory has to exist. Creating a chain of directories is a policy of its
    // own, and a policy nobody has reviewed yet is not a policy to guess at.
    throw new StudioError("STUDIO_SAVE_NO_DIRECTORY");
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new StudioError("STUDIO_SOURCE_UNSAFE");
  const canonicalParent = await realpath(parent);
  if (!inside(root, canonicalParent)) throw new StudioError("STUDIO_SOURCE_UNSAFE");
  try {
    await lstat(target);
    // The file is there. Creating over it would replace work the console never saw.
    throw new StudioError("STUDIO_SAVE_EXISTS");
  } catch (error) {
    if (error instanceof StudioError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new StudioError("STUDIO_SOURCE_UNSAFE");
  }
  if (!uidlDocument(text)) throw new StudioError("STUDIO_SAVE_NOT_DOCUMENT");
}

/**
 * Create a new source file.
 *
 * The file is created with the exclusive flag, so it cannot replace anything, and it
 * is written and synced before the name is published. A crash leaves either no file or
 * the whole file.
 */
async function createFile(root: string, path: string, text: string): Promise<void> {
  const target = join(root, path);
  const directory = dirname(target);
  let handle;
  try {
    // The exclusive flag is the guarantee: the file cannot be replaced, whatever the
    // checks said a moment ago.
    handle = await open(target, "wx", 0o644);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new StudioError("STUDIO_SAVE_EXISTS");
    throw new StudioError("STUDIO_SOURCE_UNSAFE");
  }
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } catch {
    // Directory fsync is unsupported on some filesystems; the file is already whole.
  } finally {
    await directoryHandle.close();
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
  const changed: Array<{ path: string; text: string; created?: boolean }> = [];
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
    if (!existing) {
      // A new file is a create, not a write. The path is checked against the source
      // rules, the parent directory has to exist inside the project, and the file
      // itself must not be there yet: creating over something would replace work
      // the console never saw.
      if (source.format !== "json") throw new StudioError("STUDIO_SAVE_UNSUPPORTED");
      await assertCreatable(project.root, path, source.text);
      sources[path] = { format: "json", text: source.text };
      changed.push({ path, text: source.text, created: true });
      continue;
    }
    if (source.text === existing.text) continue;
    // YAML round-trips verbatim through the compiler; a visual edit would reformat the file
    // out from under the operator, so only JSON sources are written in this version.
    if (source.format !== "json" || existing.format !== "json") throw new StudioError("STUDIO_SAVE_UNSUPPORTED");
    sources[path] = { format: "json", text: source.text };
    changed.push({ path, text: source.text });
  }
  if (Object.keys(sources).length > SOURCE_COUNT) throw new StudioError("STUDIO_SOURCE_LIMIT");

  // Every changed source is checked for what it is. The model is compiled; a journey is
  // read as a journey. A source that is neither is refused by the source rules above.
  const diagnostics: StudioDiagnostic[] = [];
  for (const { path, text } of changed) {
    if (path === project.entry) {
      diagnostics.push(...sourceDiagnostics(project.entry, text));
      continue;
    }
    if (path.endsWith(".journey.json")) {
      diagnostics.push(...journeyDiagnostics(path, text));
    }
  }
  if (diagnostics.some((item) => item.severity === "error")) {
    return { status: "invalid", snapshot: current, saved: [], diagnostics };
  }

  const saved: string[] = [];
  for (const { path, text, created } of changed) {
    if (created) await createFile(project.root, path, text);
    else await replaceFile(project.root, path, text);
    saved.push(path);
  }
  return {
    status: "saved",
    snapshot: { entry: project.entry, revision: sourceRevision(sources), sources, excluded: current.excluded },
    saved,
    diagnostics,
  };
}
