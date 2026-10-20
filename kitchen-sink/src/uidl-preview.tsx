import { Component, type ReactNode, useState } from "react";
import { UIDocumentRenderer, DocumentSchema, createInMemoryAdapter, type UIDLDocument } from "uidl-runtime";
import "uidl-runtime/style.css";
import type { SampleUidlFile } from "./uidl-files";

export function parsePreviewDocument(raw: string, limit = 64 * 1024) {
  if (new TextEncoder().encode(raw).length > limit) {
    return { document: null, error: "UIDL document exceeds the 64 KiB preview limit." };
  }
  try {
    const document = DocumentSchema.parse(JSON.parse(raw));
    return { document, error: null };
  } catch (error) {
    return { document: null, error: error instanceof Error ? error.message : "Invalid UIDL document." };
  }
}

export function PreviewSurface({ document }: { document: UIDLDocument }) {
  return (
    <UIDocumentRenderer
      document={document}
      dataAdapter={createInMemoryAdapter({ seed: {}, persist: "none", latencyMs: 0, failureRate: 0 })}
    />
  );
}

function shownError(message: string) {
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

class PreviewErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "UIDL preview failed." };
  }

  render() {
    if (this.state.error) return <p role="alert">{shownError(this.state.error)}</p>;
    return this.props.children;
  }
}

export function SampleUidlPreview({ documents }: { documents: SampleUidlFile[] }) {
  const [selected, setSelected] = useState(documents[0]?.id ?? "");
  if (documents.length === 0) return <p>No generated UIDL screens for this sample.</p>;
  const current = documents.find((document) => document.id === selected) ?? documents[0];
  const parsed = parsePreviewDocument(current.raw);
  return (
    <div className="uidl-preview">
      <div className="uidl-screens" role="group" aria-label="UIDL screens">
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            aria-pressed={document.id === current.id}
            onClick={() => setSelected(document.id)}
          >
            {document.id}
          </button>
        ))}
      </div>
      {parsed.error ? <p role="alert">{shownError(parsed.error)}</p> : null}
      {parsed.document ? (
        <PreviewErrorBoundary key={current.id}>
          <PreviewSurface document={parsed.document} />
        </PreviewErrorBoundary>
      ) : null}
    </div>
  );
}
