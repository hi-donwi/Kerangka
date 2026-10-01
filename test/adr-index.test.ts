import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * The ADR index is a list kept beside the things it lists.
 *
 * `docs/adr/README.md` is the index, and nothing checked it. An ADR written and committed without
 * a row is invisible to the next reader: the record exists, it is just not where anyone looks.
 * That is the same drift ADR-0033 was written about for the workspace alias list — a second copy
 * of a fact, with no mechanism to notice when the copies disagree.
 *
 * So the index is checked, in the same spirit as `workspace-resolution.test.ts` next to it. It
 * lives at the repository root because what it checks is a repository-level convention.
 */
const adrDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "docs/adr");
const indexPath = resolve(adrDir, "README.md");
const index = readFileSync(indexPath, "utf8");

/** Rows of the index table, as `[number, title, status, date]`. */
const rows = [...index.matchAll(/^\| \[(\d{4})\]\(([^)]+)\) \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map(
  (match) => ({
    number: match[1]!,
    href: match[2]!,
    title: match[3]!,
    status: match[4]!,
    date: match[5]!
  })
);

/** ADR files, excluding the index itself. */
const adrFiles = readdirSync(adrDir).filter(
  (file) => file.endsWith(".md") && file !== "README.md"
);

describe("the ADR index", () => {
  it("lists every record in the directory", () => {
    // The drift this exists to catch. Write an ADR, forget the row, and the decision is on disk
    // but not where anyone looks for it.
    const listed = new Set(rows.map((row) => row.href));
    const missing = adrFiles.filter((file) => !listed.has(file));
    expect(missing, `ADRs with no index row: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists nothing that is not in the directory", () => {
    // The other direction, which a rename produces: the row survives, the file does not, and
    // the link in the index is dead.
    const present = new Set(adrFiles);
    const stale = rows.map((row) => row.href).filter((href) => !present.has(href));
    expect(stale, `index rows with no ADR: ${stale.join(", ")}`).toEqual([]);
  });

  it("links every row to a file that exists", () => {
    const broken = rows.filter((row) => !existsSync(resolve(adrDir, row.href)));
    expect(broken.map((row) => row.href)).toEqual([]);
  });

  it("numbers each record once, and in the file's own name", () => {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    const mismatched: string[] = [];

    for (const row of rows) {
      seen.set(row.number, (seen.get(row.number) ?? 0) + 1);
      if (seen.get(row.number) === 2) duplicates.push(row.number);
      if (!row.href.startsWith(`${row.number}-`)) mismatched.push(row.href);
    }

    expect(duplicates, `ADR number listed twice: ${duplicates.join(", ")}`).toEqual([]);
    expect(mismatched, `href does not carry its own number: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("agrees with each record about its own status and date", () => {
    // The index is a second copy of two facts. A record amended to Superseded while its row still
    // says Accepted misleads every reader who consults the index instead of the file — which is
    // the entire reason the index exists.
    const disagreeing: string[] = [];
    for (const row of rows) {
      const body = readFileSync(resolve(adrDir, row.href), "utf8");
      const status = /^- \*\*Status:\*\* (.+)$/m.exec(body)?.[1]?.trim();
      const date = /^- \*\*Date:\*\* (.+)$/m.exec(body)?.[1]?.trim();
      if (status !== row.status) disagreeing.push(`${row.href}: status ${row.status} vs ${status}`);
      if (date !== row.date) disagreeing.push(`${row.href}: date ${row.date} vs ${date}`);
    }
    expect(disagreeing, disagreeing.join("\n")).toEqual([]);
  });

  it("keeps the table shape the reader relies on", () => {
    expect(rows.length).toBe(adrFiles.length);
    for (const row of rows) {
      expect(row.title, `${row.href} has no title`).not.toBe("");
      expect(row.date, `${row.href} has no date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
