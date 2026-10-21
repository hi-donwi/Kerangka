import type { StudioDiagnostic } from "./contracts.js";

/**
 * A journey is a reference index, not a program.
 *
 * It names steps (an existing page or an existing Kerangka operation) and links that say
 * where a connection is realized (an event action in a UIDL document, a navigation, or a
 * plain annotation). It never carries an action, a guard, a role, a credential, or an
 * effect, because a second copy of behavior is a second source of truth. The UIDL
 * document owns the action; the Kerangka model owns the operation and its outcome.
 *
 * The structure is mirrored by `spec/studio/journey.schema.json`. The two must agree:
 * `packages/cli/test/studio-journey-contract.test.ts` runs one corpus through both.
 */

export const JOURNEY_KIND = "kerangka.studio.journey" as const;
export const JOURNEY_VERSION = "0.1" as const;
export const JOURNEY_MODE = "reference" as const;

export type JourneyStepKind = "page" | "operation";
export type JourneyLinkKind = "action" | "navigation" | "annotation";

export interface JourneyStep {
  id: string;
  kind: JourneyStepKind;
  /** The page id in the source bundle's application manifest. */
  page?: string;
  /** `Entity.action` or `Entity.transition` in the Kerangka model. */
  operation?: string;
  label?: string;
}

export interface JourneyLink {
  id: string;
  from: string;
  to: string;
  kind: JourneyLinkKind;
  /** A restricted JSON pointer into the source page's UIDL document. */
  pointer?: string;
  label?: string;
}

export interface JourneyDocument {
  kind: typeof JOURNEY_KIND;
  version: typeof JOURNEY_VERSION;
  mode: typeof JOURNEY_MODE;
  id: string;
  name: string;
  entry: string;
  steps: JourneyStep[];
  links: JourneyLink[];
}

export interface ParseResult {
  ok: boolean;
  journey?: JourneyDocument;
  diagnostics: StudioDiagnostic[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;
const POINTER_PATTERN = /^\/root(?:\/(?:[A-Za-z0-9_.\-]|~[01])+)*$/;
const UNSAFE_POINTER_SEGMENT = /(?:^|\/)(?:__proto__|constructor|prototype)(?:\/|$)/;

const MAX_STEPS = 100;
const MAX_LINKS = 500;
const MAX_POINTER_LENGTH = 512;

const RESERVED_IDS = new Set(["constructor", "prototype"]);

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

function pointerText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_POINTER_LENGTH &&
    POINTER_PATTERN.test(value) &&
    !UNSAFE_POINTER_SEGMENT.test(value)
  );
}

function operationName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && OPERATION_PATTERN.test(value);
}

function diagnostic(code: string, message: string, path: string, hint?: string): StudioDiagnostic {
  return { severity: "error", code, source: "journey", path, message, ...(hint ? { hint } : {}) };
}

function unexpectedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  code: string,
): StudioDiagnostic[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) =>
      diagnostic(
        code,
        `A journey does not define '${key}'.`,
        `${path}/${key}`,
        "A journey is an index over existing pages, operations, and actions.",
      ),
    );
}

/**
 * Parse and structurally validate a journey document.
 *
 * Structural acceptance is not semantic acceptance: a journey may still name a page or an
 * operation that does not exist, and `resolveJourney` reports that separately.
 */
