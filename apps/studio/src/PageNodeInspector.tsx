import { useState } from "react";
import { defaultRegistry, type ComponentPropDescriptor, type UIDLDocument, type UIDLNode } from "uidl-runtime";
import { editorThemes, parsePropertyValue } from "./editor-catalog";

interface Props {
  document: UIDLDocument;
  node: UIDLNode;
  busy?: boolean;
  readOnly: boolean;
  onSetProp: (id: string, key: string, value: unknown) => void;
  onSetTheme: (theme: string) => void;
  onSetThemeRef: (id: string, reference: string) => void;
}

export function PageNodeInspector({ document, node, busy, readOnly, onSetProp, onSetTheme, onSetThemeRef }: Props) {
  const manifest = defaultRegistry.get(node.type);
  const descriptors = manifest?.propDescriptors ?? [];
  const unknown = Object.fromEntries(Object.entries(node.props ?? {}).filter(([key]) => !descriptors.some((prop) => prop.name === key)));
  return (
    <section className="node-editor" aria-label="Typed property fields">
      <h3>{node.type} Properties</h3>
      <p className="muted">Controls follow the installed runtime descriptors. Changes enter the shared draft history.</p>
      {descriptors.map((descriptor) => (
        <PropertyField
          key={`${node.id}:${descriptor.name}:${JSON.stringify(node.props?.[descriptor.name])}`}
          descriptor={descriptor}
          value={node.props?.[descriptor.name] ?? manifest?.defaultProps?.[descriptor.name]}
          disabled={readOnly || Boolean(busy)}
          onApply={(value) => onSetProp(node.id, descriptor.name, value)}
        />
      ))}
      {!descriptors.length ? <p className="muted">No property descriptors are published for this component. Use its source editor.</p> : null}
      {Object.keys(unknown).length ? (
        <details>
          <summary>Additional Source Properties</summary>
          <p className="muted">Undescribed properties are retained unchanged. Edit them in source.</p>
          <pre className="source-view">{JSON.stringify(unknown, null, 2)}</pre>
        </details>
      ) : null}
      <ThemeReferences key={`${node.id}:${document.theme}:${node.themeRef}`} {...{ document, node, onSetTheme, onSetThemeRef }} disabled={readOnly || Boolean(busy)} />
    </section>
  );
}

function PropertyField({ descriptor, value, disabled, onApply }: {
  descriptor: ComponentPropDescriptor;
  value: unknown;
  disabled: boolean;
  onApply: (value: unknown) => void;
}) {
  const [json, setJson] = useState(Boolean(descriptor.bindable && value !== null && typeof value === "object"));
  const [input, setInput] = useState(() => value === undefined ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
  const [checked, setChecked] = useState(value === true);
  const [error, setError] = useState<string | null>(null);
  const id = `node-prop-${descriptor.name}`;
  const description = `${id}-description`;
  const complex = json || ["object", "array", "node"].includes(descriptor.type);
  return (
    <form className="descriptor-field" aria-label={`${descriptor.name} property`} onSubmit={(event) => {
      event.preventDefault();
      try {
        if (!json && descriptor.type === "number" && input.trim() === "") throw new Error("Enter a number before applying.");
        const next = !json && descriptor.type === "boolean" ? checked : parsePropertyValue(descriptor, input, json);
        setError(null);
        onApply(next);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid value."); }
    }}>
      <label htmlFor={id}>{descriptor.name}{descriptor.required ? " (required)" : ""}</label>
      {descriptor.bindable ? (
        <label className="descriptor-mode">
          Value Mode
          <select aria-label={`${descriptor.name} value mode`} disabled={disabled} value={json ? "json" : "literal"} onChange={(event) => { setJson(event.target.value === "json"); setError(null); }}>
            <option value="literal">Literal</option>
            <option value="json">Binding / Expression JSON</option>
          </select>
        </label>
      ) : null}
      {complex ? (
        <textarea id={id} value={input} disabled={disabled} spellCheck={false} aria-describedby={description} aria-invalid={Boolean(error)} onChange={(event) => setInput(event.target.value)} />
      ) : descriptor.type === "boolean" ? (
        <input id={id} type="checkbox" checked={checked} disabled={disabled} aria-describedby={description} onChange={(event) => setChecked(event.target.checked)} />
      ) : descriptor.type === "enum" ? (
        <select id={id} value={input} disabled={disabled} aria-describedby={description} onChange={(event) => setInput(event.target.value)}>
          <option value="">Not Set</option>
          {input && !descriptor.values?.includes(input) ? <option value={input} disabled>Source Value: {input}</option> : null}
          {descriptor.values?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      ) : (
        <input id={id} type={descriptor.type === "number" ? "number" : "text"} step={descriptor.type === "number" ? "any" : undefined} value={input} disabled={disabled} aria-describedby={description} aria-invalid={Boolean(error)} onChange={(event) => setInput(event.target.value)} />
      )}
      <p id={description} className="muted">{descriptor.description ?? `Runtime ${descriptor.type} property.`}</p>
      {error ? <p role="alert" className="error-banner">{error}</p> : null}
      <button type="submit" disabled={disabled}>Apply {descriptor.name}</button>
    </form>
  );
}

function ThemeReferences({ document, node, disabled, onSetTheme, onSetThemeRef }: Pick<Props, "document" | "node" | "onSetTheme" | "onSetThemeRef"> & { disabled: boolean }) {
  const [themeId, setThemeId] = useState(document.theme || editorThemes[0]!.id);
  const [reference, setReference] = useState(node.themeRef ?? "");
  const theme = editorThemes.find((entry) => entry.id === (document.theme || editorThemes[0]!.id));
  const variants = theme?.variants[node.type.toLowerCase()] ?? [];
  return (
    <section aria-label="Theme references" className="node-theme-editor">
      <h3>Theme References</h3>
      <form className="descriptor-field" aria-label="Document theme" onSubmit={(event) => { event.preventDefault(); onSetTheme(themeId); }}>
        <label htmlFor="document-theme">Document Theme</label>
        <select id="document-theme" value={themeId} disabled={disabled} onChange={(event) => setThemeId(event.target.value)}>
          {!editorThemes.some((entry) => entry.id === themeId) ? <option value={themeId} disabled>Unavailable: {themeId}</option> : null}
          {editorThemes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <button type="submit" disabled={disabled}>Apply document theme</button>
      </form>
      <form className="descriptor-field" aria-label="Node theme reference" onSubmit={(event) => { event.preventDefault(); onSetThemeRef(node.id, reference); }}>
        <label htmlFor="node-theme-ref">Node Theme Reference</label>
        <select id="node-theme-ref" value={reference} disabled={disabled || !theme} onChange={(event) => setReference(event.target.value)}>
          <option value="">Default (no reference)</option>
          {reference && !variants.some((variant) => variant.name === reference) ? <option value={reference} disabled>Unavailable: {reference}</option> : null}
          {variants.map((variant) => <option key={variant.name} value={variant.name}>{variant.name}</option>)}
        </select>
        <p className="muted">Variants come from the active theme, not from component props.</p>
        <button type="submit" disabled={disabled || !theme}>Apply theme reference</button>
      </form>
    </section>
  );
}
