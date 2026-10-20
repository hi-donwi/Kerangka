import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { applyDraftOperations, type DraftOperation, type SourceSnapshot, sourceRevision } from "../src/index.js";

const model = `{
  "kerangka": "0.1",
  "app": "leave-request",
  "entities": {
    "LeaveRequest": {
      "fields": {
        "employeeId": "string!",
        "reason": "string"
      }
    }
  }
}
`;

const entry = "leave-request.kerangka.json";

function snapshot(text = model, format: "json" | "yaml" = "json"): SourceSnapshot {
  const sources = { [entry]: { format, text } };
  return { entry, revision: sourceRevision(sources), sources, excluded: 0 };
}

const addField = (field: string, definition: string | Record<string, unknown>): DraftOperation => ({
  op: "addEntityField",
  entity: "LeaveRequest",
  field,
  definition,
});

describe("revisioned draft operations", () => {
  it("applies an add-field operation at the expected revision and preserves other bytes", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [addField("status", "enum(draft, submitted) = draft")],
    });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.sources[entry]!.text).toBe(`{
  "kerangka": "0.1",
  "app": "leave-request",
  "entities": {
    "LeaveRequest": {
      "fields": {
        "employeeId": "string!",
        "reason": "string",
        "status": "enum(draft, submitted) = draft"
      }
    }
  }
}
`);
    expect(result.revision).toBe(sourceRevision(result.sources));
    expect(result.revision).not.toBe(source.revision);
    expect(result.applied).toEqual(["addEntityField LeaveRequest.status"]);
  });

  it("does not mutate the snapshot it was given", () => {
    const source = snapshot();
    applyDraftOperations(source, { expectedRevision: source.revision, operations: [addField("status", "string")] });
    expect(source.sources[entry]!.text).toBe(model);
    expect(source.revision).toBe(sourceRevision(source.sources));
  });

  it("rejects a stale expected revision and returns the unchanged sources", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: "sha256:stale",
      operations: [addField("status", "string")],
    });
    expect(result.sources[entry]!.text).toBe(model);
    expect(result.revision).toBe(source.revision);
    expect(result.applied).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_REVISION_CONFLICT")).toBe(true);
  });

  it("refuses to write a YAML source without changing it", () => {
    const text = "kerangka: '0.1'\napp: leave-request\n";
    const source = snapshot(text, "yaml");
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [addField("status", "string")],
    });
    expect(result.sources[entry]!.text).toBe(text);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_WRITE_UNSUPPORTED")).toBe(true);
  });

  it("reports an unknown entity and leaves the source unchanged", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [{ op: "addEntityField", entity: "Missing", field: "status", definition: "string" }],
    });
    expect(result.sources[entry]!.text).toBe(model);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_OPERATION_TARGET")).toBe(true);
  });

  it("rejects adding a field that already exists", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [addField("reason", "string")],
    });
    expect(result.sources[entry]!.text).toBe(model);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_FIELD_EXISTS")).toBe(true);
  });

  it("rejects an unsupported field name", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [{ op: "addEntityField", entity: "LeaveRequest", field: "__proto__", definition: "string" }],
    });
    expect(result.sources[entry]!.text).toBe(model);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_FIELD_NAME")).toBe(true);
  });

  it("rejects an unknown operation kind", () => {
    const source = snapshot();
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [{ op: "deleteEntity", entity: "LeaveRequest" } as unknown as DraftOperation],
    });
    expect(result.sources[entry]!.text).toBe(model);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_OPERATION_UNSUPPORTED")).toBe(true);
  });

  it("returns validator diagnostics for an invalid edit while keeping the draft", () => {
    const source = snapshot();
    const result = applyDraftOperations(
      source,
      { expectedRevision: source.revision, operations: [addField("status", "nope")] },
      {
        validate: (file, text) => [
          { severity: "error", code: "MODEL_INVALID", source: file, message: `invalid: ${text.length > 0}" }`.slice(0, 0) || "synthetic" },
        ],
      },
    );
    expect(result.sources[entry]!.text).not.toBe(model);
    expect(result.diagnostics.some((item) => item.code === "MODEL_INVALID")).toBe(true);
  });

  it("keeps KIR derived: only the added field differs after recompiling", () => {
    const source = snapshot();
    const before = compile(model);
    const result = applyDraftOperations(source, {
      expectedRevision: source.revision,
      operations: [addField("status", "string")],
    });
    const after = compile(result.sources[entry]!.text);
    const beforeFields = Object.keys(before.entities.LeaveRequest!.fields);
    const afterFields = Object.keys(after.entities.LeaveRequest!.fields);
    expect(afterFields).toEqual([...beforeFields, "status"]);
    expect(after.entities.LeaveRequest!.fields.employeeId).toEqual(before.entities.LeaveRequest!.fields.employeeId);
  });
});