export function parseJourney(value: unknown): ParseResult {
  const diagnostics: StudioDiagnostic[] = [];
  if (!plainObject(value)) {
    return {
      ok: false,
      diagnostics: [diagnostic("STUDIO_JOURNEY_SHAPE", "A journey is a JSON object.", "/")],
    };
  }

  diagnostics.push(
    ...unexpectedKeys(
      value,
      ["$schema", "kind", "version", "mode", "id", "name", "entry", "steps", "links"],
      "",
      "STUDIO_JOURNEY_UNKNOWN_FIELD",
    ),
  );

  if (value.kind !== JOURNEY_KIND)
    diagnostics.push(diagnostic("STUDIO_JOURNEY_KIND", `A journey declares kind '${JOURNEY_KIND}'.`, "/kind"));
  if (value.version !== JOURNEY_VERSION)
    diagnostics.push(
      diagnostic("STUDIO_JOURNEY_VERSION", `This runtime reads journey version '${JOURNEY_VERSION}'.`, "/version"),
    );
  if (value.mode !== JOURNEY_MODE)
    diagnostics.push(
      diagnostic(
        "STUDIO_JOURNEY_MODE",
        `This runtime reads reference journeys only.`,
        "/mode",
        "An executable journey needs its own specification, runtime, and conformance.",
      ),
    );
  if (!identifier(value.id)) diagnostics.push(diagnostic("STUDIO_JOURNEY_ID", "The journey id is not a safe identifier.", "/id"));
  if (typeof value.name !== "string" || value.name.length === 0 || value.name.length > 128)
    diagnostics.push(diagnostic("STUDIO_JOURNEY_NAME", "The journey needs a name of 1 to 128 characters.", "/name"));
  if (!identifier(value.entry))
    diagnostics.push(diagnostic("STUDIO_JOURNEY_ENTRY", "The entry is not a safe step identifier.", "/entry"));

  const steps: JourneyStep[] = [];
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > MAX_STEPS) {
    diagnostics.push(
      diagnostic("STUDIO_JOURNEY_STEPS", `A journey declares 1 to ${MAX_STEPS} steps.`, "/steps"),
    );
  } else {
    value.steps.forEach((raw, index) => {
      const path = `/steps/${index}`;
      if (!plainObject(raw)) {
        diagnostics.push(diagnostic("STUDIO_JOURNEY_STEP", "A step is a JSON object.", path));
        return;
      }
      if (!identifier(raw.id))
        diagnostics.push(diagnostic("STUDIO_JOURNEY_STEP_ID", "The step id is not a safe identifier.", `${path}/id`));
      if (raw.kind === "page") {
        diagnostics.push(
          ...unexpectedKeys(raw, ["id", "kind", "page", "label"], path, "STUDIO_JOURNEY_UNKNOWN_FIELD"),
        );
        if (!identifier(raw.page))
          diagnostics.push(diagnostic("STUDIO_JOURNEY_STEP_PAGE", "A page step names a page id.", `${path}/page`));
        steps.push({
          id: String(raw.id),
          kind: "page",
          page: String(raw.page),
          ...(typeof raw.label === "string" ? { label: raw.label } : {}),
        });
      } else if (raw.kind === "operation") {
        diagnostics.push(
          ...unexpectedKeys(raw, ["id", "kind", "operation", "label"], path, "STUDIO_JOURNEY_UNKNOWN_FIELD"),
        );
        if (!operationName(raw.operation))
          diagnostics.push(
            diagnostic(
              "STUDIO_JOURNEY_STEP_OPERATION",
              "An operation step names an `Entity.action` in the model.",
              `${path}/operation`,
            ),
          );
        steps.push({
          id: String(raw.id),
          kind: "operation",
          operation: String(raw.operation),
          ...(typeof raw.label === "string" ? { label: raw.label } : {}),
        });
      } else {
        diagnostics.push(
          ...unexpectedKeys(raw, ["id", "kind", "page", "operation", "label"], path, "STUDIO_JOURNEY_UNKNOWN_FIELD"),
        );
        diagnostics.push(
          diagnostic("STUDIO_JOURNEY_STEP_KIND", "A step is a page step or an operation step.", `${path}/kind`),
        );
      }
    });
  }

  const links: JourneyLink[] = [];
  if (!Array.isArray(value.links) || value.links.length > MAX_LINKS) {
    diagnostics.push(diagnostic("STUDIO_JOURNEY_LINKS", `A journey declares at most ${MAX_LINKS} links.`, "/links"));
  } else {
    value.links.forEach((raw, index) => {
      const path = `/links/${index}`;
      if (!plainObject(raw)) {
        diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK", "A link is a JSON object.", path));
        return;
      }
      diagnostics.push(
        ...unexpectedKeys(raw, ["id", "from", "to", "kind", "pointer", "label"], path, "STUDIO_JOURNEY_UNKNOWN_FIELD"),
      );
      if (!identifier(raw.id))
        diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK_ID", "The link id is not a safe identifier.", `${path}/id`));
      if (!identifier(raw.from))
        diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK_FROM", "A link names a source step.", `${path}/from`));
      if (!identifier(raw.to))
        diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK_TO", "A link names a target step.", `${path}/to`));
      if (raw.kind !== "action" && raw.kind !== "navigation" && raw.kind !== "annotation")
        diagnostics.push(
          diagnostic(
            "STUDIO_JOURNEY_LINK_KIND",
            "A link is an action link, a navigation link, or an annotation.",
            `${path}/kind`,
          ),
        );
      if (raw.pointer !== undefined && !pointerText(raw.pointer))
        diagnostics.push(
          diagnostic(
            "STUDIO_JOURNEY_LINK_POINTER",
            "A pointer addresses the live node tree of a page document.",
            `${path}/pointer`,
          ),
        );
      links.push({
        id: String(raw.id),
        from: String(raw.from),
        to: String(raw.to),
        kind: raw.kind as JourneyLinkKind,
        ...(typeof raw.pointer === "string" ? { pointer: raw.pointer } : {}),
        ...(typeof raw.label === "string" ? { label: raw.label } : {}),
      });
    });
  }

  const ok = diagnostics.every((item) => item.severity !== "error");
  return {
    ok,
    ...(ok ? { journey: { kind: JOURNEY_KIND, version: JOURNEY_VERSION, mode: JOURNEY_MODE, id: String(value.id), name: String(value.name), entry: String(value.entry), steps, links } } : {}),
    diagnostics,
  };
}

