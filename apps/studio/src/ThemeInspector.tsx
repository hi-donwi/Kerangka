import { useState } from "react";

export function ThemeInspector() {
  const [density, setDensity] = useState("comfortable");
  return (
    <section className="theme-inspector" aria-label="Theme and responsive settings">
      <h3>Theme and responsive settings</h3>
      <p className="muted">
        Presentation only. Theme and responsive edits do not change business behavior.
      </p>
      <label htmlFor="density">Density</label>
      <select id="density" value={density} onChange={(event) => setDensity(event.target.value)}>
        <option value="compact">Compact</option>
        <option value="comfortable">Comfortable</option>
        <option value="spacious">Spacious</option>
      </select>
      <p className="muted">Selected density: {density}. No source is written in this slice.</p>
    </section>
  );
}
