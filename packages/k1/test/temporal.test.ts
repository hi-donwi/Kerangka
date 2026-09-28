import { describe, expect, it } from "vitest";
import {
  parseDuration,
  addDuration,
  addMonthsClamped,
  addDays,
  diffDays,
  today,
  nowInstant,
  getNextCronRun,
  evalExpression,
} from "../src/index.js";

describe("Temporal Types, ISO 8601 Duration Parser & Calendar Arithmetic", () => {
  describe("parseDuration", () => {
    it("parses valid ISO 8601 duration components", () => {
      const d1 = parseDuration("P1Y2M3DT4H5M6S");
      expect(d1.years).toBe(1);
      expect(d1.months).toBe(2);
      expect(d1.days).toBe(3);
      expect(d1.hours).toBe(4);
      expect(d1.minutes).toBe(5);
      expect(d1.seconds).toBe(6);
      expect(d1.isNegative).toBe(false);

      const d2 = parseDuration("P3D");
      expect(d2.days).toBe(3);
      expect(d2.hours).toBe(0);

      const d3 = parseDuration("PT4H");
      expect(d3.hours).toBe(4);

      const d4 = parseDuration("P2W");
      expect(d4.weeks).toBe(2);
    });

    it("parses backward-compatible shorthand durations", () => {
      expect(parseDuration("3d").days).toBe(3);
      expect(parseDuration("4h").hours).toBe(4);
      expect(parseDuration("30m").minutes).toBe(30);
      expect(parseDuration("45s").seconds).toBe(45);
    });

    it("parses negative durations", () => {
      const d = parseDuration("-P1D");
      expect(d.days).toBe(1);
      expect(d.isNegative).toBe(true);

      const dShort = parseDuration("-5h");
      expect(dShort.hours).toBe(5);
      expect(dShort.isNegative).toBe(true);
    });

    it("throws on invalid durations", () => {
      expect(() => parseDuration("")).toThrow();
      expect(() => parseDuration("invalid")).toThrow();
      expect(() => parseDuration("P")).toThrow();
    });
  });

  describe("Month Clamping Semantics (spec/semantics/temporal.md §4.2)", () => {
    it("clamps 2026-01-31 + 1 month to 2026-02-28", () => {
      const base = new Date("2026-01-31T00:00:00.000Z");
      const result = addMonthsClamped(base, 1);
      expect(result.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    });

    it("clamps 2024-01-31 + 1 month to 2024-02-29 in a leap year", () => {
      const base = new Date("2024-01-31T00:00:00.000Z");
      const result = addMonthsClamped(base, 1);
      expect(result.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    });

    it("clamps 2026-03-31 + 1 month to 2026-04-30", () => {
      const base = new Date("2026-03-31T00:00:00.000Z");
      const result = addMonthsClamped(base, 1);
      expect(result.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    });

    it("clamps 2024-02-29 + 1 year to 2025-02-28", () => {
      const base = new Date("2024-02-29T00:00:00.000Z");
      const result = addMonthsClamped(base, 12);
      expect(result.toISOString()).toBe("2025-02-28T00:00:00.000Z");
    });
  });

  describe("addDuration", () => {
    it("adds ISO durations to date-only strings", () => {
      expect(addDuration("2026-01-31", "P1M")).toBe("2026-02-28");
      expect(addDuration("2024-01-31", "P1M")).toBe("2024-02-29");
      expect(addDuration("2026-03-31", "P1M")).toBe("2026-04-30");
      expect(addDuration("2026-09-28", "P3D")).toBe("2026-10-01");
      expect(addDuration("2026-09-28", "P1W")).toBe("2026-10-05");
    });

    it("adds ISO durations to full ISO instant strings", () => {
      expect(addDuration("2026-09-28T10:00:00.000Z", "PT4H")).toBe("2026-09-28T14:00:00.000Z");
      expect(addDuration("2026-09-28T10:00:00.000Z", "PT30M")).toBe("2026-09-28T10:30:00.000Z");
    });

    it("handles negative durations and subtraction", () => {
      expect(addDuration("2026-03-31", "-P1M")).toBe("2026-02-28");
      expect(addDuration("2026-10-01", "-P3D")).toBe("2026-09-28");
    });
  });

  describe("addDays and diffDays (spec/semantics/temporal.md §4.1)", () => {
    it("adds signed integer calendar days", () => {
      expect(addDays("2026-09-28", 5)).toBe("2026-10-03");
      expect(addDays("2026-09-28", -3)).toBe("2026-09-25");
    });

    it("computes integer calendar days elapsed between dates", () => {
      expect(diffDays("2026-01-01", "2026-01-05")).toBe(4);
      expect(diffDays("2026-01-05", "2026-01-01")).toBe(-4);
      expect(diffDays("2026-01-01", "2026-01-01")).toBe(0);
    });
  });

  describe("today() and now() with timezone projection (spec/semantics/temporal.md §3)", () => {
    it("returns formatted date in requested timezone", () => {
      // 2026-09-28 20:00 UTC is 2026-09-29 03:00 in Asia/Jakarta (+7)
      const base = new Date("2026-09-28T20:00:00.000Z");
      expect(today("UTC", base)).toBe("2026-09-28");
      expect(today("Asia/Jakarta", base)).toBe("2026-09-29");
    });

    it("nowInstant() returns ISO string ending in Z", () => {
      const instant = nowInstant();
      expect(instant.endsWith("Z")).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(instant)).toBe(true);
    });
  });

  describe("cron parser and next run calculator (spec/semantics/temporal.md §5)", () => {
    it("calculates next run for daily schedule at 01:00", () => {
      const base = new Date("2026-09-28T00:30:00.000Z");
      const nextRun = getNextCronRun("0 1 * * *", base);
      expect(nextRun.toISOString()).toBe("2026-09-28T01:00:00.000Z");
    });

    it("advances to next day if time has passed", () => {
      const base = new Date("2026-09-28T02:00:00.000Z");
      const nextRun = getNextCronRun("0 1 * * *", base);
      expect(nextRun.toISOString()).toBe("2026-09-29T01:00:00.000Z");
    });

    it("calculates step cron expressions (every 15 minutes)", () => {
      const base = new Date("2026-09-28T00:02:00.000Z");
      const nextRun = getNextCronRun("*/15 * * * *", base);
      expect(nextRun.toISOString()).toBe("2026-09-28T00:15:00.000Z");
    });
  });

  describe("K1 Evaluator Temporal Expressions", () => {
    it("evaluates addDays and diffDays in K1 expressions", () => {
      expect(evalExpression('addDays("2026-09-28", 3)')).toBe("2026-10-01");
      expect(evalExpression('diffDays("2026-01-01", "2026-01-10")')).toBe(9);
    });

    it("evaluates date + duration using + operator with month clamping", () => {
      expect(evalExpression('"2026-01-31" + "P1M"')).toBe("2026-02-28");
      expect(evalExpression('"2026-03-31" - "P1M"')).toBe("2026-02-28");
      expect(evalExpression('"2026-09-28" + "P3D"')).toBe("2026-10-01");
    });

    it("evaluates today() with context timezone", () => {
      const base = new Date("2026-09-28T20:00:00.000Z");
      expect(evalExpression("today()", { now: base, timezone: "UTC" })).toBe("2026-09-28");
      expect(evalExpression("today()", { now: base, timezone: "Asia/Jakarta" })).toBe("2026-09-29");
    });
  });
});
