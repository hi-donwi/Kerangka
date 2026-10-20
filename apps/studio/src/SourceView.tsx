import { useEffect, useRef, useState } from "react";

export function SourceView({ text, line = 0, label = "Source text" }: { text: string; line?: number; label?: string }) {
  const mark = useRef<HTMLElement>(null);
  let start = 0;
  for (let number = 1; number < line; number++) {
    const next = text.indexOf("\n", start);
    if (next < 0) break;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  useEffect(() => {
    if (line) mark.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [line, text]);
  return (
    <pre className="source-view" role="region" aria-label={label} tabIndex={0}>
      <code>
        {line ? (
          <>
            {text.slice(0, start)}
            <mark ref={mark} data-highlighted-line={line}>
              {text.slice(start, end < 0 ? text.length : end)}
            </mark>
            {text.slice(end < 0 ? text.length : end)}
          </>
        ) : (
          text
        )}
      </code>
    </pre>
  );
}

export function SourceEditor({
  text,
  format,
  busy,
  onApply,
}: {
  text: string;
  format: "json" | "yaml";
  busy: boolean;
  onApply: (text: string) => void;
}) {
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  const json = format === "json";
  return (
    <form
      className="source-editor"
      aria-label="Source editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (json && value !== text) onApply(value);
      }}
    >
      <p className="muted">
        Visual writes are JSON field operations. YAML stays source-only and is not applied from this panel.
        Text changes join the same undo history after Apply source edit.
      </p>
      <textarea
        aria-label="Source editor text"
        value={value}
        readOnly={!json}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={!json || busy || value === text}>
        Apply source edit
      </button>
    </form>
  );
}
