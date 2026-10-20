import { describe, expect, it } from "vitest";
import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";
import { canRedo, canUndo, currentStep, openHistory, pushHistory, redoHistory, undoHistory, unsavedHistory } from "./draft-history";

function response(revision: string): StudioResponse {
  return {
    bundle: {
      kind: "kerangka.studio.source",
      version: "0.1",
      revision,
      entry: "app.kerangka.json",
      sources: { "app.kerangka.json": { format: "json", text: revision } },
      application: { pages: {}, routes: [], preview: { profile: "read", data: "synthetic" } },
    },
    excluded: 0,
    diagnostics: [],
    inspection: {
      title: revision,
      entities: [],
      screens: [],
      roles: [],
      synthetic: {},
      outputs: { openapi: "", postgres: "", sqlite: "" },
    },
  } as unknown as StudioResponse;
}

describe("draft history", () => {
  it("shares visual and source steps and restores the selection", () => {
    const opened = openHistory(response("disk"), { kind: "entity", id: "Request" });
    const visual = pushHistory(opened, {
      label: "addEntityField Request.note",
      selection: { kind: "entity", id: "Request" },
      response: response("visual"),
    });
    const source = pushHistory(visual, {
      label: "setSource app.kerangka.json",
      selection: { kind: "source", id: "app.kerangka.json" },
      response: response("source"),
    });
    expect(unsavedHistory(source)).toBe(true);
    expect(currentStep(source).label).toBe("setSource app.kerangka.json");
    const undone = undoHistory(source);
    expect(currentStep(undone).selection).toEqual({ kind: "entity", id: "Request" });
    expect(currentStep(undone).response.bundle.revision).toBe("visual");
    const redone = redoHistory(undone);
    expect(currentStep(redone).selection?.kind).toBe("source");
    const branched = pushHistory(undone, {
      label: "addEntityField Request.extra",
      selection: { kind: "entity", id: "Request" },
      response: response("extra"),
    });
    expect(canRedo(branched)).toBe(false);
    expect(canUndo(branched)).toBe(true);
  });

  it("treats the opened snapshot as saved", () => {
    const opened = openHistory(response("disk"), null);
    expect(unsavedHistory(opened)).toBe(false);
    expect(canUndo(opened)).toBe(false);
    expect(undoHistory(opened)).toBe(opened);
  });
});
