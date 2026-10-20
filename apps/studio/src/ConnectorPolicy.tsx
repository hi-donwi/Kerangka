export function ConnectorPolicy() {
  return (
    <section className="connector-policy" aria-label="Connector policy">
      <h3>Connector policy</h3>
      <p className="muted">
        Egress, redirects, and private addresses are rejected. Secret references are
        redacted. No credential is stored in source, export, or prompt.
      </p>
    </section>
  );
}
