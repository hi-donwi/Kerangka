export function AuditPanel() {
  return (
    <section className="audit-panel" aria-label="Authoring audit">
      <h3>Authoring audit</h3>
      <p className="muted">
        Accepted changes and privileged approvals append actor, project, revision, and
        operation identifiers. No secrets or sensitive prompt bodies are stored.
      </p>
    </section>
  );
}
