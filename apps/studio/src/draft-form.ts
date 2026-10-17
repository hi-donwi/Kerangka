/**
 * Draft form helpers for the entity inspector.
 *
 * Studio can propose an edit and show the recompiled projection, but it never saves:
 * these helpers only build the shorthand an operator picks, so they stay pure and
 * testable without a DOM.
 */

/** Canonical scalar field types (aliases excluded) an operator may add. */
export const DRAFT_FIELD_TYPES = [
  "string",
  "text",
  "int",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "uuid",
  "email",
  "url",
  "json",
] as const;

export type DraftFieldType = (typeof DRAFT_FIELD_TYPES)[number];

/** The type the form starts on. */
export const DEFAULT_DRAFT_FIELD_TYPE: DraftFieldType = "string";

/** `string?` for optional, `string!` for required; explicit either way. */
export function fieldDefinition(type: string, required: boolean): string {
  return `${type}${required ? "!" : "?"}`;
}

/** Returns a problem to show, or `null` when the name is usable. */
export function fieldNameProblem(name: string): string | null {
  if (name.length === 0) return "Enter a field name.";
  if (name.length > 64) return "Keep the name to 64 characters or fewer.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    return "Start with a letter or underscore; use only letters, digits, or underscores.";
  return null;
}
