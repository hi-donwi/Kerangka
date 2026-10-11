import { describe, expect, it } from "vitest";
import { decorateRowRoutes } from "../src/routes.js";

describe("decorateRowRoutes", () => {
  it("fills route placeholders from the row's own fields", () => {
    const rows = decorateRowRoutes([{ id: "INV-1" }, { id: "INV 2" }], "/invoice/:id");
    expect(rows).toEqual([
      { id: "INV-1", route: "/invoice/INV-1" },
      { id: "INV 2", route: "/invoice/INV%202" },
    ]);
  });

  it("leaves a placeholder empty when the field is missing", () => {
    expect(decorateRowRoutes([{ code: "A" }], "/thing/:id")).toEqual([{ code: "A", route: "/thing/" }]);
  });

  it("passes a placeholder-free template through unchanged", () => {
    expect(decorateRowRoutes([{ id: "X" }], "/report")).toEqual([{ id: "X", route: "/report" }]);
  });

  it("does not mutate the source rows", () => {
    const source = [{ id: "INV-1" }];
    decorateRowRoutes(source, "/invoice/:id");
    expect(source).toEqual([{ id: "INV-1" }]);
  });
});
