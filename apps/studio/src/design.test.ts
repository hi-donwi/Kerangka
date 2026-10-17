import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const colors = new Map([...css.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6})\s*;/gi)].map((match) => [match[1]!, match[2]!]));
const luminance = (color: string) => {
  const values = color
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
};

describe("Studio semantic color pairs", () => {
  it.each([
    ["ink", "surface", 4.5],
    ["muted", "surface", 4.5],
    ["surface", "ink", 4.5],
    ["surface", "rust", 4.5],
    ["rust", "rust-wash", 4.5],
    ["code-ink", "code-paper", 4.5],
    ["ink", "mark-paper", 4.5],
    ["control-line", "surface", 3],
    ["mark-paper", "ink", 3],
  ] as const)("keeps %s on %s at least %s:1", (foreground, background, minimum) => {
    expect(colors.has(foreground) && colors.has(background)).toBe(true);
    const first = luminance(colors.get(foreground)!);
    const second = luminance(colors.get(background)!);
    expect((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toBeGreaterThanOrEqual(minimum);
  });

  it("uses the contrasting focus token on the dark masthead", () => {
    expect(css).toMatch(/\.masthead\s*\{[^}]*--color-focus:\s*var\(--color-highlight\)/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*var\(--color-focus\)/);
  });
});
