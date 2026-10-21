import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  assertNoDualOwnership,
  parseJourney,
  resolveJourney,
  resolveJourneyPointer,
  type JourneyDocument,
} from "../src/index.js";

const schema = JSON.parse(
  readFileSync(new URL("../../../spec/studio/journey.schema.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

const valid = {
  kind: "kerangka.studio.journey",
  version: "0.1",
  mode: "reference",
  id: "request-approval",
  name: "Synthetic request approval",
  entry: "requests",
  steps: [
    { id: "requests", kind: "page", page: "requests" },
    { id: "submit", kind: "operation", operation: "Request.submit" },
  ],
  links: [
    { id: "create", from: "requests", to: "submit", kind: "action", pointer: "/root/children/0/events/onClick/0" },
  ],
};

const document = {
  version: "1.0.0",
  id: "requests",
  name: "Requests",
  root: {
    id: "root",
    type: "Container",
    children: [
      {
        id: "new-request",
        type: "Button",
        events: { onClick: [{ mutate: { operation: "transition", collection: "Request", transition: "submit" } }] },
      },
    ],
  },
};

const pages = [
  { id: "requests", document },
  { id: "help", document: { ...document, id: "help" } },
];
const operations = ["Request.submit", "Request.approve"];

describe("Studio reference journey contract", () => {
  it("publishes an offline versioned schema identifier", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://kerangka.dev/schema/studio/v0.1/journey.schema.json");
  });

  it("accepts a reference journey without changing it", () => {
    const before = structuredClone(valid);
    expect(validate(valid), ajv.errorsText(validate.errors)).toBe(true);
    expect(valid).toEqual(before);
  });

  it("parses the same journey the schema accepts", () => {
    const parsed = parseJourney(valid);
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.journey?.steps).toHaveLength(2);
    expect(parsed.journey?.links[0]?.pointer).toBe("/root/children/0/events/onClick/0");
  });

  it.each([
    ["unknown version", { ...valid, version: "0.2" }],
    ["executable mode", { ...valid, mode: "execute" }],
    ["inline business actions", { ...valid, actions: [{ run: "Request.approve" }] }],
    ["role grants", { ...valid, roles: ["admin"] }],
    ["secret authority", { ...valid, credentials: {} }],
    ["external entry", { ...valid, entry: "https://example.invalid" }],
    ["no steps", { ...valid, steps: [] }],
    ["unknown step field", { ...valid, steps: [{ ...valid.steps[0], execute: "Request.approve" }] }],
    ["inline link behavior", { ...valid, links: [{ ...valid.links[0], mutate: {} }] }],
    ["unbounded nodes", { ...valid, steps: Array.from({ length: 101 }, () => valid.steps[0]) }],
    ["unbounded edges", { ...valid, links: Array.from({ length: 501 }, () => valid.links[0]) }],
  ])("rejects %s", (_name, journey) => {
    expect(validate(journey)).toBe(false);
    expect(parseJourney(journey).ok).toBe(false);
  });

  it.each(["constructor", "prototype", "__proto__", "Invalid", "a".repeat(65)])("rejects unsafe identifier %s", (id) => {
    expect(validate({ ...valid, id })).toBe(false);
    expect(parseJourney({ ...valid, id }).ok).toBe(false);
  });

  it.each([
    "root/events/onClick/0",
    "/definitions/button/events/onClick/0",
    "/root/events/onClick/~2",
    "/root/__proto__/events/onClick/0",
    "/root/constructor/events/onClick/0",
    "/root//events/onClick/0",
    `/root/${"a".repeat(1024)}`,
  ])("rejects unsafe or unsupported action pointer %s", (pointer) => {
    expect(validate({ ...valid, links: [{ ...valid.links[0], pointer }] })).toBe(false);
    expect(parseJourney({ ...valid, links: [{ ...valid.links[0], pointer }] }).ok).toBe(false);
  });

  it("accepts escaped slot and event keys", () => {
    const pointer = "/root/slots/main~1content/0/events/on~0Click/0";
    expect(validate({ ...valid, links: [{ ...valid.links[0], pointer }] })).toBe(true);
    expect(parseJourney({ ...valid, links: [{ ...valid.links[0], pointer }] }).ok).toBe(true);
  });

  it("leaves duplicate ids and dangling references for semantic resolution", () => {
    expect(validate({ ...valid, entry: "missing", steps: [valid.steps[0], valid.steps[0]] })).toBe(true);
    expect(parseJourney({ ...valid, entry: "missing", steps: [valid.steps[0], valid.steps[0]] }).ok).toBe(true);
  });

  it("agrees with the schema on every corpus case", () => {
    const corpus = [
      valid,
      { ...valid, version: "0.2" },
      { ...valid, mode: "execute" },
      { ...valid, steps: [] },
      { ...valid, links: [{ ...valid.links[0], pointer: "/root//events" }] },
      { ...valid, steps: [{ id: "requests", kind: "page", page: "requests", extra: 1 }] },
      { ...valid, steps: [{ id: "submit", kind: "operation", operation: "Request.submit" }] },
      { ...valid, steps: [{ id: "submit", kind: "operation", operation: "not-an-operation" }] },
    ];
    for (const journey of corpus) {
      expect(parseJourney(journey).ok, JSON.stringify(journey)).toBe(validate(journey));
    }
  });
});

describe("Studio journey resolution", () => {
  const journey = parseJourney(valid).journey as JourneyDocument;

  it("resolves a journey whose pages and operations exist", () => {
    expect(resolveJourney(journey, { pages, operations })).toEqual([]);
  });

  it("reports an entry, page, and operation that do not exist", () => {
    const broken = parseJourney({
      ...valid,
      entry: "nowhere",
      steps: [
        { id: "requests", kind: "page", page: "missing-page" },
        { id: "submit", kind: "operation", operation: "Request.missing" },
      ],
    }).journey as JourneyDocument;
    const codes = resolveJourney(broken, { pages, operations }).map((item) => item.code);
    expect(codes).toContain("STUDIO_JOURNEY_ENTRY_UNKNOWN");
    expect(codes).toContain("STUDIO_JOURNEY_PAGE_UNKNOWN");
    expect(codes).toContain("STUDIO_JOURNEY_OPERATION_UNKNOWN");
  });

  it("reports a link that names a step that does not exist", () => {
    const broken = parseJourney({
      ...valid,
      links: [{ id: "create", from: "requests", to: "nowhere", kind: "action", pointer: "/root/children/0/events/onClick/0" }],
    }).journey as JourneyDocument;
    expect(resolveJourney(broken, { pages, operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_LINK_TO_UNKNOWN",
    );
  });

  it("requires a pointer on an action link", () => {
    const broken = parseJourney({
      ...valid,
      links: [{ id: "create", from: "requests", to: "submit", kind: "action" }],
    }).journey as JourneyDocument;
    expect(resolveJourney(broken, { pages, operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_LINK_POINTER_REQUIRED",
    );
  });

  it("reports a pointer that does not resolve in the page document", () => {
    const broken = parseJourney({
      ...valid,
      links: [{ id: "create", from: "requests", to: "submit", kind: "action", pointer: "/root/children/9/events/onClick/0" }],
    }).journey as JourneyDocument;
    expect(resolveJourney(broken, { pages, operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_LINK_POINTER_UNRESOLVED",
    );
  });

  it("reports a pointer that walks inside an action instead of naming one", () => {
    const broken = parseJourney({
      ...valid,
      links: [
        {
          id: "create",
          from: "requests",
          to: "submit",
          kind: "action",
          pointer: "/root/children/0/events/onClick/0/mutate/transition",
        },
      ],
    }).journey as JourneyDocument;
    expect(resolveJourney(broken, { pages, operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_LINK_POINTER_UNRESOLVED",
    );
  });

  it("reports a page with no authored document", () => {
    const broken = parseJourney({
      ...valid,
      steps: [{ id: "requests", kind: "page", page: "generated" }],
      links: [{ id: "create", from: "requests", to: "submit", kind: "action", pointer: "/root/children/0/events/onClick/0" }],
    }).journey as JourneyDocument;
    expect(resolveJourney(broken, { pages: [{ id: "generated" }], operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_LINK_DOCUMENT",
    );
  });

  it("refuses to let one action lead to two different targets", () => {
    const conflicting = parseJourney({
      ...valid,
      steps: [
        { id: "requests", kind: "page", page: "requests" },
        { id: "submit", kind: "operation", operation: "Request.submit" },
        { id: "approve", kind: "operation", operation: "Request.approve" },
      ],
      links: [
        { id: "create", from: "requests", to: "submit", kind: "action", pointer: "/root/children/0/events/onClick/0" },
        { id: "other", from: "requests", to: "approve", kind: "action", pointer: "/root/children/0/events/onClick/0" },
      ],
    }).journey as JourneyDocument;
    expect(resolveJourney(conflicting, { pages, operations }).map((item) => item.code)).toContain(
      "STUDIO_JOURNEY_ACTION_CONFLICT",
    );
  });

  it("reports one operation claimed by two journeys", () => {
    const other = parseJourney({ ...valid, id: "other-journey" }).journey as JourneyDocument;
    const codes = assertNoDualOwnership([journey, other], { pages, operations }).map((item) => item.code);
    expect(codes).toContain("STUDIO_JOURNEY_OPERATION_CONFLICT");
  });
});

describe("Studio journey pointer resolution", () => {
  it("resolves an event action and names its node and event", () => {
    const resolved = resolveJourneyPointer(document, "/root/children/0/events/onClick/0");
    expect(resolved.ok).toBe(true);
    expect(resolved.nodeId).toBe("new-request");
    expect(resolved.event).toBe("onClick");
  });

  it.each([
    ["/root", "A pointer ends at an event action."],
    ["/root/children/0", "A pointer ends at an event action."],
    ["/root/children/9/events/onClick/0", "The child index is outside the node."],
    ["/root/children/0/events", "An event name is required."],
    ["/root/children/0/events/onClick/5", "The action index is outside the event."],
    ["/root/children/0/props/label", "A pointer walks children, slots, and events."],
  ])("refuses %s", (pointer, reason) => {
    const resolved = resolveJourneyPointer(document, pointer);
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe(reason);
  });
});
