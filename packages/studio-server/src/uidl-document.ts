/**
 * A structural check that a text is a UIDL document the runtime can render.
 *
 * This is not the runtime's full schema. It is the check a host needs before it
 * writes a new file, so an author finds out about a broken page at the moment they
 * make it rather than from a preview that will not render. The runtime's own
 * validation still happens when the document is inspected.
 */
export function uidlDocument(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const document = parsed as Record<string, unknown>;
  if (typeof document.version !== "string" || !document.version) return false;
  if (typeof document.id !== "string" || !document.id) return false;
  if (typeof document.name !== "string" || !document.name) return false;
  const root = document.root;
  if (typeof root !== "object" || root === null) return false;
  const node = root as Record<string, unknown>;
  return typeof node.id === "string" && !!node.id && typeof node.type === "string" && !!node.type;
}
