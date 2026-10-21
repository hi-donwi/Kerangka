import { describe, expect, it } from "vitest";
import { applyDraftOperations, type DraftOperation, type SourceSnapshot, sourceRevision } from "../src/index.js";

/**
 * Editing a journey in the source.
 *
 * A journey file is the author's document, so an edit changes one step or one link and
 * leaves every other byte alone. An edit that would break the journey is refused, and
 * the file keeps what the author wrote.
 */

const journey = {
  kind: "kerangka.studio.journey",
  version: "0.1",
  mode: "reference",
  id: "request-approval",
  name: "Synthetic request approval",
  entry: "help",
  steps: [
    { id: "help", kind: "page", page: "help" },
    { id: "submit", kind: "operation", operation: "Request.submit" },
    { id: "approve", kind: "operation", operation: "Request.approve" },
  ],
  links: [
    { id: "send", from: "help", to: "submit", kind: "action", pointer: "/root/children/1/events/onClick/0" },
  ],
};

const text = `${JSON.stringify(journey, null, 2)}\n`;

function snapshot(): SourceSnapshot {
  const sources = {
    "app.kerangka.json": { format: "json" as const, text: '{"kerangka":"0.1","app":"probe"}' },
    "approval.journey.json": { format: "json" as const, text },
  };
  return { entry: "app.kerangka.json", revision: sourceRevision(sources), sources, excluded: 0 };
}

function apply(operations: DraftOperation[]) {
  const before = snapshot();
  const result = applyDraftOperations(before, { expectedRevision: before.revision, operations });
  return { result, journey: result.sources["approval.journey.json"]?.text ?? "" };
}

describe("journey draft operations", () => {
  it("adds a step and keeps the rest of the file as it was", () => {
    const { result, journey: edited } = apply([
      { op: "journeyAddStep", journey: "approval.journey.json", step: { id: "review", kind: "operation", operation: "Request.review" } },
    ]);

    expect(result.applied).toEqual(["journeyAddStep approval.journey.json"]);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const parsed = JSON.parse(edited);
    expect(parsed.steps).toHaveLength(4);
    expect(parsed.steps[3]).toEqual({ id: "review", kind: "operation", operation: "Request.review" });
    // The bytes the author wrote are still there.
    expect(edited).toContain('"name": "Synthetic request approval"');
  });

  it("removes a link", () => {
    const { result, journey: edited } = apply([{ op: "journeyRemoveLink", journey: "approval.journey.json", link: "send" }]);
    expect(result.applied).toEqual(["journeyRemoveLink approval.journey.json"]);
    expect(JSON.parse(edited).links).toEqual([]);
  });

  it("removes a step that nothing links to", () => {
    const { journey: edited } = apply([{ op: "journeyRemoveStep", journey: "approval.journey.json", step: "approve" }]);
    const parsed = JSON.parse(edited);
    expect(parsed.steps.map((step: { id: string }) => step.id)).toEqual(["help", "submit"]);
  });

  it("refuses to remove a step that a link still points at", () => {
    const { result, journey: edited } = apply([
      { op: "journeyRemoveStep", journey: "approval.journey.json", step: "submit" },
    ]);
    expect(result.applied).toEqual([]);
    expect(edited).toBe(text);
  });

  it("refuses an edit that would break the journey, and leaves the file alone", () => {
    const { result, journey: edited } = apply([
      { op: "journeyRemoveStep", journey: "approval.journey.json", step: "help" },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(edited).toBe(text);
  });

  it("refuses a step that is already there", () => {
    const { result, journey: edited } = apply([
      { op: "journeyAddStep", journey: "approval.journey.json", step: { id: "help", kind: "page", page: "help" } },
    ]);
    expect(result.applied).toEqual([]);
    expect(edited).toBe(text);
  });

  it("refuses an entry that is not a step", () => {
    const { result, journey: edited } = apply([
      { op: "journeyAddStep", journey: "approval.journey.json", step: { id: "review", kind: "operation" } },
      { op: "journeyRemoveStep", journey: "approval.journey.json", step: "help" },
    ]);
    expect(result.applied).toEqual([]);
    expect(edited).toBe(text);
  });

  it("refuses a journey file that is not part of the project", () => {
    const { result } = apply([
      { op: "journeyAddStep", journey: "missing.journey.json", step: { id: "approve", kind: "operation" } },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_OPERATION_TARGET")).toBe(true);
  });
});
