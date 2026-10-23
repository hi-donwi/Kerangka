import {
  defaultRegistry, defaultLightTheme, defaultDarkTheme, meridianLightTheme, meridianDarkTheme,
  type ComponentPropDescriptor,
} from "uidl-runtime";

export const editorThemes = [defaultLightTheme, defaultDarkTheme, meridianLightTheme, meridianDarkTheme];

// Generated into the trusted host assets at build time, never supplied by a document.
export function editorCatalog() {
  return {
    components: Object.fromEntries(defaultRegistry.list().map((widget) => [widget.type, {
      acceptsChildren: widget.acceptsChildren,
      slots: widget.slots ?? [],
      props: widget.propDescriptors ?? [],
    }])),
    themes: editorThemes.map((theme) => ({
      id: theme.id,
      variants: Object.fromEntries(Object.entries(theme.variants).map(([type, variants]) => [type, variants.map((variant) => variant.name)])),
    })),
  };
}

export function parsePropertyValue(descriptor: ComponentPropDescriptor, text: string, json = false): unknown {
  if (!json && descriptor.type === "string") return text;
  if (!json && descriptor.type === "enum") {
    if (!descriptor.values?.includes(text)) throw new Error("Choose one of the declared values.");
    return text;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Enter valid JSON for this value."); }
  if (json && descriptor.bindable && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const binding = value as Record<string, unknown>;
    if (typeof binding.$bind === "string" || binding.$expr !== undefined) return value;
  }
  const valid = descriptor.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : descriptor.type === "boolean" ? typeof value === "boolean"
      : descriptor.type === "array" ? Array.isArray(value)
        : descriptor.type === "object" || descriptor.type === "node" ? typeof value === "object" && value !== null && !Array.isArray(value)
          : false;
  if (!valid) throw new Error(`Expected a ${descriptor.type} value.`);
  return value;
}
