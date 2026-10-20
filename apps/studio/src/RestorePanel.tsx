export function RestorePanel() {
  return (
    <section className="restore-panel" aria-label="Restore authoring revision">
      <h3>Restore authoring revision</h3>
      <p className="muted">
        Restore recovers source, locks, and review metadata to a new traceable
        revision. Business data is not silently replaced.
      </p>
    </section>
  );
}
