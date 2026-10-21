import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  PROJECT_BYTES,
  SOURCE_BYTES,
  SOURCE_COUNT,
  StudioError,
  sourcePath,
  type DraftOperation,
  type JourneyDraftOperation,
  type UidlDraftOperation,
  type DraftRequest,
  type FieldDefinitionInput,
  type InspectionResult,
  type SaveRequest,
  type SourceSnapshot,
  type SourceText,
  type StudioBundle,
  type StudioResponse,
} from "./contracts.js";
import { openProject } from "./project.js";
import { inspectProject } from "./inspection.js";
import { applyDraftOperations, changedSources, overlaySources } from "./draft.js";
import { sourceRevision } from "./revision.js";
import { saveSources } from "./save.js";
import { runScenario } from "./scenario.js";
import { exportBundle, parseImportedBundle } from "./export.js";
import { serveAsset } from "./assets.js";

export interface StudioOptions {
  target: string;
  port?: number;
  token?: string;
  prefix?: string;
  /** Mount the compare-and-swap save endpoint. Off means Studio is read-only on disk. */
  writable?: boolean;
}
export interface StudioHost {
  origin: string;
  token: string;
  url: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > PROJECT_BYTES) throw new StudioError("STUDIO_SOURCE_LIMIT");
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}

const DRAFT_BYTES = PROJECT_BYTES;
const DRAFT_OPERATIONS = 32;
const DRAFT_DEFINITION = 4096;

