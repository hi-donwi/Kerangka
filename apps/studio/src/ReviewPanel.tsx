export function ReviewPanel() {
  return (
    <section className="review-panel" aria-label="Revision review">
      <h3>Revision review</h3>
      <p className="muted">
        Review approval binds an exact revision and operation scope. New edits
        invalidate approval. No implicit Git commit or push occurs.
      </p>
    </section>
  );
}
