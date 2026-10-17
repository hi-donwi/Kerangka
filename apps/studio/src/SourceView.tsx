import { useEffect, useRef } from "react";

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
