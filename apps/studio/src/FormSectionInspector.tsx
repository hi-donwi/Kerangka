import { useState } from "react";

export function FormSectionInspector({
  view,
  sections,
  sectionTitles,
  busy,
  error,
  onApply,
}: {
  view: string;
  sections: string[][];
  sectionTitles: string[];
  busy: boolean;
  error: string | null;
  onApply: (sections: string[][], sectionTitles: string[]) => void;
}) {
  const [titles, setTitles] = useState(sectionTitles);
  const [order, setOrder] = useState(sections);
  const move = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    const swapped = order.slice();
    const swappedTitles = titles.slice();
    const section = swapped[index];
    const title = swappedTitles[index];
    swapped[index] = swapped[next]!;
    swapped[next] = section!;
    swappedTitles[index] = swappedTitles[next]!;
    swappedTitles[next] = title!;
    setOrder(swapped);
    setTitles(swappedTitles);
  };
  return (
    <form
      className="draft-form"
      aria-label={`Configure form sections for ${view}`}
      onSubmit={(event) => {
        event.preventDefault();
        onApply(order, titles);
      }}
    >
      <h3>Form sections</h3>
      <p className="muted">
        This edits the recipe-owned view source. The preview is regenerated. Emitted UIDL files are not written.
      </p>
      {order.map((section, index) => (
        <div key={`${section.join(",")}:${index}`} className="draft-form-controls">
          <div>
            <label htmlFor={`section-title-${index}`}>Section {index + 1} title</label>
            <input
              id={`section-title-${index}`}
              value={titles[index] ?? ""}
              disabled={busy}
              onChange={(event) =>
                setTitles(titles.map((title, titleIndex) => (titleIndex === index ? event.target.value : title)))
              }
            />
          </div>
          <div>
            <span className="muted">{section.join(", ")}</span>
            <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)}>
              Move up
            </button>
            <button type="button" disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}>
              Move down
            </button>
          </div>
        </div>
      ))}
      <button type="submit" disabled={busy || titles.some((title) => title.trim().length === 0)}>
        Apply section layout
      </button>
      {error ? (
        <p className="error-banner" role="alert">
          Draft refused: {error}
        </p>
      ) : null}
    </form>
  );
}
