export function RecoveryPanel() {
  return (
    <section className="recovery-panel" aria-label="Release recovery">
      <h3>Release recovery</h3>
      <p className="muted">
        Recovery uses an explicit forward repair or a compatible prior model. Source,
        schema, and data recovery are distinct.
      </p>
      <p className="muted">No automatic data rollback is performed.</p>
    </section>
  );
}
