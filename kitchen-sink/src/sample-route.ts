export function sampleRoute(href: string, ids: readonly string[], selected?: string) {
  const url = new URL(href);
  const requested = selected ?? url.searchParams.get("sample") ?? "";
  const id = ids.includes(requested) ? requested : ids[0] ?? "";
  url.search = "";
  url.hash = "";
  if (id) url.searchParams.set("sample", id);
  return { id, path: `${url.pathname}${url.search}` };
}
