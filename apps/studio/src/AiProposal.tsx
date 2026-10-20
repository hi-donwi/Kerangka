export function AiProposal() {
  return (
    <section className="ai-proposal" aria-label="AI proposal">
      <h3>AI proposal</h3>
      <p className="muted">
        Provider integration is not enabled. AI output would be a bounded, validated
        proposal, not executed code. No provider context is sent in this build.
      </p>
    </section>
  );
}