/** A page the journey may reference, with the UIDL document that owns its actions. */
export interface JourneyPageContext {
  id: string;
  /** The authored UIDL document. Absent for a recipe page, which has no stable tree. */
  document?: unknown;
}

export interface JourneyResolutionContext {
  pages: readonly JourneyPageContext[];
  /** `Entity.action` and `Entity.transition` names the model declares. */
  operations: readonly string[];
}

interface ResolvedPointer {
  ok: boolean;
  /** The node that carries the event, and the event name, when the pointer resolved. */
  nodeId?: string;
  event?: string;
  reason?: string;
}

/**
 * Resolve a pointer into the live node tree of a UIDL document.
 *
 * The accepted shape is `root`, then `children/<index>`, `slots/<name>/<index>`, or
 * `events/<name>/<index>`. A pointer that goes deeper addresses an action's internals
 * rather than something a person triggers, so it is refused: a journey link points at an
 * event action, not at a branch inside one.
 */
export function resolveJourneyPointer(document: unknown, pointer: string): ResolvedPointer {
  if (!plainObject(document))
    return { ok: false, reason: "The page has no readable UIDL document." };
  const segments = pointer.split("/").slice(1).map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments[0] !== "root") return { ok: false, reason: "A pointer starts at the document root." };

  let node: unknown = document.root;
  let index = 1;
  while (index < segments.length) {
    const kind = segments[index];
    const argument = segments[index + 1];
    if (node === undefined || node === null) return { ok: false, reason: "The pointer leaves the document tree." };
    if (!plainObject(node)) return { ok: false, reason: "The pointer leaves the document tree." };
    if (kind === "children") {
      if (argument === undefined || !/^\d+$/.test(argument))
        return { ok: false, reason: "A child index is required." };
      const children = node.children;
      if (!Array.isArray(children)) return { ok: false, reason: "The node has no children." };
      const child = children[Number(argument)];
      if (child === undefined) return { ok: false, reason: "The child index is outside the node." };
      node = child;
      index += 2;
      continue;
    }
    if (kind === "slots") {
      if (argument === undefined) return { ok: false, reason: "A slot name is required." };
      const slots = node.slots;
      if (!plainObject(slots)) return { ok: false, reason: "The node has no slots." };
      const slot = slots[argument];
      if (!Array.isArray(slot)) return { ok: false, reason: "The slot has no children." };
      const position = segments[index + 2];
      if (position === undefined || !/^\d+$/.test(position))
        return { ok: false, reason: "A slot child index is required." };
      node = slot[Number(position)];
      index += 3;
      continue;
    }
    if (kind === "events") {
      if (argument === undefined) return { ok: false, reason: "An event name is required." };
      const events = node.events;
      if (!plainObject(events)) return { ok: false, reason: "The node has no events." };
      const actions = events[argument];
      if (!Array.isArray(actions)) return { ok: false, reason: "The event has no action list." };
      const position = segments[index + 2];
      if (position === undefined || !/^\d+$/.test(position))
        return { ok: false, reason: "An action index is required." };
      if (index + 3 < segments.length)
        return { ok: false, reason: "A link points at an event action, not inside one." };
      const action = actions[Number(position)];
      if (action === undefined) return { ok: false, reason: "The action index is outside the event." };
      return { ok: true, nodeId: typeof node.id === "string" ? node.id : undefined, event: argument };
    }
    return { ok: false, reason: "A pointer walks children, slots, and events." };
  }
  return { ok: false, reason: "A pointer ends at an event action." };
}

/**
 * Resolve a journey against the pages and operations that actually exist.
 *
 * Every diagnostic names the journey path that caused it, so a designer can jump to the
 * exact step or link. Nothing here grants access: a journey never names a role, and a
 * resolved link only says which existing action a person triggers.
 */
