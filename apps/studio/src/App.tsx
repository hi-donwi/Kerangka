import { startTransition, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useStudio } from "./useStudio";
import { SourceEditor, SourceView } from "./SourceView";
import {
  canRedo,
  canUndo,
  currentStep,
  openHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  unsavedHistory,
  type DraftHistory,
} from "./draft-history";
import { PreviewFrame } from "./PreviewFrame";
import { ProjectExplorer, type Selection } from "./ProjectExplorer";
import { EntityInspector } from "./EntityInspector";
import { FormSectionInspector } from "./FormSectionInspector";
import { WorkflowGraph } from "./WorkflowGraph";
import { AccessMatrix } from "./AccessMatrix";
import { MaterializePage } from "./MaterializePage";
import { ScenarioPanel } from "./ScenarioPanel";
import { BundleTools } from "./BundleTools";
import { EjectPanel } from "./EjectPanel";
import { RouteInspector } from "./RouteInspector";
import { ComponentTree } from "./ComponentTree";
import { BindingInspector } from "./BindingInspector";
import { ThemeInspector } from "./ThemeInspector";
import { StatementInspector } from "./StatementInspector";
import { DecisionTable } from "./DecisionTable";
import { EventPolicy } from "./EventPolicy";
import { ConnectorInspector } from "./ConnectorInspector";
import { ConnectorPolicy } from "./ConnectorPolicy";
import { SchemaImpact } from "./SchemaImpact";
import { BuildManifest } from "./BuildManifest";
import { RecoveryPanel } from "./RecoveryPanel";
import { AiProposal } from "./AiProposal";
import { ControlPlane } from "./ControlPlane";
import { ReviewPanel } from "./ReviewPanel";
import { ScaleBudget } from "./ScaleBudget";
import { AuditPanel } from "./AuditPanel";
import { RestorePanel } from "./RestorePanel";
import { TargetProfile } from "./TargetProfile";
import { ApiExplorer } from "./ApiExplorer";
import { runScenarioRequest } from "./studio-api";
import { TransitionEditor } from "./TransitionEditor";
import { JourneyWorkbench, ModelWorkbench, NodeInspector, WorkbenchModeBar } from "./workbench-panels.js";
import type { WorkbenchMode } from "./workbench-modes.js";
import { Diagnostics } from "./Diagnostics";
import { StudioConflict, StudioSaveRefused } from "./studio-api";
import type { SourceText } from "../../../packages/studio-server/src/contracts.js";

type Tab = "definition" | "openapi" | "postgres" | "sqlite" | "preview";
const tabs: Array<[Tab, string]> = [
  ["definition", "Definition"],
  ["preview", "Preview"],
  ["openapi", "REST API"],
  ["postgres", "PostgreSQL"],
  ["sqlite", "SQLite"],
];

/** A previewed draft the operator can save, and the disk revision it was based on. */
interface DraftState {
  busy: boolean;
  spent: boolean;
  baseRevision: string | null;
  sources: Record<string, SourceText> | null;
  error: string | null;
  notice: string | null;
}

/** A save that lost a race, with both versions so the operator can choose. */
interface ConflictState {
  revision: string;
  sources: Record<string, SourceText>;
  draftSources: Record<string, SourceText>;
}

const emptyDraft: DraftState = { busy: false, spent: false, baseRevision: null, sources: null, error: null, notice: null };