async function readDraftBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > DRAFT_BYTES) {
      request.destroy();
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readScenarioBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 64 * 1024) {
      request.destroy();
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse and strictly bound an untrusted draft request into the engine's shape. */
/**
 * Read one journey operation from the request.
 *
 * The console proposes the change; the server checks the shape and the bounds, and the
 * journey contract checks the meaning. Nothing is trusted because it came from the
 * browser.
 */
function parseJourneyOperation(entry: Record<string, unknown>): JourneyDraftOperation {
  const journey = entry.journey;
  if (typeof journey !== "string" || journey.length < 1 || journey.length > 240)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (entry.op === "journeyAddStep" || entry.op === "journeyAddLink") {
    const value = entry.op === "journeyAddStep" ? entry.step : entry.link;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const record = value as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (entry.op === "journeyAddStep") {
      const kind = record.kind;
      if (kind !== "page" && kind !== "operation") throw new StudioError("STUDIO_DRAFT_REQUEST");
      const page = record.page;
      const operation = record.operation;
      if (kind === "page" && (typeof page !== "string" || page.length < 1 || page.length > 64))
        throw new StudioError("STUDIO_DRAFT_REQUEST");
      if (kind === "operation" && (typeof operation !== "string" || operation.length < 1 || operation.length > 128))
        throw new StudioError("STUDIO_DRAFT_REQUEST");
      return {
        op: "journeyAddStep",
        journey,
        step: {
          id,
          kind,
          ...(typeof page === "string" ? { page } : {}),
          ...(typeof operation === "string" ? { operation } : {}),
          ...(typeof record.label === "string" && record.label.length <= 128 ? { label: record.label } : {}),
        },
      };
    }
    const from = record.from;
    const to = record.to;
    const kind = record.kind;
    if (typeof from !== "string" || typeof to !== "string" || typeof kind !== "string")
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (from.length > 64 || to.length > 64 || kind.length > 32) throw new StudioError("STUDIO_DRAFT_REQUEST");
    const pointer = record.pointer;
    if (pointer !== undefined && (typeof pointer !== "string" || pointer.length > 512))
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return {
      op: "journeyAddLink",
      journey,
      link: {
        id,
        from,
        to,
        kind,
        ...(typeof pointer === "string" ? { pointer } : {}),
        ...(typeof record.label === "string" && record.label.length <= 128 ? { label: record.label } : {}),
      },
    };
  }
  const target = entry.op === "journeyRemoveStep" ? entry.step : entry.link;
  if (typeof target !== "string" || target.length < 1 || target.length > 64)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  return entry.op === "journeyRemoveStep"
    ? { op: "journeyRemoveStep", journey, step: target }
    : { op: "journeyRemoveLink", journey, link: target };
}

/** Read one UIDL operation from the request. */
function parseUidlOperation(entry: Record<string, unknown>): UidlDraftOperation {
  const source = entry.source;
  if (typeof source !== "string" || source.length < 1 || source.length > 240)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (entry.op === "uidlSetNodeProp") {
    const prop = entry.prop;
    if (typeof prop !== "object" || prop === null || Array.isArray(prop))
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const record = prop as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.length < 1 || record.key.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const node = entry.node;
    if (typeof node !== "string" || node.length < 1 || node.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return {
      op: "uidlSetNodeProp",
      source,
      node,
      prop: { key: record.key, value: record.value },
    };
  }
  if (entry.op === "uidlMoveNode") {
    const node = entry.node;
    const parent = entry.parent;
    const index = entry.index;
    if (typeof node !== "string" || node.length < 1 || node.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof parent !== "string" || parent.length < 1 || parent.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 10000)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return { op: "uidlMoveNode", source, node, parent, index };
  }
  if (entry.op === "uidlAddDefinition") {
    const name = entry.name;
    const node = entry.node;
    if (typeof name !== "string" || name.length < 1 || name.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof node !== "object" || node === null || Array.isArray(node))
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const record = node as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length < 1 || record.id.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof record.type !== "string" || record.type.length < 1 || record.type.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return { op: "uidlAddDefinition", source, name, node: { id: record.id, type: record.type } };
  }
  if (entry.op === "uidlUseDefinition") {
    const node = entry.node;
    const definition = entry.definition;
    if (typeof node !== "string" || node.length < 1 || node.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof definition !== "string" || definition.length < 1 || definition.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return { op: "uidlUseDefinition", source, node, definition };
  }
  if (entry.op === "uidlAddNode") {
    const node = entry.node;
    if (typeof node !== "object" || node === null || Array.isArray(node))
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const record = node as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length < 1 || record.id.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof record.type !== "string" || record.type.length < 1 || record.type.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    const parent = entry.parent;
    if (typeof parent !== "string" || parent.length < 1 || parent.length > 64)
      throw new StudioError("STUDIO_DRAFT_REQUEST");
    return { op: "uidlAddNode", source, parent, node: { id: record.id, type: record.type } };
  }
  const node = entry.node;
  if (typeof node !== "string" || node.length < 1 || node.length > 64)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  return { op: "uidlRemoveNode", source, node };
}

function parseDraftRequest(raw: string): DraftRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const candidate = value as Record<string, unknown>;
  const expectedRevision = candidate.expectedRevision;
  if (typeof expectedRevision !== "string" || expectedRevision.length < 1 || expectedRevision.length > 200)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  const items = candidate.operations;
  const sources = candidate.sources === undefined ? undefined : parseSourceMap(candidate.sources, "STUDIO_DRAFT_REQUEST");
  if (!Array.isArray(items) || items.length > 32) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (items.length < 1 && !sources) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const operations: DraftOperation[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new StudioError("STUDIO_DRAFT_REQUEST");
    const entry = item as Record<string, unknown>;
    if (entry.op === "setFormSections") {
      operations.push(parseFormSections(entry));
      continue;
    }
    if (entry.op === "setTransition") {
      operations.push(parseTransition(entry));
      continue;
    }
    if (typeof entry.op === "string" && entry.op.startsWith("uidl")) {
      operations.push(parseUidlOperation(entry));
      continue;
    }
    if (typeof entry.op === "string" && entry.op.startsWith("journey")) {
      operations.push(parseJourneyOperation(entry));
      continue;
    }
    if (entry.op !== "addEntityField" && entry.op !== "setEntityField") throw new StudioError("STUDIO_DRAFT_REQUEST");
    const { entity, field } = entry;
    if (typeof entity !== "string" || entity.length < 1 || entity.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (typeof field !== "string" || field.length < 1 || field.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
    const definition = entry.definition;
    const stringDefinition = typeof definition === "string" && definition.length <= 4096;
    const objectDefinition =
      typeof definition === "object" &&
      definition !== null &&
      !Array.isArray(definition) &&
      JSON.stringify(definition).length <= 4096;
    if (!stringDefinition && !objectDefinition) throw new StudioError("STUDIO_DRAFT_REQUEST");
    operations.push({ op: entry.op, entity, field, definition: definition as FieldDefinitionInput });
  }
  return sources ? { expectedRevision, operations, sources } : { expectedRevision, operations };
}

function parseFormSections(entry: Record<string, unknown>): DraftOperation {
  const view = entry.view;
  const sections = entry.sections;
  const sectionTitles = entry.sectionTitles;
  if (typeof view !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(view) || view.length > 128)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 8) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (!Array.isArray(sectionTitles) || sectionTitles.length !== sections.length) throw new StudioError("STUDIO_DRAFT_REQUEST");
  const seen = new Set<string>();
  const titles = new Set<string>();
  const parsed: string[][] = [];
  for (const section of sections) {
    if (!Array.isArray(section) || section.length < 1 || section.length > 16) throw new StudioError("STUDIO_DRAFT_REQUEST");
    const names: string[] = [];
    for (const name of section) {
      if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 64)
        throw new StudioError("STUDIO_DRAFT_REQUEST");
      if (seen.has(name)) throw new StudioError("STUDIO_DRAFT_REQUEST");
      seen.add(name);
      names.push(name);
    }
    parsed.push(names);
  }
  const parsedTitles: string[] = [];
  for (const title of sectionTitles) {
    if (typeof title !== "string" || title.trim().length < 1 || title.length > 64) throw new StudioError("STUDIO_DRAFT_REQUEST");
    if (titles.has(title)) throw new StudioError("STUDIO_DRAFT_REQUEST");
    titles.add(title);
    parsedTitles.push(title);
  }
  return { op: "setFormSections", view, sections: parsed, sectionTitles: parsedTitles };
}

function parseTransition(entry: Record<string, unknown>): DraftOperation {
  const entity = entry.entity;
  const transition = entry.transition;
  const from = entry.from;
  const to = entry.to;
  const roles = entry.roles;
  const when = entry.when;
  if (typeof entity !== "string" || entity.length < 1 || entity.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (typeof transition !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(transition) || transition.length > 64)
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (!Array.isArray(from) || from.length < 1 || from.length > 16 || !from.every((item) => typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)))
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (typeof to !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (!Array.isArray(roles) || !roles.every((item) => typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)))
    throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (when !== undefined && (typeof when !== "string" || when.length > 512)) throw new StudioError("STUDIO_DRAFT_REQUEST");
  return { op: "setTransition", entity, transition, from, to, roles, ...(when ? { when } : {}) };
}

function parseSourceMap(map: unknown, code: "STUDIO_DRAFT_REQUEST" | "STUDIO_SAVE_REQUEST"): Record<string, SourceText> {
  if (typeof map !== "object" || map === null || Array.isArray(map)) throw new StudioError(code);
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length < 1 || entries.length > SOURCE_COUNT) throw new StudioError(code);
  const sources: Record<string, SourceText> = Object.create(null) as Record<string, SourceText>;
  let total = 0;
  for (const [path, raw] of entries) {
    if (!sourcePath(path) || typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new StudioError(code);
    const source = raw as Record<string, unknown>;
    const { format, text } = source;
    if (format !== "json" && format !== "yaml") throw new StudioError(code);
    if (typeof text !== "string" || Buffer.byteLength(text) > SOURCE_BYTES) throw new StudioError(code);
    total += Buffer.byteLength(text);
    if (total > PROJECT_BYTES) throw new StudioError(code);
    sources[path] = { format, text };
  }
  return sources;
}

/** Read an untrusted save body, bounded by the whole-project budget. */
async function readSaveBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > PROJECT_BYTES) {
      request.destroy();
      throw new StudioError("STUDIO_SAVE_REQUEST");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse and strictly bound an untrusted save request into the engine's shape. */
function parseSaveRequest(raw: string): SaveRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StudioError("STUDIO_SAVE_REQUEST");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StudioError("STUDIO_SAVE_REQUEST");
  const candidate = value as Record<string, unknown>;
  const expectedRevision = candidate.expectedRevision;
  if (typeof expectedRevision !== "string" || expectedRevision.length < 1 || expectedRevision.length > 200)
    throw new StudioError("STUDIO_SAVE_REQUEST");
  return { expectedRevision, sources: parseSourceMap(candidate.sources, "STUDIO_SAVE_REQUEST") };
}

/** Project a source snapshot plus its inspection into the client bundle shape. */
function assemble(
  snapshot: SourceSnapshot,
  prefix: string,
  result: InspectionResult,
  writable: boolean,
): StudioResponse {
  const diagnostics = [...result.diagnostics];
  const pages: StudioBundle["application"]["pages"] = Object.create(null) as StudioBundle["application"]["pages"];
  const routes: StudioBundle["application"]["routes"] = [];
  for (const screen of result.inspection?.screens ?? []) {
    if (screen.kind === "authored") pages[screen.id] = { mode: "authored", source: screen.source };
    else if (screen.label.length > 0 && screen.label.length <= 128)
      pages[screen.id] = { mode: "recipe", view: screen.label };
    const reserved = [prefix, "/api", "/screens", "/uidl"].some(
      (path) => screen.route === path || screen.route.startsWith(`${path}/`),
    );
    const canonical =
      /^(?:\/|\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*)(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9_]*))*)$/.test(
        screen.route,
      );
    if (pages[screen.id] && canonical && !reserved && !routes.some((route) => route.path === screen.route)) {
      routes.push({ id: `route-${screen.id}`, path: screen.route, page: screen.id, access: "session" });
    } else if (screen.kind !== "authored") {
      diagnostics.push({
        severity: "warning",
        code: "STUDIO_ROUTE_UNSUPPORTED",
        source: screen.source,
        path: screen.pointer,
        message: "This derived route is not installed by the read-only Studio host. Inspect its source.",
      });
    }
  }
  return {
    bundle: {
      kind: "kerangka.studio.source",
      version: "0.1",
      revision: snapshot.revision,
      entry: snapshot.entry,
      sources: snapshot.sources,
      application: { pages, routes, preview: { profile: "read", data: "synthetic" } },
    },
    excluded: snapshot.excluded,
    writable,
    ...result,
    diagnostics: diagnostics.slice(0, 100),
  };
}

