import { useState } from "react";
import type { JourneyInfo } from "../../../packages/studio-server/src/contracts.js";

/**
 * Running a journey.
 *
 * A journey owns no behavior, so running it means running the operations it names, in
 * the order the journey names them, against a synthetic record and a named actor. The
 * outcome of each step is shown as it is: a step that is refused says so, with the
 * reason the engine gave, and the steps after it do not run.
 */

export interface JourneyRunStep {
  id: string;
  operation: string;
  ok: boolean;
  code?: string;
  message?: string;
  record?: Record<string, unknown>;
}

export interface JourneyRunResult {
  ok: boolean;
  steps: JourneyRunStep[];
}

export interface JourneyRunnerProps {
  journey: JourneyInfo;
  recordText: string;
  actorText: string;
  busy: boolean;
  result: JourneyRunResult | null;
  onRun: (record: Record<string, unknown>, actor?: Record<string, unknown>) => void;
}

export function JourneyRunner({ journey, recordText, actorText, busy, result, onRun }: JourneyRunnerProps) {
  const [record, setRecord] = useState(recordText);
  const [actor, setActor] = useState(actorText);
  const operations = journey.steps.filter((step) => step.kind === "operation" && step.operation);

  return (
    <section className="scenario-panel" aria-label="Journey runner">
      <h3>Run this journey</h3>
      <p className="muted">
        The operations the journey names, in order, against synthetic data. Effects are
        displayed, never sent. A refused step stops the run and says why.
      </p>
      {operations.length === 0 ? (
        <p className="muted" role="status">
          This journey names no operation, so there is nothing to run.
        </p>
      ) : (
        <form
          className="draft-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onRun(JSON.parse(record) as Record<string, unknown>, actor ? (JSON.parse(actor) as Record<string, unknown>) : undefined);
            } catch {
              // Invalid JSON is ignored; the parent keeps the last result.
            }
          }}
        >
          <label htmlFor="journey-record">Record JSON</label>
          <textarea id="journey-record" value={record} spellCheck={false} onChange={(event) => setRecord(event.target.value)} />
          <label htmlFor="journey-actor">Actor JSON</label>
          <textarea id="journey-actor" value={actor} spellCheck={false} onChange={(event) => setActor(event.target.value)} />
          <button type="submit" disabled={busy}>
            {busy ? "Running..." : "Run journey"}
          </button>
        </form>
      )}
      {result ? (
        <ol className="journey-run" aria-label="Journey run">
          {result.steps.map((step) => (
            <li key={step.id} data-outcome={step.ok ? "ok" : "denied"}>
              <strong>{step.operation}</strong>
              <span>{step.ok ? "ran" : `refused: ${step.code ?? "denied"}`}</span>
              {step.message ? <span>{step.message}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