export function App() {
  const studio = useStudio();
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [access, setAccess] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>("definition");
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState<DraftHistory | null>(null);
  const [scenarioResult, setScenarioResult] = useState<unknown>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [awaitingDisk, setAwaitingDisk] = useState(false);
  /** The node selected inside the preview, so the console can show where the author is. */
  const [previewSelection, setPreviewSelection] = useState<string | null>(null);
  /** Which way of working the console is showing. It never changes the source. */
  const [mode, setMode] = useState<WorkbenchMode>("page");
  /** The workflow state picked on the canvas. It is a view of the model, not an edit. */
  const [workflowState, setWorkflowState] = useState<string | null>(null);
  const response = studio.response;
  const inspection = response?.inspection;
  const writable = response?.writable === true;
  const selected = selection ?? (response ? { kind: "source" as const, id: response.bundle.entry } : null);
  const entity =
    selected?.kind === "entity" ? inspection?.entities.find((item) => item.name === selected.id) : undefined;
  const screen = selected?.kind === "screen" ? inspection?.screens.find((item) => item.id === selected.id) : undefined;
  const source = selected?.kind === "source" ? response?.bundle.sources[selected.id] : undefined;
  const missing = Boolean(selected && !source && !entity && !screen);
  const unsaved = history ? unsavedHistory(history) : draft.spent;
  const refresh = () => {
    setAwaitingDisk(true);
    setHistory(null);
    setDraft(emptyDraft);
    setConflict(null);
    setFlash(null);
    studio.reload();
  };
  useEffect(() => {
    if (!response || studio.loading || history || awaitingDisk) return;
    setHistory(openHistory(response, selection));
  }, [response, studio.loading, history, selection, awaitingDisk]);
  const sawReload = useRef(false);
  useEffect(() => {
    if (!awaitingDisk) return;
    if (studio.loading) sawReload.current = true;
    if (!sawReload.current || studio.loading || !response) return;
    setHistory(openHistory(response, null));
    setAwaitingDisk(false);
    sawReload.current = false;
  }, [awaitingDisk, studio.loading, response]);
  const adoptHistory = (nextHistory: DraftHistory) => {
    const step = currentStep(nextHistory);
    setHistory(nextHistory);
    studio.show(step.response);
    setSelection(step.selection);
    setDraft({
      busy: false,
      spent: unsavedHistory(nextHistory),
      baseRevision: nextHistory.baseRevision,
      sources: unsavedHistory(nextHistory) ? step.response.bundle.sources : null,
      error: null,
      notice: step.label === "Opened" ? null : step.label,
    });
    setConflict(null);
  };
  const undo = () => {
    if (!history || !canUndo(history) || draft.busy) return;
    adoptHistory(undoHistory(history));
  };
  const redo = () => {
    if (!history || !canRedo(history) || draft.busy) return;
    adoptHistory(redoHistory(history));
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
        return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const remember = (nextHistory: DraftHistory, notice: string) => {
    const step = currentStep(nextHistory);
    setHistory(nextHistory);
    studio.show(step.response);
    setSelection(step.selection);
    setDraft({
      busy: false,
      spent: unsavedHistory(nextHistory),
      baseRevision: nextHistory.baseRevision,
      sources: unsavedHistory(nextHistory) ? step.response.bundle.sources : null,
      error: null,
      notice,
    });
    setConflict(null);
    setFlash(null);
  };
  const addField = async (field: string, definition: string) => {
    if (!response || !entity || !history) return;
    const base = history.baseRevision;
    const currentSources = unsavedHistory(history) ? currentStep(history).response.bundle.sources : undefined;
    setDraft((state) => ({ ...state, busy: true, error: null }));
    setConflict(null);
    try {
      const next = await studio.applyDraft({
        expectedRevision: base,
        operations: [{ op: "addEntityField", entity: entity.name, field, definition }],
        ...(currentSources ? { sources: currentSources } : {}),
      });
      setTab("definition");
      if (next.applied.length === 0) {
        setDraft((state) => ({
          ...state,
          busy: false,
          error: next.diagnostics.find((item) => item.severity === "error")?.message ?? "The draft could not be applied.",
        }));
        return;
      }
      remember(
        pushHistory(history, {
          label: next.applied.join(", "),
          selection: { kind: "entity", id: entity.name },
          response: next,
        }),
        `${next.applied.join(", ")} - preview only; the file on disk is unchanged.`,
      );
    } catch (error) {
      if (error instanceof StudioConflict) {
        setDraft(emptyDraft);
        studio.reload();
        return;
      }
      setDraft({
        busy: false,
        spent: false,
        baseRevision: null,
        sources: null,
        error: error instanceof Error ? error.message : "The draft could not be applied.",
        notice: null,
      });
    }
  };
  const setTransition = async (entityName: string, transition: string, next: { from: string[]; to: string; roles: string[]; when?: string }) => {
    if (!response || !history) return;
    const currentSources = unsavedHistory(history) ? currentStep(history).response.bundle.sources : undefined;
    setDraft((state) => ({ ...state, busy: true, error: null }));
    try {
      const result = await studio.applyDraft({
        expectedRevision: history.baseRevision,
        operations: [{ op: "setTransition", entity: entityName, transition, ...next }],
        ...(currentSources ? { sources: currentSources } : {}),
      });
      if (result.applied.length === 0) {
        setDraft((state) => ({
          ...state,
          busy: false,
          error: result.diagnostics.find((item) => item.severity === "error")?.message ?? "The transition could not be applied.",
        }));
        return;
      }
      remember(
        pushHistory(history, {
          label: result.applied.join(", "),
          selection: { kind: "entity", id: entityName },
          response: result,
        }),
        `${result.applied.join(", ")} - preview only; the file on disk is unchanged.`,
      );
    } catch (error) {
      setDraft((state) => ({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : "The transition could not be applied.",
      }));
    }
  };
  const setFormSections = async (view: string, sections: string[][], sectionTitles: string[]) => {
    if (!response || !history || !screen) return;
    const currentSources = unsavedHistory(history) ? currentStep(history).response.bundle.sources : undefined;
    setDraft((state) => ({ ...state, busy: true, error: null }));
    try {
      const next = await studio.applyDraft({
        expectedRevision: history.baseRevision,
        operations: [{ op: "setFormSections", view, sections, sectionTitles }],
        ...(currentSources ? { sources: currentSources } : {}),
      });
      if (next.applied.length === 0) {
        setDraft((state) => ({
          ...state,
          busy: false,
          error: next.diagnostics.find((item) => item.severity === "error")?.message ?? "The section layout could not be applied.",
        }));
        return;
      }
      remember(
        pushHistory(history, {
          label: next.applied.join(", "),
          selection: { kind: "screen", id: screen.id },
          response: next,
        }),
        `${next.applied.join(", ")} - preview regenerated; emitted UIDL was not written.`,
      );
      setTab("preview");
    } catch (error) {
      setDraft((state) => ({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : "The section layout could not be applied.",
      }));
    }
  };
  const applySource = async (path: string, text: string) => {
    if (!response || !history) return;
    const sources = {
      ...(unsavedHistory(history) ? currentStep(history).response.bundle.sources : response.bundle.sources),
      [path]: { format: "json" as const, text },
    };
    setDraft((state) => ({ ...state, busy: true, error: null }));
    try {
      const next = await studio.applyDraft({ expectedRevision: history.baseRevision, operations: [], sources });
      if (!next.applied.length) {
        setDraft((state) => ({ ...state, busy: false, error: "The source text did not change." }));
        return;
      }
      remember(
        pushHistory(history, {
          label: next.applied.join(", "),
          selection: { kind: "source", id: path },
          response: next,
        }),
        `${next.applied.join(", ")} - preview only; the file on disk is unchanged.`,
      );
    } catch (error) {
      setDraft((state) => ({
        ...state,
        busy: false,
        error: error instanceof Error ? error.message : "The source edit could not be applied.",
      }));
    }
  };
  /** Write the previewed sources back; `forceRevision` retries after the operator picks the draft. */
  const saveDraft = async (forceRevision?: string) => {
    const sources = draft.sources;
    if (!sources) return;
    setDraft((current) => ({ ...current, busy: true, error: null }));
    try {
      const next = await studio.saveDraft({ expectedRevision: forceRevision ?? draft.baseRevision ?? "", sources });
      setConflict(null);
      setFlash(`${next.saved.join(", ") || "No file"} saved to disk. The revision advanced.`);
      setHistory(openHistory(next, selection));
      setDraft(emptyDraft);
    } catch (error) {
      if (error instanceof StudioConflict && error.sources) {
        setDraft((current) => ({ ...current, busy: false }));
        setConflict({ revision: error.revision, sources: error.sources, draftSources: sources });
        return;
      }
      const message =
        error instanceof StudioSaveRefused
          ? `${error.message} ${error.diagnostics
              .filter((item) => item.severity === "error")
              .map((item) => item.message)
              .join(" ")}`
          : error instanceof Error
            ? error.message
            : "The draft could not be saved.";
      setDraft((current) => ({ ...current, busy: false, error: message.trim() }));
    }
  };
  /** After a conflict, keep the file that won and drop the draft. */
  const takeDiskVersion = () => {
    setDraft(emptyDraft);
    setConflict(null);
    setFlash("The file on disk was kept. The draft was discarded.");
    studio.reload();
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
        <span className="mode-badge">{writable ? "WRITABLE HOST" : "READ ONLY"}</span>
        {unsaved ? (
          <span className="draft-badge" role="status">
            UNSAVED DRAFT
          </span>
        ) : null}
        <span className="local-label">LOCAL WORKBENCH / P2</span>
        {history ? (
          <>
            <button className="history-button" onClick={undo} disabled={!canUndo(history) || draft.busy}>
              Undo
            </button>
            <button className="history-button" onClick={redo} disabled={!canRedo(history) || draft.busy}>
              Redo
            </button>
          </>
        ) : null}
        {writable && unsaved && !conflict ? (
          <button className="save-button" onClick={() => void saveDraft()} disabled={draft.busy || studio.loading}>
            {draft.busy ? "Saving..." : "Save draft"}
          </button>
        ) : null}
        {unsaved ? (
          <button className="refresh-button" onClick={refresh} disabled={draft.busy}>
            Discard
          </button>
        ) : null}
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
          {flash && !conflict && (
            <p className="status-banner" role="status">
              {flash}
            </p>
          )}
          {conflict && (
            <section className="conflict-panel" role="alert" aria-label="Revision conflict">
              <p className="eyebrow">REVISION CONFLICT</p>
              <h2>The model changed on disk since this draft was opened.</h2>
              <p>
                Nothing was overwritten. Choose which version becomes the file on disk; the other one stays only in
                this session until you decide.
              </p>
              {Object.keys(conflict.draftSources)
                .filter((path) => conflict.sources[path] && conflict.draftSources[path]?.text !== conflict.sources[path]?.text)
                .map((path) => (
                  <div key={path} className="conflict-file">
                    <h3>{path}</h3>
                    <div className="conflict-versions">
                      <div>
                        <p className="eyebrow">YOUR DRAFT</p>
                        <SourceView text={conflict.draftSources[path]?.text ?? ""} label={`Draft ${path}`} />
                      </div>
                      <div>
                        <p className="eyebrow">FILE ON DISK</p>
                        <SourceView text={conflict.sources[path]?.text ?? ""} label={`Disk ${path}`} />
                      </div>
                    </div>
                  </div>
                ))}
              <div className="conflict-actions">
                <button
                  className="save-button"
                  onClick={() => void saveDraft(conflict.revision)}
                  disabled={draft.busy || studio.loading}
                >
                  {draft.busy ? "Saving..." : "Overwrite with my draft"}
                </button>
                <button className="refresh-button" onClick={takeDiskVersion} disabled={draft.busy}>
                  Keep the file on disk
                </button>
              </div>
              {draft.error ? (
                <p className="error-banner" role="alert">
                  Save refused: {draft.error}
                </p>
              ) : null}
            </section>
          )}
          <div className="workbench">
            <ProjectExplorer response={response} selected={selected} onSelect={select} />
            <main className="inspection-pane">
              <WorkbenchModeBar mode={mode} onChange={setMode} />
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
              <div hidden={mode !== "page"}>
              {screen?.kind === "form" ? (
                <MaterializePage
                  view={screen.label}
                  sourceText={response?.bundle.sources[response.bundle.entry]?.text ?? ""}
                  document={screen.document}
                  onMaterialize={(path, text) => {
                    void (async () => {
                      const currentSources = unsavedHistory(history ?? openHistory(response, selection)) ? currentStep(history!).response.bundle.sources : response.bundle.sources;
                      const next = await studio.applyDraft({
                        expectedRevision: (history ?? openHistory(response, selection)).baseRevision,
                        operations: [],
                        sources: { ...currentSources, [path]: { format: "json", text } },
                      });
                      if (next.applied.length) remember(pushHistory(history ?? openHistory(response, selection), { label: next.applied.join(", "), selection: { kind: "screen", id: screen.id }, response: next }), "Page materialized as authored source.");
                    })();
                  }}
                />
              ) : null}
              {screen?.kind === "form" && screen.sections && screen.sectionTitles ? (
                <FormSectionInspector
                  key={`${response.bundle.revision}:${screen.id}`}
                  view={screen.label}
                  sections={screen.sections}
                  sectionTitles={screen.sectionTitles}
                  busy={draft.busy}
                  error={draft.error}
                  onApply={(sections, sectionTitles) => void setFormSections(screen.label, sections, sectionTitles)}
                />
              ) : null}
              </div>
              <section
                id="workbench-content"
                className="inspection-content"
                role="tabpanel"
                aria-labelledby={`mode-${mode}`}
                hidden={mode !== "page"}
              >
                <div className="workbench-views">
                  <NodeInspector screen={screen} nodeId={previewSelection} />
                </div>
              </section>
              {mode === "model" ? (
                <section id="model-content" className="inspection-content" aria-label="Model view">
                  <ModelWorkbench
                    inspection={inspection ?? null}
                    selectedState={workflowState}
                    onSelectState={setWorkflowState}
                  />
                </section>
              ) : null}
              {mode === "journey" ? (
                <section id="journey-content" className="inspection-content" aria-label="Journey view">
                  <JourneyWorkbench />
                </section>
              ) : null}
              <section
                id="inspection-content"
                className="inspection-content"
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
                hidden={mode !== "page"}
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
                    {source && selected?.line ? <SourceView text={source.text} line={selected.line} /> : null}
                    {source && selected?.kind === "source" ? (
                      <SourceEditor
                        text={source.text}
                        format={source.format}
                        busy={draft.busy}
                        onApply={(text) => void applySource(selected.id, text)}
                      />
                    ) : null}
                    {entity && (
                      <>
                        <EntityInspector
                          entity={entity}
                          roles={inspection?.roles ?? []}
                          draft={draft}
                          onAddField={addField}
                          onOpenSource={() =>
                            select({ kind: "source", id: response.bundle.entry, pointer: entity.pointer })
                          }
                        />
                        {entity.operations.some((item) => item.kind === "transition") ? (
                          <>
                            <WorkflowGraph entity={entity} />
                            {entity.operations
                              .filter((item) => item.kind === "transition")
                              .map((item) => (
                                <TransitionEditor
                                  key={item.name}
                                  entity={entity.name}
                                  transition={item.name}
                                  from={item.from ?? []}
                                  to={item.to ?? ""}
                                  roles={item.roles}
                                  when={undefined}
                                  allStates={Array.from(
                                    new Set(entity.operations.flatMap((operation) => [...(operation.from ?? []), operation.to ?? ""]).filter(Boolean)),
                                  )}
                                  allRoles={inspection?.roles ?? []}
                                  busy={draft.busy}
                                  error={draft.error}
                                  onApply={(next) => void setTransition(entity.name, item.name, next)}
                                />
                              ))}
                          </>
                        ) : null}
                    {entity.permissions ? (
                      <AccessMatrix
                        entity={entity}
                        roles={inspection?.roles ?? []}
                        onOpenSource={() =>
                          select({ kind: "source", id: response.bundle.entry, pointer: entity.pointer })
                        }
                      />
                    ) : null}
                    {entity ? <ComponentTree entity={entity} /> : null}
                    {entity ? <BindingInspector entity={entity} /> : null}
                    <ThemeInspector />
                    {entity ? <StatementInspector entity={entity} /> : null}
                    {entity ? <DecisionTable entity={entity} /> : null}
                    {entity ? <EventPolicy entity={entity} /> : null}
                    {entity ? <ConnectorInspector entity={entity} /> : null}
                    <ConnectorPolicy />
                    {studio.authorized && token ? <BundleTools token={token} onImported={() => studio.reload()} /> : null}
                    {response ? <EjectPanel modelPath={response.bundle.entry} /> : null}
                    {response ? <RouteInspector response={response} /> : null}
                    {response ? <SchemaImpact response={response} /> : null}
                    <BuildManifest />
                    <RecoveryPanel />
                    <AiProposal />
                    <ControlPlane />
                    <ReviewPanel />
                    <ScaleBudget />
                    <AuditPanel />
                    <RestorePanel />
                    <TargetProfile />
                    {response ? <ApiExplorer response={response} /> : null}
                    {entity.operations.length ? (
                      <ScenarioPanel
                        entity={entity.name}
                        operations={entity.operations.map((item) => item.name)}
                        recordText={JSON.stringify(
                          Object.fromEntries(entity.fields.map((field) => [field.name, field.type === "int" ? 1 : ""])),
                          null,
                          2,
                        )}
                        actorText={JSON.stringify({ roles: inspection?.roles?.slice(0, 1) ?? [] }, null, 2)}
                        busy={scenarioBusy}
                        result={scenarioResult}
                        onRun={(operation, record, actor) => {
                          if (!studio.authorized) return;
                          const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
                          const sourceText = response.bundle.sources[response.bundle.entry]?.text ?? "";
                          setScenarioBusy(true);
                          void runScenarioRequest(token, { source: sourceText, entity: entity.name, operation, record, actor })
                            .then((result) => setScenarioResult(result))
                            .catch((error) => setScenarioResult({ ok: false, error: error instanceof Error ? error.message : "Scenario failed." }))
                            .finally(() => setScenarioBusy(false));
                        }}
                      />
                    ) : null}
                      </>
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
                      onSelectNode={setPreviewSelection}
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
              {draft.busy && draft.spent
                ? "Saving draft to disk..."
                : studio.loading
                  ? "Inspecting refreshed source..."
                  : studio.error
                    ? "Previous snapshot / refresh failed"
                    : unsaved
                      ? "Unsaved draft preview / file unchanged"
                      : writable
                        ? "Writable snapshot / saves rewrite the model file"
                        : "Read-only snapshot / synthetic preview"}
            </span>
            <span>NO LIVE CONNECTORS</span>
            <a href="./assets/licenses.md" target="_blank" rel="noreferrer noopener">
              Third-party notices
            </a>
          </footer>
        </>
      )}
    </div>
  );
}
