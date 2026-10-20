import { describe, expect, it } from "vitest";
import { sampleRoute } from "../kitchen-sink/src/sample-route";

const ids = ["approval", "validation", "workflow"];

describe("ID-only sample URLs", () => {
  it("opens a declared sample from the query string", () => {
    expect(sampleRoute("https://example.invalid/kitchen-sink/?sample=workflow", ids)).toEqual({
      id: "workflow", path: "/kitchen-sink/?sample=workflow",
    });
  });

  it("defaults an unknown ID and removes unrelated query and fragment data", () => {
    expect(sampleRoute("https://example.invalid/?sample=__proto__&record=fixture#actor", ids)).toEqual({
      id: "approval", path: "/?sample=approval",
    });
  });

  it("serializes a selection without copying records or actors from the current URL", () => {
    expect(sampleRoute("https://example.invalid/app/index.html?actor=fixture#state", ids, "validation")).toEqual({
      id: "validation", path: "/app/index.html?sample=validation",
    });
  });

  it("does not accept an undeclared selection", () => {
    expect(sampleRoute("https://example.invalid/?sample=workflow", ids, "https://example.invalid")).toEqual({
      id: "approval", path: "/?sample=approval",
    });
  });

  it("keeps only the first declared sample parameter", () => {
    expect(sampleRoute("https://example.invalid/?sample=validation&sample=workflow", ids)).toEqual({
      id: "validation", path: "/?sample=validation",
    });
  });

  it("handles an empty manifest without inventing an ID", () => {
    expect(sampleRoute("https://example.invalid/app/?record=fixture", [])).toEqual({ id: "", path: "/app/" });
  });
});
