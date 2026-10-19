import { UIDocumentRenderer, DocumentSchema, createInMemoryAdapter, type UIDLDocument } from "uidl-runtime";
import "uidl-runtime/style.css";

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