function dedupeDiagnostics(diagnostics: StudioResponse["diagnostics"]): StudioResponse["diagnostics"] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.severity}|${item.code}|${item.source}|${item.path ?? ""}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function startStudio(options: StudioOptions): Promise<StudioHost> {
  const project = await openProject(options.target);
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (token.length < 32 || token.length > 128) throw new StudioError("STUDIO_FORBIDDEN");
  const prefix = options.prefix ?? "/studio";
  if (!/^\/[a-z][a-z0-9-]{0,47}$/.test(prefix) || ["/api", "/screens", "/uidl"].includes(prefix))
    throw new StudioError("STUDIO_FORBIDDEN");
  let origin = "";
  let cached: { revision: string; result: InspectionResult } | undefined;
  let pending: Promise<StudioResponse> | undefined;
  const writable = options.writable === true;
  const load = (): Promise<StudioResponse> => {
    // Coalesce refreshes instead of running multiple untrusted jobs for one project.
    pending ??= (async (): Promise<StudioResponse> => {
      const snapshot = await project.read();
      const result = cached?.revision === snapshot.revision ? cached.result : await inspectProject(snapshot);
      cached = { revision: snapshot.revision, result };
      return assemble(snapshot, prefix, result, writable);
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const handleDraft = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const draftRequest = parseDraftRequest(await readDraftBody(request));
    const snapshot = await project.read();
    if (draftRequest.expectedRevision !== snapshot.revision) {
      json(response, 409, {
        code: "STUDIO_REVISION_CONFLICT",
        message: "The draft changed since it was opened. Refresh and retry.",
        revision: snapshot.revision,
      });
      return;
    }
    // A draft never touches disk; the compiler check runs once, in the inspection job.
    const overlaid = overlaySources(snapshot.sources, draftRequest.sources);
    const base: SourceSnapshot = {
      entry: snapshot.entry,
      revision: snapshot.revision,
      sources: overlaid,
      excluded: snapshot.excluded,
    };
    const draft = draftRequest.operations.length
      ? applyDraftOperations(base, { expectedRevision: snapshot.revision, operations: draftRequest.operations }, { validate: () => [] })
      : {
          revision: sourceRevision(overlaid),
          sources: overlaid,
          applied: changedSources(snapshot.sources, overlaid).map((path) => `setSource ${path}`),
          diagnostics: [],
        };
    const edited: SourceSnapshot = {
      entry: snapshot.entry,
      revision: draft.revision,
      sources: draft.sources,
      excluded: snapshot.excluded,
    };
    const assembled = assemble(edited, prefix, await inspectProject(edited), writable);
    json(response, 200, {
      ...assembled,
      applied: draft.applied,
      diagnostics: dedupeDiagnostics([...draft.diagnostics, ...assembled.diagnostics]).slice(0, 100),
    });
  };
  const handleSave = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const saveRequest = parseSaveRequest(await readSaveBody(request));
    const outcome = await saveSources(project, saveRequest);
    if (outcome.status === "conflict") {
      // Ship only the paths the operator tried to change, so both versions are recoverable
      // without returning the whole project.
      const sources: Record<string, SourceText> = Object.create(null) as Record<string, SourceText>;
      for (const path of Object.keys(saveRequest.sources)) {
        const source = outcome.snapshot.sources[path];
        if (source) sources[path] = source;
      }
      json(response, 409, {
        code: "STUDIO_REVISION_CONFLICT",
        message: "The model changed on disk since this draft was opened. Both versions are still available.",
        revision: outcome.snapshot.revision,
        sources,
      });
      return;
    }
    if (outcome.status === "invalid") {
      json(response, 422, {
        code: "STUDIO_SAVE_INVALID",
        message: "The edited model does not compile; nothing was written.",
        revision: outcome.snapshot.revision,
        diagnostics: outcome.diagnostics.slice(0, 100),
      });
      return;
    }
    const result = await inspectProject(outcome.snapshot);
    json(response, 200, {
      ...assemble(outcome.snapshot, prefix, result, writable),
      revision: outcome.snapshot.revision,
      saved: outcome.saved,
    });
  };
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
    (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      void (async () => {
        const hostCount = request.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "host").length;
        if (hostCount !== 1 || request.headers.host !== origin.slice(7)) throw new StudioError("STUDIO_FORBIDDEN");
        if (await serveAsset(request, response, prefix, origin)) return;
        if (request.headers.origin !== undefined && request.headers.origin !== origin)
          throw new StudioError("STUDIO_FORBIDDEN");
        if (request.headers["sec-fetch-site"] === "cross-site") throw new StudioError("STUDIO_FORBIDDEN");
        const authorization = request.headers.authorization ?? "";
        const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw new StudioError("STUDIO_FORBIDDEN");
        if (request.url === `${prefix}/api/draft`) {
          if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            response.setHeader("Connection", "close");
            json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts POST for drafts only." });
            return;
          }
          const contentType = request.headers["content-type"] ?? "";
          if (!contentType.startsWith("application/json")) throw new StudioError("STUDIO_DRAFT_REQUEST");
          await handleDraft(request, response);
          return;
        }
        if (request.url === `${prefix}/api/export`) {
          if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            response.setHeader("Connection", "close");
            json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts GET for export only." });
            return;
          }
          const snapshot = await project.read();
          json(response, 200, exportBundle(snapshot));
          return;
        }
        if (request.url === `${prefix}/api/import`) {
          if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            response.setHeader("Connection", "close");
            json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts POST for import only." });
            return;
          }
          const body = await readScenarioBody(request);
          let value: unknown;
          try { value = JSON.parse(body); } catch { throw new StudioError("STUDIO_DRAFT_REQUEST"); }
          const imported = parseImportedBundle(value);
          json(response, 200, { entry: imported.entry, sources: imported.sources, imported: true });
          return;
        }
        if (request.url === `${prefix}/api/scenario`) {
          if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            response.setHeader("Connection", "close");
            json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts POST for scenarios only." });
            return;
          }
          const contentType = request.headers["content-type"] ?? "";
          if (!contentType.startsWith("application/json")) throw new StudioError("STUDIO_DRAFT_REQUEST");
          const raw = await readScenarioBody(request);
          let value: unknown;
          try { value = JSON.parse(raw); } catch { throw new StudioError("STUDIO_DRAFT_REQUEST"); }
          if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StudioError("STUDIO_DRAFT_REQUEST");
          const candidate = value as Record<string, unknown>;
          const source = candidate.source;
          const entity = candidate.entity;
          const operation = candidate.operation;
          const record = candidate.record;
          if (typeof source !== "string" || source.length < 1 || source.length > 512 * 1024) throw new StudioError("STUDIO_DRAFT_REQUEST");
          if (typeof entity !== "string" || entity.length < 1 || entity.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
          if (typeof operation !== "string" || operation.length < 1 || operation.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
          if (typeof record !== "object" || record === null || Array.isArray(record)) throw new StudioError("STUDIO_DRAFT_REQUEST");
          const actor = candidate.actor;
          if (actor !== undefined && (typeof actor !== "object" || actor === null || Array.isArray(actor))) throw new StudioError("STUDIO_DRAFT_REQUEST");
          const now = candidate.now;
          if (now !== undefined && typeof now !== "string") throw new StudioError("STUDIO_DRAFT_REQUEST");
          json(response, 200, runScenario(source, entity, operation, record as Record<string, unknown>, actor as Record<string, unknown> | undefined, now as string | undefined));
          return;
        }
        if (request.url === `${prefix}/api/save`) {
          if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            response.setHeader("Connection", "close");
            json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts POST for saves only." });
            return;
          }
          if (options.writable !== true) {
            json(response, 501, {
              code: "STUDIO_SAVE_UNAVAILABLE",
              message: "Saving is not enabled for this Studio session.",
            });
            return;
          }
          const contentType = request.headers["content-type"] ?? "";
          if (!contentType.startsWith("application/json")) throw new StudioError("STUDIO_SAVE_REQUEST");
          await handleSave(request, response);
          return;
        }
        if (request.url !== `${prefix}/api/project`) throw new StudioError("STUDIO_NOT_FOUND");
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          response.setHeader("Connection", "close");
          json(response, 405, { code: "STUDIO_READ_ONLY", message: "Studio accepts read-only requests only." });
          return;
        }
        json(response, 200, await load());
      })().catch((error: unknown) => {
        const safe = error instanceof StudioError ? error : new StudioError("STUDIO_PROJECT_UNAVAILABLE");
        const status = safe.code === "STUDIO_FORBIDDEN" ? 403 : safe.code === "STUDIO_NOT_FOUND" ? 404 : 422;
        if (!response.headersSent) json(response, status, { code: safe.code, message: safe.message });
        else response.destroy();
      });
    },
  );
  server.maxConnections = 16;
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8080, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new StudioError("STUDIO_PROJECT_UNAVAILABLE");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    token,
    url: `${origin}${prefix}/#token=${encodeURIComponent(token)}`,
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
