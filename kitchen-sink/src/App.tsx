import { useState } from "react";
import manifest from "../../samples/manifest.json";
import type { ManifestEntry } from "./types";

const entries = manifest as ManifestEntry[];

export function App() {
  const [selected, setSelected] = useState(entries[0]?.id ?? "");
  const entry = entries.find((e) => e.id === selected);
  return (
    <main className="ks">
      <header>
        <h1>Kerangka Kitchen Sink</h1>
        <p>Preview-only. No network writes, no filesystem access, no host calls.</p>
      </header>
      <nav aria-label="samples">
        {entries.map((e) => (
          <button
            key={e.id}
            className={e.id === selected ? "active" : ""}
            onClick={() => setSelected(e.id)}
            type="button"
          >
            {e.title}
          </button>
        ))}
      </nav>
      {entry ? <SampleView entry={entry} /> : <p>No sample selected.</p>}
    </main>
  );
}

function SampleView({ entry }: { entry: ManifestEntry }) {
  return (
    <section className="sample">
      <h2>{entry.title}</h2>
      <p className="meta">
        <strong>Model:</strong> <code>{entry.modelPath}</code>
      </p>
      <p className="meta">
        <strong>Support:</strong> {entry.support} · <strong>Version:</strong> {entry.version}
      </p>
      <p className="meta">
        <strong>Allowed modes:</strong> {entry.allowedModes.join(", ")}
      </p>
      <p className="meta">
        <strong>Docs:</strong> <a href={entry.docsPath}>{entry.docsPath}</a>
      </p>
      {entry.sourcePath ? (
        <p className="meta">
          <strong>Source:</strong> <code>{entry.sourcePath}</code>
        </p>
      ) : null}
      <h3>Inputs</h3>
      <ul>
        {entry.inputs.map((i) => (
          <li key={i.name}>
            <code>{i.name}</code>
            <pre>{JSON.stringify(i.record, null, 2)}</pre>
            {i.actor ? <pre className="actor">{JSON.stringify(i.actor)}</pre> : null}
          </li>
        ))}
      </ul>
      <h3>Expected outcomes</h3>
      <ul>
        {entry.expected.outcomes.map((o) => (
          <li key={o.input}>
            <code>{o.input}</code> → <strong>{o.status}</strong>
            {o.record ? <pre>{JSON.stringify(o.record)}</pre> : null}
          </li>
        ))}
      </ul>
      <p className="note">
        Execution is preview-only in this P0 slice: inputs and expected outcomes are shown,
        not run in the browser. Live in-browser execution is gated by C2.
      </p>
    </section>
  );
}
