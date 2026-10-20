import { lazy, Suspense, useEffect, useRef, useState } from "react";
import manifest from "../../samples/manifest.json";
import ExecutionWorker from "./execution.worker?worker&inline";
import { LIMITS, type ExecutionReply } from "./execution";
import { runInWorker } from "./runner";
import { sampleRoute } from "./sample-route";
import type { ManifestEntry } from "./types";
import { uidlForSample } from "./uidl-files";

const SampleUidlPreview = lazy(() => import("./uidl-preview").then((module) => ({ default: module.SampleUidlPreview })));

const entries = manifest as ManifestEntry[];
const sampleIds = entries.map((entry) => entry.id);
const models = import.meta.glob<unknown>("../../generated/*/kir.json", { eager: true, import: "default" });
const sources = import.meta.glob<string>("../../samples/*/*.kerangka.json", { eager: true, query: "?raw", import: "default" });

export function App() {
  const [selected, setSelected] = useState(() => sampleRoute(window.location.href, sampleIds).id);
  useEffect(() => {
    const sync = () => {
      const route = sampleRoute(window.location.href, sampleIds);
      window.history.replaceState(null, "", route.path);
      setSelected(route.id);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function select(id: string) {
    const route = sampleRoute(window.location.href, sampleIds, id);
    if (route.id === selected) return;
    window.history.pushState(null, "", route.path);
    setSelected(route.id);
  }
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
            onClick={() => select(e.id)}
            aria-pressed={e.id === selected}
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

function UidlSection({ sampleId }: { sampleId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="UIDL preview">
      <h3>UIDL preview</h3>
      <p className="note">Generated screens for this sample. Nothing is stored or sent to a host.</p>
      {open ? (
        <Suspense fallback={<p>Loading UIDL preview...</p>}>
          <SampleUidlPreview documents={uidlForSample(sampleId)} />
        </Suspense>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>Show UIDL preview</button>
      )}
    </section>
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
      <UidlSection sampleId={entry.id} />
      <p className="note">
        One operation per fresh worker; {LIMITS.wallClockMs} ms deadline. Limits: 16 KiB inputs,
        256 KiB KIR, 16 entities, 128 operations, depth 32, 20,000 structural nodes, 8 KiB output.
        Effects are shown as data, never dispatched or persisted. The UIDL preview is read-only:
        it does not persist data and has no permission to apply writes.
      </p>
    </section>
  );
}
