import { describe, expect, it } from "vitest";
import { listStarters, renderStarter } from "../packages/cli/src/starters.js";
import { compile } from "../packages/compiler/src/index.js";
import { OFFICIAL_PACKS, STD_PACKAGE } from "../packages/std/src/index.js";
import {
  filterLogicPresetCatalog,
  filterStarterCatalog,
  logicPresetCatalog,
  matchesCatalogSearch,
  logicPresetUsage,
  previewStarterFiles,
  starterCatalog,
} from "../kitchen-sink/src/catalog.js";

describe("Kitchen Sink catalogs", () => {
  it("lists every CLI starter from its owning starter manifests", () => {
    const expected = listStarters().map(({ starter, description, layout, tags, files, directories, next }) => ({
      starter,
      description,
      layout,
      tags,
      files: files.map(({ from, to }) => ({ from, to })),
      ...(directories ? { directories } : {}),
      ...(next ? { next } : {}),
    }));

    expect(starterCatalog).toEqual(expected);
    expect(starterCatalog).toHaveLength(8);
  });

  it("exposes every standard and official-pack logic preset without copying definitions", () => {
    const expectedIds = [
      ...Object.keys(STD_PACKAGE.types ?? {}).map((name) => `std:${name}`),
      ...Object.keys(STD_PACKAGE.traits ?? {}).map((name) => `std:${name}`),
      ...Object.keys(STD_PACKAGE.templates ?? {}).map((name) => `std:${name}`),
      ...Object.keys(STD_PACKAGE.presets ?? {}),
      ...Object.values(OFFICIAL_PACKS).flatMap((pack) =>
        Object.keys(pack.templates ?? {}).map((name) => `${pack.package.slice("@kerangka/".length)}:${name}`)
      ),
    ];

    expect(logicPresetCatalog.map((preset) => preset.id)).toEqual(expectedIds);
    expect(logicPresetCatalog.find((preset) => preset.id === "std:approval")?.definition)
      .toBe(STD_PACKAGE.templates?.approval);
    expect(logicPresetCatalog.find((preset) => preset.id === "identity:member")?.definition)
      .toBe(OFFICIAL_PACKS["@kerangka/identity"]?.templates?.member);
  });

  it("searches catalog names, descriptions, tags, and identifiers case-insensitively", () => {
    expect(matchesCatalogSearch("  RBAC ", ["Admin console", "rbac", "approval"])).toBe(true);
    expect(matchesCatalogSearch("masterdetail", ["std:masterDetail", "View template"])).toBe(true);
    expect(matchesCatalogSearch("missing", ["Admin console", "approval"])).toBe(false);
    expect(matchesCatalogSearch("  ", ["anything"])).toBe(true);
  });

  it("uses the same filters for catalog cards and their result counts", () => {
    expect(filterStarterCatalog("contexts/billing").map((starter) => starter.starter)).toEqual(["commerce"]);
    expect(filterLogicPresetCatalog("approval").map((preset) => preset.id)).toEqual(["std:approval"]);
    expect(filterStarterCatalog("  ")).toHaveLength(starterCatalog.length);
  });

  it("previews the exact generated JSON files from every starter's source templates", () => {
    for (const starter of listStarters()) {
      expect(previewStarterFiles(starter), starter.starter).toEqual(renderStarter(starter, "my-app", "json"));
    }
  });

  it("provides a compilable model usage preview for every logic preset", () => {
    for (const preset of logicPresetCatalog) {
      const usage = logicPresetUsage(preset);
      expect(usage.trim(), preset.id).not.toBe("");
      if (preset.kind !== "lint preset") {
        expect(() => compile(JSON.parse(usage)), preset.id).not.toThrow();
      } else {
        expect(JSON.parse(usage)).toEqual({ lint: { extends: [preset.id] } });
      }
    }
  });
});
