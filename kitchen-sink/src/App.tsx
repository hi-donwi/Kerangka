import { useEffect, useRef, useState } from "react";
import manifest from "../../samples/manifest.json";
import ExecutionWorker from "./execution.worker?worker&inline";
import { LIMITS, type ExecutionReply } from "./execution";
import { runInWorker } from "./runner";
import type { ManifestEntry } from "./types";

const entries = manifest as ManifestEntry[];
const models = import.meta.glob<unknown>("../../generated/*/kir.json", { eager: true, import: "default" });
const sources = import.meta.glob<string>("../../samples/*/*.kerangka.json", { eager: true, query: "?raw", import: "default" });

export function App() {
  const [selected, setSelected] = useState(entries[0]?.id ?? "");
  const entry = entries.find((e) => e.id === selected);
  return (
    <main className="ks">
      <header>
        <h1>Kerangka Kitchen Sink</h1>
        <p>Live, in-memory execution. No network writes, no filesystem access, no host calls.</p>
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
      {entry ? <SampleView key={entry.id} entry={entry} /> : <p>No sample selected.</p>}
    </main>
  );
}

function SampleView({ entry }: { entry: ManifestEntry }) {
  const [reply, setReply] = useState<ExecutionReply>();
  const [running, setRunning] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function run(inputName: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRunning(inputName);
    setReply(undefined);
    const result = await runInWorker(
      { kir: models[`../../generated/${entry.id}/kir.json`], sample: entry, inputName },
      () => new ExecutionWorker(), current.signal,
    );
    if (!current.signal.aborted) {
      setReply(result);
      setRunning(null);
    }
  }

  function reset() {
    controller.current?.abort();
    setReply(undefined);
    setRunning(null);
  }

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
            {" "}<code>{i.run}</code>
            <pre>{JSON.stringify(i.record, null, 2)}</pre>
            {i.actor ? <pre className="actor">{JSON.stringify(i.actor)}</pre> : null}
            <button type="button" disabled={running !== null} onClick={() => void run(i.name)}>
              Run {i.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={reset}>Reset sample</button>
      <section role="status" aria-label="Execution result" aria-live="polite" aria-busy={running !== null}>
        <h3>Actual result</h3>
        {running ? <p>Running {running} in an isolated worker...</p> : null}
        {!running && !reply ? <p>Choose an input to run the real engine.</p> : null}
        {reply?.kind === "result" ? <>
          <p><strong>{reply.matched ? "PASS" : "MISMATCH"}: {reply.status}</strong> (engine: {reply.elapsedMs.toFixed(2)} ms)</p>
          <pre>{reply.output}</pre>
          {reply.truncated ? <p>Output truncated to {LIMITS.outputBytes} bytes. Expectation checked before truncation.</p> : null}
        </> : null}
        {reply?.kind === "fallback" ? <p><strong>Source-only fallback:</strong> {reply.reason}</p> : null}
      </section>
      <details open={reply?.kind === "fallback"}>
        <summary>Model source</summary>
        <pre>{sources[`../../${entry.modelPath}`] ?? "Source unavailable."}</pre>
      </details>
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
        One operation per fresh worker; {LIMITS.wallClockMs} ms deadline. Limits: 16 KiB inputs,
        256 KiB KIR, 16 entities, 128 operations, depth 32, 20,000 structural nodes, 8 KiB output.
        Effects are shown as data, never dispatched or persisted. UIDL-Runtime is retained;
        UIDL rendering is not part of this execution view.
      </p>
    </section>
  );
}