export function resolveJourney(journey: JourneyDocument, context: JourneyResolutionContext): StudioDiagnostic[] {
  const diagnostics: StudioDiagnostic[] = [];
  const pages = new Map(context.pages.map((page) => [page.id, page]));
  const operations = new Set(context.operations);
  const steps = new Map(journey.steps.map((step) => [step.id, step]));

  if (!steps.has(journey.entry))
    diagnostics.push(
      diagnostic(
        "STUDIO_JOURNEY_ENTRY_UNKNOWN",
        `The entry '${journey.entry}' is not a step of this journey.`,
        "/entry",
      ),
    );

  for (const step of journey.steps) {
    if (step.kind === "page" && step.page && !pages.has(step.page))
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_PAGE_UNKNOWN",
          `The page '${step.page}' is not in the application manifest.`,
          `/steps/${step.id}`,
          "Add the page to the source bundle, or point the step at an existing page.",
        ),
      );
    if (step.kind === "operation" && step.operation && !operations.has(step.operation))
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_OPERATION_UNKNOWN",
          `The operation '${step.operation}' is not declared by the model.`,
          `/steps/${step.id}`,
          "A journey references an existing operation; it does not create one.",
        ),
      );
  }

  const claimed = new Map<string, string>();
  for (const link of journey.links) {
    const path = `/links/${link.id}`;
    const from = steps.get(link.from);
    const to = steps.get(link.to);
    if (!from) diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK_FROM_UNKNOWN", `The source step '${link.from}' does not exist.`, `${path}/from`));
    if (!to) diagnostics.push(diagnostic("STUDIO_JOURNEY_LINK_TO_UNKNOWN", `The target step '${link.to}' does not exist.`, `${path}/to`));

    if (link.kind === "annotation") continue;

    if (!link.pointer) {
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_LINK_POINTER_REQUIRED",
          `A ${link.kind} link names where the connection happens.`,
          `${path}/pointer`,
        ),
      );
      continue;
    }

    if (link.kind === "navigation" && to && to.kind !== "page")
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_LINK_NAVIGATION_TARGET",
          "A navigation link ends at a page step.",
          `${path}/to`,
        ),
      );

    if (!from || from.kind !== "page") {
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_LINK_SOURCE",
          "A link with a pointer starts at a page step.",
          `${path}/from`,
          "An operation step has no UIDL tree to point into.",
        ),
      );
      continue;
    }

    const page = pages.get(from.page ?? "");
    if (!page?.document) {
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_LINK_DOCUMENT",
          `The page '${from.page ?? ""}' has no authored UIDL document.`,
          `${path}/pointer`,
          "A recipe page is generated per request, so it has no stable action to point at.",
        ),
      );
      continue;
    }

    const resolved = resolveJourneyPointer(page.document, link.pointer);
    if (!resolved.ok) {
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_LINK_POINTER_UNRESOLVED",
          resolved.reason ?? "The pointer does not resolve.",
          `${path}/pointer`,
        ),
      );
      continue;
    }

    const key = `${from.page ?? ""}#${link.pointer}`;
    const existing = claimed.get(key);
    if (existing && existing !== link.to) {
      diagnostics.push(
        diagnostic(
          "STUDIO_JOURNEY_ACTION_CONFLICT",
          `The action at '${link.pointer}' already leads to '${existing}'.`,
          `${path}/pointer`,
          "One action has one meaning. Point the two links at different actions.",
        ),
      );
      continue;
    }
    claimed.set(key, link.to);
  }

  return diagnostics;
}

/**
 * What a link between two steps is allowed to be.
 *
 * A link says where a connection is realized, so its kind is not a label: it decides
 * what the two steps have to be, and whether the link has to name the action that
 * realizes it. An `action` link runs an operation, so it starts at a page that has the
 * action and ends at an operation. A `navigation` link moves to another page. An
 * `annotation` is a note, and it connects nothing.
 */
export interface JourneyLinkRule {
  kind: string;
  from: "page" | "operation" | "any";
  to: "page" | "operation" | "any";
  /** Whether the link has to name the action that realizes it. */
  pointer: "required" | "none";
  reason: string;
}

export const JOURNEY_LINK_RULES: readonly JourneyLinkRule[] = [
  {
    kind: "action",
    from: "page",
    to: "operation",
    pointer: "required",
    reason: "An action link starts at a page and runs an operation, so it names the action that runs it.",
  },
  {
    kind: "navigation",
    from: "page",
    to: "page",
    pointer: "required",
    reason: "A navigation link moves to another page, so it names the action that navigates.",
  },
  {
    kind: "annotation",
    from: "any",
    to: "any",
    pointer: "none",
    reason: "An annotation is a note. It connects nothing and runs nothing.",
  },
];

