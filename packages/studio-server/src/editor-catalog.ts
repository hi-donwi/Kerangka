import { readFileSync } from "node:fs";

export interface EditorCatalog {
  components: Record<string, {
    acceptsChildren: boolean;
    slots: string[];
    props: Array<{ name: string; type: string; values?: readonly string[]; bindable?: boolean }>;
  }>;
  themes: Array<{ id: string; variants: Record<string, string[]> }>;
}

export function loadEditorCatalog(): EditorCatalog | undefined {
  try {
    return JSON.parse(readFileSync(new URL("../dist/public/editor-metadata.json", import.meta.url), "utf8")) as EditorCatalog;
  } catch {
    // Hosts without built editor assets cannot accept theme edits.
    return undefined;
  }
}

export function propertyProblem(catalog: EditorCatalog | undefined, type: string, key: string, value: unknown): string | undefined {
  const descriptor = catalog?.components[type]?.props.find((prop) => prop.name === key);
  if (!descriptor) return undefined; // Advanced source properties remain losslessly editable.
  if (descriptor.bindable && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const binding = value as Record<string, unknown>;
    if (typeof binding.$bind === "string" || binding.$expr !== undefined) return undefined;
  }
  const valid = descriptor.type === "enum" ? typeof value === "string" && descriptor.values?.includes(value)
    : descriptor.type === "string" ? typeof value === "string"
      : descriptor.type === "number" ? typeof value === "number" && Number.isFinite(value)
        : descriptor.type === "boolean" ? typeof value === "boolean"
          : descriptor.type === "array" ? Array.isArray(value)
            : descriptor.type === "object" || descriptor.type === "node" ? typeof value === "object" && value !== null && !Array.isArray(value)
              : true;
  return valid ? undefined : `Property '${key}' expects a declared ${descriptor.type} value.`;
}
