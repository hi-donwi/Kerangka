import type { StudioDiagnostic } from "../../../packages/studio-server/src/contracts.js";

export function Diagnostics({
  items,
  onOpen,
}: {
  items: StudioDiagnostic[];
  onOpen: (item: StudioDiagnostic) => void;
}) {
  return (
    <section className="diagnostics" aria-label="Diagnostics">
      <div className="section-heading">
        <h2>
          Diagnostics <span>{items.length}</span>
        </h2>
        <span className="muted">SOURCE LINKED</span>
      </div>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.code}:${index}`}>
              <button onClick={() => onOpen(item)}>
                <span className={`severity severity-${item.severity}`}>{item.severity}</span>
                <code>{item.code}</code>
                <span>
                  {item.source}
                  {item.line ? `:${item.line}:${item.column ?? 1}` : ""}
                </span>
                <strong>{item.message}</strong>
                {item.hint && <small>{item.hint}</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="diagnostic-clear">No source diagnostics. This is not a production-readiness assessment.</p>
      )}
    </section>
  );
}
