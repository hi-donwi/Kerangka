import { useEffect, useState } from "react";
import manifest from "../../samples/manifest.json";
import {
  filterLogicPresetCatalog,
  filterStarterCatalog,
  logicPresetCatalog,
  matchesCatalogSearch,
  starterCatalog,
} from "./catalog";
import { LogicPresetCatalog, StarterCatalog } from "./catalog-view";
import { catalogView, sampleRoute, type CatalogView } from "./sample-route";
import { SampleView } from "./sample-view";
import type { ManifestEntry } from "./types";

const entries = manifest as ManifestEntry[];
const sampleIds = entries.map((entry) => entry.id);

const catalogSections: { id: CatalogView; label: string; count: number }[] = [
  { id: "examples", label: "Examples", count: entries.length },
  { id: "starters", label: "Starters", count: starterCatalog.length },
  { id: "presets", label: "Logic presets", count: logicPresetCatalog.length },
];

export function App() {
  const [selected, setSelected] = useState(() => sampleRoute(window.location.href, sampleIds).id);
  const [catalog, setCatalog] = useState(() => catalogView(window.location.href));
  const [query, setQuery] = useState("");

  useEffect(() => {
    const sync = () => {
      const currentCatalog = catalogView(window.location.href);
      const route = sampleRoute(window.location.href, sampleIds, undefined, currentCatalog);
      window.history.replaceState(null, "", route.path);
      setSelected(route.id);
      setCatalog(currentCatalog);
      setQuery("");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function selectSample(id: string) {
    const route = sampleRoute(window.location.href, sampleIds, id, catalog);
    if (route.id === selected) return;
    window.history.pushState(null, "", route.path);
    setSelected(route.id);
  }

  function selectCatalog(nextCatalog: CatalogView) {
    if (nextCatalog === catalog) return;
    const route = sampleRoute(window.location.href, sampleIds, selected, nextCatalog);
    window.history.pushState(null, "", route.path);
    setCatalog(nextCatalog);
    setQuery("");
  }

  const entry = entries.find((sample) => sample.id === selected);
  const visibleEntries = entries.filter((sample) => matchesCatalogSearch(query, [
    sample.id,
    sample.title,
    sample.modelPath,
    sample.docsPath,
    sample.sourcePath ?? "",
    ...sample.inputs.flatMap((input) => [input.name, input.run]),
  ]));

  return (
    <main className="ks">
      <header className="ks-header">
        <p className="eyebrow">Kerangka / developer catalog</p>
        <h1>Kerangka Kitchen Sink</h1>
        <p>Explore executable logic examples, tested starters, and reusable model presets. Logic runs in a disposable worker; UI presentation stays with UIDL Runtime.</p>
      </header>
      <nav className="catalog-tabs" aria-label="Catalog sections">
        {catalogSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={catalog === section.id ? "active" : ""}
            aria-pressed={catalog === section.id}
            onClick={() => selectCatalog(section.id)}
          >
            {section.label}<span>{section.count}</span>
          </button>
        ))}
      </nav>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span>Search this catalog</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={catalog === "examples" ? "Search examples or operations…" : "Search names, packages, tags…"}
          />
        </label>
        <p aria-live="polite">
          {catalog === "examples" ? `${visibleEntries.length} of ${entries.length} examples` : null}
          {catalog === "starters" ? `${filterStarterCatalog(query).length} of ${starterCatalog.length} starters` : null}
          {catalog === "presets" ? `${filterLogicPresetCatalog(query).length} of ${logicPresetCatalog.length} logic presets` : null}
        </p>
      </div>

      {catalog === "examples" ? (
        <div className="example-layout">
          <aside className="sample-sidebar">
            <div className="sidebar-heading">
              <div><h2>Logic examples</h2><p>Reference models with runnable fixtures</p></div>
              <span>{visibleEntries.length}</span>
            </div>
            <nav aria-label="samples">
              {visibleEntries.map((sample) => (
                <button
                  key={sample.id}
                  className={sample.id === selected ? "active" : ""}
                  onClick={() => selectSample(sample.id)}
                  aria-pressed={sample.id === selected}
                  type="button"
                >
                  <span>{sample.title}</span>
                  <small>{sample.inputs.length} runnable {sample.inputs.length === 1 ? "fixture" : "fixtures"}</small>
                </button>
              ))}
            </nav>
            {visibleEntries.length === 0 ? <p className="sidebar-empty">No examples match that search.</p> : null}
            <p className="ownership-note">Need a starting project? Browse tested CLI starters. Need widgets or page recipes? Those belong to UIDL Runtime.</p>
          </aside>
          <div className="sample-content">
            {entry ? <SampleView key={entry.id} entry={entry} /> : <p>No sample selected.</p>}
          </div>
        </div>
      ) : null}
      {catalog === "starters" ? <StarterCatalog query={query} /> : null}
      {catalog === "presets" ? <LogicPresetCatalog query={query} /> : null}
    </main>
  );
}
