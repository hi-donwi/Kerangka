import { describe, expect, it } from "vitest";
import manifest from "../samples/manifest.json";
import type { ManifestEntry } from "../kitchen-sink/src/types";

const entries = manifest as ManifestEntry[];

describe("Kitchen Sink preview examples", () => {
  it("gives every runnable sample at least three described scenario variants", () => {
    for (const sample of entries) {
      expect(sample.inputs.length, sample.id).toBeGreaterThanOrEqual(3);
      for (const input of sample.inputs) {
        expect(input.description?.trim(), `${sample.id}/${input.name} needs an explanation`).toBeTruthy();
      }
    }
  });

  it("pairs each scenario with one declared engine expectation", () => {
    for (const sample of entries) {
      expect(sample.expected.outcomes.map((outcome) => outcome.input).sort()).toEqual(
        sample.inputs.map((input) => input.name).sort(),
      );
    }
  });
});
