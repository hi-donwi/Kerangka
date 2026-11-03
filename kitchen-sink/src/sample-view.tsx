import { lazy, Suspense, useEffect, useRef, useState } from "react";
import release from "../../docs-site/release.json";
import { LIMITS, type ExecutionReply } from "./execution";
import ExecutionWorker from "./execution.worker?worker&inline";
import { runInWorker } from "./runner";
import type { ManifestEntry } from "./types";
import { publishedDocsHref, repositorySourceHref } from "./sample-links";
import { uidlForSample } from "./uidl-files";

const SampleUidlPreview = lazy(() => import("./uidl-preview").then((module) => ({ default: module.SampleUidlPreview })));
const models = import.meta.glob<unknown>("../../generated/*/kir.json", { eager: true, import: "default" });
const sources = import.meta.glob<string>("../../samples/*/*.kerangka.json", { eager: true, query: "?raw", import: "default" });

function RepositorySource({ path }: { path: string }) {
  const href = repositorySourceHref(path);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer"><code>{path}</code></a>
  ) : (
    <code>{path}</code>
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

export function SampleView({ entry }: { entry: ManifestEntry }) {
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

  const modelSource = sources[`../../${entry.modelPath}`];
  return (
    <section className="sample" aria-labelledby="sample-title">
      <div className="sample-heading">
        <div>
          <p className="eyebrow">Logic example / {entry.id}</p>
          <h2 id="sample-title">{entry.title}</h2>
        </div>
        <span className="support-badge">{entry.support} · {entry.version}</span>
      </div>
      <p className="meta"><strong>Runner model:</strong> <RepositorySource path={entry.modelPath} /></p>
      <p className="meta"><strong>Allowed modes:</strong> {entry.allowedModes.join(", ")}</p>
      <p className="meta">
        <strong>Docs:</strong>{" "}
        <a href={publishedDocsHref(entry.docsPath, release.site)} target="_blank" rel="noreferrer">
          {entry.docsPath}
        </a>
      </p>
      {entry.sourcePath ? (
        <p className="meta"><strong>Reference example:</strong> <RepositorySource path={entry.sourcePath} /></p>
      ) : null}
      <h3>Inputs</h3>
      <ul className="input-list">
        {entry.inputs.map((input) => (
          <li key={input.name} className="input-card">
            <div className="input-heading"><code>{input.name}</code><code>{input.run}</code></div>
            <p className="scenario-description">{input.description}</p>
            <p className="input-label">Fixture record</p>
            <pre>{JSON.stringify(input.record, null, 2)}</pre>
            {input.input ? <><p className="input-label">Operation input</p><pre>{JSON.stringify(input.input, null, 2)}</pre></> : null}
            {input.actor ? <><p className="input-label">Actor</p><pre className="actor">{JSON.stringify(input.actor, null, 2)}</pre></> : null}
            <button type="button" disabled={running !== null} onClick={() => void run(input.name)}>
              {running === input.name ? `Running ${input.name}…` : `Run ${input.name}`}
            </button>
          </li>
        ))}
      </ul>
      <div className="sample-actions"><button type="button" onClick={reset}>Reset sample</button></div>
      <section className="result-panel" role="status" aria-label="Execution result" aria-live="polite" aria-busy={running !== null}>
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
      <details open={reply?.kind === "fallback"} className="model-source">
        <summary>Inspect exact runner model</summary>
        <pre tabIndex={0}>{modelSource ?? "Source unavailable."}</pre>
      </details>
      <h3>Expected outcomes</h3>
      <ul className="expected-list">
        {entry.expected.outcomes.map((outcome) => (
          <li key={outcome.input}>
            <code>{outcome.input}</code> → <strong>{outcome.status}</strong>
            {outcome.error ? <code className="error-code">{outcome.error}</code> : null}
            {outcome.record ? <pre>{JSON.stringify(outcome.record, null, 2)}</pre> : null}
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
