import { useState } from "react";

export function ScenarioPanel({
  entity,
  operations,
  recordText,
  actorText,
  onRun,
  result,
  busy,
}: {
  entity: string;
  operations: string[];
  recordText: string;
  actorText: string;
  onRun: (operation: string, record: Record<string, unknown>, actor?: Record<string, unknown>) => void;
  result: unknown;
  busy: boolean;
}) {
  const [operation, setOperation] = useState(operations[0] ?? "");
  const [record, setRecord] = useState(recordText);
  const [actor, setActor] = useState(actorText);
  return (
    <section className="scenario-panel" aria-label="Scenario runner">
      <h3>Scenario runner</h3>
      <p className="muted">Synthetic data only. Effects and events are displayed, not executed or sent.</p>
      <form
        className="draft-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onRun(operation, JSON.parse(record) as Record<string, unknown>, actor ? (JSON.parse(actor) as Record<string, unknown>) : undefined);
          } catch {
            // Invalid JSON is ignored; the parent keeps the last result.
          }
        }}
      >
        <label htmlFor="scenario-operation">Operation</label>
        <select id="scenario-operation" value={operation} disabled={busy} onChange={(event) => setOperation(event.target.value)}>
          {operations.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label htmlFor="scenario-record">Record JSON</label>
        <textarea id="scenario-record" value={record} spellCheck={false} onChange={(event) => setRecord(event.target.value)} />
        <label htmlFor="scenario-actor">Actor JSON</label>
        <textarea id="scenario-actor" value={actor} spellCheck={false} onChange={(event) => setActor(event.target.value)} />
        <button type="submit" disabled={busy || !operation}>
          {busy ? "Running..." : "Run scenario"}
        </button>
      </form>
      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
    </section>
  );
}
