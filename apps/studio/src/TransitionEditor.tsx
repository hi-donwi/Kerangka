import { useEffect, useState } from "react";

export function TransitionEditor({
  entity,
  transition,
  from,
  to,
  roles,
  when,
  allStates,
  allRoles,
  busy,
  error,
  onApply,
}: {
  entity: string;
  transition: string;
  from: string[];
  to: string;
  roles: string[];
  when?: string;
  allStates: string[];
  allRoles: string[];
  busy: boolean;
  error: string | null;
  onApply: (next: { from: string[]; to: string; roles: string[]; when?: string }) => void;
}) {
  const [selectedFrom, setSelectedFrom] = useState(from);
  const [selectedTo, setSelectedTo] = useState(to);
  const [selectedRoles, setSelectedRoles] = useState(roles);
  const [guard, setGuard] = useState(when ?? "");
  useEffect(() => setSelectedFrom(from), [from]);
  useEffect(() => setSelectedTo(to), [to]);
  useEffect(() => setSelectedRoles(roles), [roles]);
  useEffect(() => setGuard(when ?? ""), [when]);
  return (
    <form
      className="draft-form"
      aria-label={`Edit transition ${transition} on ${entity}`}
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          from: selectedFrom,
          to: selectedTo,
          roles: selectedRoles,
          ...(guard.trim() ? { when: guard.trim() } : {}),
        });
      }}
    >
      <h3>Transition: {transition}</h3>
      <p className="muted">Edits serialize the existing transition. Dangling states are refused by the compiler.</p>
      <div className="draft-form-controls">
        <div>
          <label htmlFor="transition-to">To state</label>
          <select id="transition-to" value={selectedTo} disabled={busy} onChange={(event) => setSelectedTo(event.target.value)}>
            {allStates.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="transition-guard">Guard</label>
          <input
            id="transition-guard"
            value={guard}
            disabled={busy}
            spellCheck={false}
            placeholder="employeeId == actor.id"
            onChange={(event) => setGuard(event.target.value)}
          />
        </div>
      </div>
      <fieldset>
        <legend>From states</legend>
        {allStates.map((state) => (
          <label key={state}>
            <input
              type="checkbox"
              checked={selectedFrom.includes(state)}
              disabled={busy}
              onChange={(event) =>
                setSelectedFrom((current) =>
                  event.target.checked ? [...current, state] : current.filter((item) => item !== state),
                )
              }
            />
            {state}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Roles</legend>
        {allRoles.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={selectedRoles.includes(role)}
              disabled={busy}
              onChange={(event) =>
                setSelectedRoles((current) =>
                  event.target.checked ? [...current, role] : current.filter((item) => item !== role),
                )
              }
            />
            {role}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={busy || selectedFrom.length === 0}>
        Apply transition
      </button>
      {error ? (
        <p className="error-banner" role="alert">
          Draft refused: {error}
        </p>
      ) : null}
    </form>
  );
}
