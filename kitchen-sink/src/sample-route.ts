export type CatalogView = "examples" | "starters" | "presets";

const catalogViews: readonly CatalogView[] = ["examples", "starters", "presets"];

export function catalogView(href: string): CatalogView {
  const requested = new URL(href).searchParams.get("catalog");
  return catalogViews.includes(requested as CatalogView) ? requested as CatalogView : "examples";
}

export function sampleRoute(href: string, ids: readonly string[], selected?: string, catalog?: CatalogView) {
  const url = new URL(href);
  const requested = selected ?? url.searchParams.get("sample") ?? "";
  const id = ids.includes(requested) ? requested : ids[0] ?? "";
  const requestedCatalog = catalog ?? catalogView(href);
  url.search = "";
  url.hash = "";
  if (id) url.searchParams.set("sample", id);
  if (requestedCatalog !== "examples") url.searchParams.set("catalog", requestedCatalog);
  return { id, path: `${url.pathname}${url.search}` };
}
