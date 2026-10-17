import { startTransition, useState, type FormEvent, type KeyboardEvent } from "react";
import { useStudio } from "./useStudio";
import { SourceView } from "./SourceView";
import { PreviewFrame } from "./PreviewFrame";
import { ProjectExplorer, type Selection } from "./ProjectExplorer";
import { EntityInspector } from "./EntityInspector";
import { Diagnostics } from "./Diagnostics";
import { StudioConflict } from "./studio-api";

type Tab = "definition" | "openapi" | "postgres" | "sqlite" | "preview";
const tabs: Array<[Tab, string]> = [
  ["definition", "Definition"],
  ["preview", "Preview"],
  ["openapi", "REST API"],
  ["postgres", "PostgreSQL"],
  ["sqlite", "SQLite"],
];

export function App() {
  const studio = useStudio();
  const [access, setAccess] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>("definition");
  const [draft, setDraft] = useState<{ busy: boolean; spent: boolean; error: string | null; notice: string | null }>({
    busy: false,
    spent: false,
    error: null,
    notice: null,
  });
  const response = studio.response;
  const inspection = response?.inspection;
  const selected = selection ?? (response ? { kind: "source" as const, id: response.bundle.entry } : null);
  const entity =
    selected?.kind === "entity" ? inspection?.entities.find((item) => item.name === selected.id) : undefined;
  const screen = selected?.kind === "screen" ? inspection?.screens.find((item) => item.id === selected.id) : undefined;
  const source = selected?.kind === "source" ? response?.bundle.sources[selected.id] : undefined;
  const missing = Boolean(selected && !source && !entity && !screen);
  const refresh = () => {
    setDraft({ busy: false, spent: false, error: null, notice: null });
    studio.reload();
  };
  const addField = async (field: string, definition: string) => {
    if (!response || !entity) return;
    setDraft({ busy: true, spent: false, error: null, notice: null });
    try {
      const next = await studio.applyDraft({
        expectedRevision: response.bundle.revision,
        operations: [{ op: "addEntityField", entity: entity.name, field, definition }],
      });
      setSelection({ kind: "entity", id: entity.name });
      setTab("definition");
      setDraft({
        busy: false,
        spent: true,
        error: null,
        notice: `${next.applied.join(", ") || "No change"} - preview only; the file on disk is unchanged.`,
      });
    } catch (error) {
      if (error instanceof StudioConflict) {
        setDraft({ busy: false, spent: false, error: null, notice: null });
        studio.reload();
        return;
      }
      setDraft({
        busy: false,
        spent: false,
        error: error instanceof Error ? error.message : "The draft could not be applied.",
        notice: null,
      });
    }
  };
  const select = (next: Selection) =>
    startTransition(() => {
      setSelection(next);
      setTab(next.kind === "screen" ? "preview" : "definition");
    });
  const authenticate = (event: FormEvent) => {
    event.preventDefault();
    studio.authenticate(access.trim());
    setAccess("");
  };
  const keyTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next]!;
    setTab(target[0]);
    document.getElementById(`tab-${target[0]}`)?.focus();
  };

  return (
    <div className="studio-shell">
      <header className="masthead">
        <button
          className="brand"
          onClick={() => {
            if (response) select({ kind: "source", id: response.bundle.entry });
          }}
          aria-label="Kerangka Studio home"
        >
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <span>
            KERANGKA <strong>STUDIO</strong>
          </span>
        </button>
        <span className="mode-badge">READ ONLY</span>
        {draft.spent ? (
          <span className="draft-badge" role="status">
            UNSAVED DRAFT
          </span>
        ) : null}
        <span className="local-label">LOCAL WORKBENCH / P1</span>
        <button className="refresh-button" onClick={refresh} disabled={!studio.authorized || studio.loading}>
          {studio.loading ? "Inspecting..." : "Refresh source"}
        </button>
      </header>
      {(!studio.authorized || (!response && studio.error)) && (
        <main className="access-panel">
          <p className="eyebrow">OPERATOR ACCESS</p>
          <h1>Open a local project.</h1>
          <p>
            Use the launch link from <code>kerangka studio &lt;model&gt;</code>, or enter its local access key. No
            project data is available without access.
          </p>
          {studio.error && (
            <p role="alert" className="error-banner">
              {studio.error}
            </p>
          )}
          <form onSubmit={authenticate}>
            <label htmlFor="access-key">Local access key</label>
            <div className="access-controls">
              <input
                id="access-key"
                type="password"
                autoComplete="off"
                value={access}
                onChange={(event) => setAccess(event.target.value)}
                required
              />
              <button type="submit">Open project</button>
            </div>
          </form>
        </main>
      )}
      {studio.authorized && !response && !studio.error && (
        <main className="loading-panel" role="status">
          <span className="eyebrow">SOURCE INSPECTION</span>
          <h1>Reading the selected project...</h1>
          <p>Files remain untouched. Validation runs in a bounded job.</p>
        </main>
      )}
      {response && (
        <>
          <section className="project-heading" aria-label="Project summary">
            <div>
              <p className="eyebrow">{response.bundle.entry}</p>
              <h1>{inspection?.title ?? "Source needs attention"}</h1>
            </div>
            <div className="project-facts">
              <span>{Object.keys(response.bundle.sources).length} sources</span>
              <span>
                {inspection?.entities.length ?? 0} {inspection?.entities.length === 1 ? "entity" : "entities"}
              </span>
              <span>{inspection?.screens.length ?? 0} screens</span>
            </div>
          </section>
          {studio.error && (
            <p className="error-banner" role="alert">
              Refresh failed: {studio.error} The previous snapshot is still shown.
            </p>
          )}
          <div className="workbench">
            <ProjectExplorer response={response} selected={selected} onSelect={select} />
            <main className="inspection-pane">
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">{selected?.kind ?? "source"}</p>
                  <h2>{entity?.name ?? screen?.label ?? selected?.id}</h2>
                </div>
                <span className="snapshot-id" title={response.bundle.revision}>
                  {response.bundle.revision.slice(0, 19)}
                </span>
              </div>
              <div className="output-tabs" role="tablist" aria-label="Inspection view">
                {tabs.map(([id, label], index) => (
                  <button
                    key={id}
                    id={`tab-${id}`}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls="inspection-content"
                    tabIndex={tab === id ? 0 : -1}
                    onKeyDown={(event) => keyTabs(event, index)}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <section
                id="inspection-content"
                className="inspection-content"
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
              >
                {missing ? (
                  <div className="empty-state">
                    <h3>Selection is no longer present.</h3>
                    <p>The source changed since this item was selected.</p>
                    <button onClick={() => select({ kind: "source", id: response.bundle.entry })}>
                      Open entry source
                    </button>
                  </div>
                ) : tab === "definition" ? (
                  <>
                    {selected?.pointer && (
                      <p className="pointer-note">
                        Source pointer <code>{selected.pointer}</code>
                      </p>
                    )}
                    {source && <SourceView text={source.text} line={selected?.line} />}
                    {entity && (
                      <EntityInspector
                        entity={entity}
                        roles={inspection?.roles ?? []}
                        draft={draft}
                        onAddField={addField}
                        onOpenSource={() =>
                          select({ kind: "source", id: response.bundle.entry, pointer: entity.pointer })
                        }
                      />
                    )}
                    {screen && (
                      <>
                        <p className="projection-note">
                          {screen.kind === "authored"
                            ? "Authored UIDL, shown without editing."
                            : "Generated UIDL, not an editable source."}{" "}
                          Route intent: <code>{screen.route || "not declared"}</code>
                        </p>
                        <SourceView text={JSON.stringify(screen.document, null, 2)} label="UIDL document" />
                      </>
                    )}
                  </>
                ) : tab === "preview" ? (
                  screen && inspection ? (
                    <PreviewFrame
                      key={`${response.bundle.revision}:${screen.id}`}
                      screen={screen}
                      revision={response.bundle.revision}
                      synthetic={inspection.synthetic}
                    />
                  ) : (
                    <div className="empty-state">
                      <h3>Select a screen to preview.</h3>
                      <p>Preview uses synthetic data only. It cannot submit, save, or call an external API.</p>
                    </div>
                  )
                ) : inspection ? (
                  <>
                    <p className="projection-note">
                      Projected{" "}
                      {tab === "openapi"
                        ? "REST contract; business endpoints are not mounted by Studio"
                        : "SQL; not applied to any database"}
                      .
                    </p>
                    <SourceView
                      label="Derived output"
                      text={tab === "openapi" ? inspection.outputs.openapi : inspection.outputs[tab]}
                    />
                  </>
                ) : (
                  <div className="empty-state">
                    <h3>No derived output.</h3>
                    <p>Resolve source diagnostics and refresh. Source remains available.</p>
                  </div>
                )}
              </section>
              <Diagnostics
                items={response.diagnostics}
                onOpen={(item) => select({ kind: "source", id: item.source, line: item.line, pointer: item.path })}
              />
            </main>
          </div>
          <footer className="status-bar">
            <span role="status">
              {studio.loading
                ? "Inspecting refreshed source..."
                : studio.error
                  ? "Previous snapshot / refresh failed"
                  : draft.spent
                    ? "Unsaved draft preview / file unchanged"
                    : "Read-only snapshot / synthetic preview"}
            </span>
            <span>NO WRITES / NO LIVE CONNECTORS</span>
            <a href="./assets/licenses.md" target="_blank" rel="noreferrer noopener">
              Third-party notices
            </a>
          </footer>
        </>
      )}
    </div>
  );
}