export function journeyLinkRule(kind: string): JourneyLinkRule | undefined {
  return JOURNEY_LINK_RULES.find((rule) => rule.kind === kind);
}

/** The problems of one link, given the kinds of the steps it joins. */
export function journeyLinkProblems(
  link: { id: string; kind: string; pointer?: string },
  from: JourneyStep | undefined,
  to: JourneyStep | undefined,
): string[] {
  const rule = journeyLinkRule(link.kind);
  if (!rule) return [`The link '${link.id}' has the kind '${link.kind}', which is not one a journey knows.`];
  const problems: string[] = [];
  if (rule.from !== "any" && from && from.kind !== rule.from) {
    problems.push(`A ${link.kind} link starts at a ${rule.from} step, and '${link.id}' starts at a ${from.kind} step.`);
  }
  if (rule.to !== "any" && to && to.kind !== rule.to) {
    problems.push(`A ${link.kind} link ends at a ${rule.to} step, and '${link.id}' ends at a ${to.kind} step.`);
  }
  if (rule.pointer === "required" && !link.pointer) {
    problems.push(rule.reason);
  }
  return problems;
}

/**
 * The problems inside a journey that need no project to find.
 *
 * The entry has to be a step of the journey, and a link has to join two steps that
 * exist. These hold whatever the project contains, so an edit that breaks one of them
 * breaks the journey itself.
 */
export function journeyInternalErrors(journey: JourneyDocument): string[] {
  const errors: string[] = [];
  const steps = new Map(journey.steps.map((step) => [step.id, step]));
  if (!steps.has(journey.entry)) errors.push(`The entry '${journey.entry}' is not a step of this journey.`);
  for (const link of journey.links) {
    if (!steps.has(link.from)) errors.push(`The link '${link.id}' starts at '${link.from}', which is not a step.`);
    if (!steps.has(link.to)) errors.push(`The link '${link.id}' ends at '${link.to}', which is not a step.`);
    if (!steps.has(link.from) || !steps.has(link.to)) continue;
    errors.push(
      ...journeyLinkProblems(link, steps.get(link.from), steps.get(link.to)),
    );
  }
  return errors;
}

/**
 * Report behavior that two journeys claim at once.
 *
 * The same operation reachable from two journeys, or the same event action leading to two
 * different targets, is a second source of truth. This is checked across journeys because
 * no single journey can see the conflict.
 */
export function assertNoDualOwnership(
  journeys: readonly JourneyDocument[],
  context: JourneyResolutionContext,
): StudioDiagnostic[] {
  const diagnostics: StudioDiagnostic[] = [];
  const pages = new Map(context.pages.map((page) => [page.id, page]));
  const operationOwners = new Map<string, string>();
  const actionOwners = new Map<string, string>();

  for (const journey of journeys) {
    for (const step of journey.steps) {
      if (step.kind !== "operation" || !step.operation) continue;
      const owner = operationOwners.get(step.operation);
      if (owner && owner !== journey.id) {
        diagnostics.push(
          diagnostic(
            "STUDIO_JOURNEY_OPERATION_CONFLICT",
            `The operation '${step.operation}' is already claimed by journey '${owner}'.`,
            `/journeys/${journey.id}/steps/${step.id}`,
            "An operation belongs to one journey. Model the shared step as a page reference.",
          ),
        );
        continue;
      }
      operationOwners.set(step.operation, journey.id);
    }

    for (const link of journey.links) {
      if (link.kind === "annotation" || !link.pointer) continue;
      const from = journey.steps.find((step) => step.id === link.from);
      if (!from || from.kind !== "page" || !from.page) continue;
      const page = pages.get(from.page);
      if (!page?.document) continue;
      const resolved = resolveJourneyPointer(page.document, link.pointer);
      if (!resolved.ok) continue;
      const key = `${from.page}#${link.pointer}#${link.to}`;
      const owner = actionOwners.get(key);
      if (owner && owner !== journey.id) {
        diagnostics.push(
          diagnostic(
            "STUDIO_JOURNEY_ACTION_CONFLICT",
            `The action at '${link.pointer}' is already claimed by journey '${owner}'.`,
            `/journeys/${journey.id}/links/${link.id}`,
          ),
        );
        continue;
      }
      actionOwners.set(key, journey.id);
    }
  }

  return diagnostics;
}
