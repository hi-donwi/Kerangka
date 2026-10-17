import { useDeferredValue, useState } from "react";
import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";

export type Selection = { kind: "source" | "entity" | "screen"; id: string; line?: number; pointer?: string };

export function ProjectExplorer({
  response,
  selected,
  onSelect,
}: {
  response: StudioResponse;
  selected: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter).toLowerCase();
  const inspection = response.inspection;
  return (
    <aside className="explorer" aria-label="Project explorer">
      <label className="filter-label" htmlFor="explorer-filter">
        Find in project
      </label>
      <input
        id="explorer-filter"
        type="search"
        placeholder="Source, entity, screen..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <nav aria-label="Sources">
        <h2>
          Sources <span>{Object.keys(response.bundle.sources).length}</span>
        </h2>
        {Object.keys(response.bundle.sources)
          .filter((name) => name.toLowerCase().includes(query))
          .map((name) => (
            <button
              key={name}
              aria-pressed={selected?.kind === "source" && selected.id === name}
              onClick={() => onSelect({ kind: "source", id: name })}
            >
              <span className="file-symbol" aria-hidden="true">
                {"{}"}
              </span>
              <span>{name}</span>
            </button>
          ))}
      </nav>
      <nav aria-label="Entities">
        <h2>
          Entities <span>{inspection?.entities.length ?? 0}</span>
        </h2>
        {inspection?.entities
          .filter((item) => item.name.toLowerCase().includes(query))
          .map((item) => (
            <button
              key={item.name}
              aria-pressed={selected?.kind === "entity" && selected.id === item.name}
              onClick={() => onSelect({ kind: "entity", id: item.name })}
            >
              {item.name}
              <small>{item.fields.length} fields</small>
            </button>
          ))}
        {!inspection?.entities.length && <p className="empty-note">No compiled entities.</p>}
      </nav>
      <nav aria-label="Screens">
        <h2>
          Screens <span>{inspection?.screens.length ?? 0}</span>
        </h2>
        {inspection?.screens
          .filter((item) => item.label.toLowerCase().includes(query))
          .map((item) => (
            <button
              key={item.id}
              aria-pressed={selected?.kind === "screen" && selected.id === item.id}
              onClick={() => onSelect({ kind: "screen", id: item.id })}
            >
              {item.label}
              <small>{item.kind}</small>
            </button>
          ))}
      </nav>
      <p className="explorer-note">
        {response.excluded} non-source entries excluded. No project packages installed or effects dispatched.
      </p>
    </aside>
  );
}
