import { useState, type FormEvent } from "react";
import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";
import { DRAFT_FIELD_TYPES, DEFAULT_DRAFT_FIELD_TYPE, fieldDefinition, fieldNameProblem } from "./draft-form";

export interface DraftState {
  busy: boolean;
  spent: boolean;
  error: string | null;
  notice: string | null;
}

export function EntityInspector({
  entity,
  roles,
  onOpenSource,
  draft,
  onAddField,
}: {
  entity: EntityInfo;
  roles: string[];
  onOpenSource: () => void;
  draft: DraftState;
  onAddField: (field: string, definition: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(DEFAULT_DRAFT_FIELD_TYPE);
  const [required, setRequired] = useState(false);
  const problem = fieldNameProblem(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    onAddField(name, fieldDefinition(type, required));
    setName("");
  };

  return (
    <div className="entity-inspector">
      <div className="section-heading">
        <h3>Field contract</h3>
        <button onClick={onOpenSource}>Inspect source</button>
      </div>
      <div className="table-scroll" role="region" aria-label="Entity fields" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Required</th>
              <th>Computed</th>
            </tr>
          </thead>
          <tbody>
            {entity.fields.map((field) => (
              <tr key={field.name}>
                <th scope="row">{field.name}</th>
                <td>
                  <code>{field.type}</code>
                </td>
                <td>{field.required ? "Yes" : "No"}</td>
                <td>{field.computed ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Operations</h3>
      {entity.operations.length ? (
        <ul className="operation-list">
          {entity.operations.map((operation) => (
            <li key={`${operation.kind}:${operation.name}`}>
              <strong>{operation.name}</strong>
              <span>
                {operation.kind}
                {operation.to ? ` / ${operation.from?.join(", ")} to ${operation.to}` : ""}
              </span>
              <small>
                {operation.roles.join(", ") || "No operation roles declared"}
                {operation.guarded ? " / Guarded" : ""}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No actions or transitions.</p>
      )}
      <form className="draft-form" aria-label={`Add a field to ${entity.name}`} onSubmit={submit}>
        <h3>Add a field</h3>
        <p className="muted">
          {draft.spent
            ? "The unsaved preview holds one new field. Refresh the source before drafting again; saving is a later slice."
            : "Studio recompiles the projection for preview only. It never saves the model file."}
        </p>
        <div className="draft-form-controls">
          <div>
            <label htmlFor="new-field-name">New field name</label>
            <input
              id="new-field-name"
              name="field"
              value={name}
              autoComplete="off"
              spellCheck={false}
              disabled={draft.spent}
              aria-invalid={name.length > 0 && problem !== null}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="new-field-type">Type</label>
            <select
              id="new-field-type"
              value={type}
              disabled={draft.spent}
              onChange={(event) => setType(event.target.value)}
            >
              {DRAFT_FIELD_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="draft-form-required">
          <input
            type="checkbox"
            checked={required}
            disabled={draft.spent}
            onChange={(event) => setRequired(event.target.checked)}
          />
          Required
        </label>
        <button type="submit" disabled={draft.spent || draft.busy || problem !== null}>
          {draft.busy ? "Applying draft..." : "Add field"}
        </button>
        {name.length > 0 && problem ? (
          <p className="draft-form-problem" role="alert">
            {problem}
          </p>
        ) : null}
        {draft.error ? (
          <p className="error-banner" role="alert">
            Draft refused: {draft.error}
          </p>
        ) : null}
        {draft.notice ? (
          <p className="pointer-note" role="status">
            {draft.notice}
          </p>
        ) : null}
      </form>
      <p className="muted">Business roles: {roles.join(", ") || "none declared"}. These do not grant Studio access.</p>
    </div>
  );
}
