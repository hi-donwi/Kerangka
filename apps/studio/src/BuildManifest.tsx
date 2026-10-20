import { useState } from "react";

export function BuildManifest() {
  const [revision, setRevision] = useState("workspace");
  return (
    <section className="build-manifest" aria-label="Build manifest">
      <h3>Build manifest</h3>
      <p className="muted">
        Build identity pins source, locks, versions, target, and capabilities. Volatile
        timestamps are excluded.
      </p>
      <label htmlFor="build-revision">Revision label</label>
      <input id="build-revision" value={revision} onChange={(event) => setRevision(event.target.value)} />
      <p className="muted">Current label: {revision}</p>
    </section>
  );
}
