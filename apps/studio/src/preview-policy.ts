import {
  DocumentSchema,
  assertSupportedDocumentVersion,
  createInMemoryAdapter,
  type DataAdapter,
  type UIDLDocument,
  type UIDLNode,
} from "uidl-runtime";
import { editorThemes } from "./editor-catalog";
import type { ScreenInfo } from "../../../packages/studio-server/src/contracts.js";

const allowed = new Set([
  "Container",
  "Row",
  "Column",
  "Stack",
  "Spacer",
  "Divider",
  "Text",
  "Icon",
  "Button",
  "Badge",
  "TextField",
  "Checkbox",
  "Switch",
  "Slider",
  "Select",
  "Textarea",
  "RadioGroup",
  "Form",
  "ListView",
  "GridView",
  "DataTable",
  "PageBar",
  "Sidebar",
  "Navbar",
  "Toolbar",
  "Panel",
  "Popover",
]);
const forbiddenKey =
  /^(?:href|src|srcset|poster|action|formaction|html|dangerouslysetinnerhtml|target|download|as|tag|tagname|elementtype|component|__proto__|constructor|prototype)$/i;

function checkPresentation(value: unknown, depth = 0): void {
  if (depth > 16) throw new Error("Preview presentation nesting exceeds the read-only budget.");
  if (
    typeof value === "string" &&
    (value.length > 8192 ||
      /^(?:https?:|javascript:|data:|file:|ftp:|\/\/)/i.test(value) ||
      /url\s*\(|@import/i.test(value))
  )
    throw new Error("URL-bearing or oversized presentation values are not enabled in P1 preview.");
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error("Preview collection exceeds the read-only budget.");
    for (const item of value) checkPresentation(item, depth + 1);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKey.test(key) || /^on/i.test(key))
        throw new Error("URL, HTML, and direct handler props are not enabled in P1 preview.");
      checkPresentation(item, depth + 1);
    }
  }
}

export function preparePreview(screen: Pick<ScreenInfo, "kind" | "document">): UIDLDocument {
  if (!screen || !["authored", "list", "form", "dashboard"].includes(screen.kind))
    throw new Error("Unknown preview origin.");
  if (new TextEncoder().encode(JSON.stringify(screen.document)).length > 1024 * 1024)
    throw new Error("Preview document exceeds the read-only budget.");
  const parsed = DocumentSchema.safeParse(screen.document);
  if (!parsed.success) throw new Error("The UIDL document does not match the runtime schema.");
  assertSupportedDocumentVersion(parsed.data.version);
  const document = structuredClone(parsed.data) as UIDLDocument;
  if (document.theme && !editorThemes.some((theme) => theme.id === document.theme))
    throw new Error("The document theme is unavailable in the host renderer; source is unchanged.");
  if (Object.keys(document.definitions ?? {}).length)
    throw new Error("Reusable definitions require a separately verified preview profile.");
  if (screen.kind === "authored") document.state = {};
  for (const [key, value] of Object.entries(document.dataSources ?? {})) {
    if (Array.isArray(value) || typeof value !== "object" || value === null || !("$query" in value))
      document.dataSources![key] = [];
  }
  const stack: Array<[UIDLNode, number]> = [[document.root, 0]];
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (++count > 500 || depth > 32) throw new Error("Preview node count or depth exceeds the read-only budget.");
    if (!allowed.has(node.type) || node.componentId || node.ref || node.repeat)
      throw new Error("This component, reference, or repeat is outside the static P1 preview profile.");
    delete node.events;
    node.props ??= {};
    if (screen.kind === "authored") {
      for (const [key, value] of Object.entries(node.props))
        if (/^(?:data|rows|items|records|datasource)$/i.test(key) && Array.isArray(value)) node.props[key] = [];
    }
    checkPresentation(node.props);
    checkPresentation(node.style);
    checkPresentation(node.bindings);
    checkPresentation(node.responsive);
    node.props.autoFocus = false;
    if (
      ["Button", "TextField", "Checkbox", "Switch", "Slider", "Select", "Textarea", "RadioGroup"].includes(node.type)
    ) {
      node.props.disabled = true;
      node.props.readOnly = true;
    }
    for (const child of node.children ?? []) stack.push([child, depth + 1]);
    for (const slot of Object.values(node.slots ?? {})) for (const child of slot) stack.push([child, depth + 1]);
  }
  return document;
}

export function previewPayload(
  screen: ScreenInfo,
  revision: string,
  synthetic: Record<string, Array<Record<string, unknown>>>,
  channel: string,
) {
  const document = preparePreview(screen);
  const seed: Record<string, Array<Record<string, unknown>>> = Object.create(null) as Record<
    string,
    Array<Record<string, unknown>>
  >;
  for (const value of Object.values(document.dataSources ?? {})) {
    if (typeof value !== "object" || value === null || !("$query" in value)) continue;
    const query = value.$query;
    if (
      typeof query === "object" &&
      query !== null &&
      "collection" in query &&
      typeof query.collection === "string" &&
      Object.hasOwn(synthetic, query.collection)
    )
      seed[query.collection] = synthetic[query.collection]!;
  }
  return {
    type: "studio.preview.render" as const,
    channel,
    revision,
    screen: { kind: screen.kind, document },
    synthetic: seed,
  };
}

export function readOnlyAdapter(seed: Record<string, Array<Record<string, unknown>>>): DataAdapter {
  const adapter = createInMemoryAdapter({ seed, persist: "none", latencyMs: 0, failureRate: 0 });
  const deny = async (): Promise<never> => {
    throw new Error("The synthetic preview is read-only.");
  };
  return {
    query: adapter.query.bind(adapter),
    get: adapter.get.bind(adapter),
    report: adapter.report.bind(adapter),
    create: deny,
    update: deny,
    remove: deny,
    transition: deny,
  };
}
