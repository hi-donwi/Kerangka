/**
 * Kerangka views as UIDL screens, compiled through uidl-runtime's page recipes (ADR-0045).
 *
 * A screen is compiled when it is asked for, not once at build time: the form recipe takes the
 * record it edits (its data and its optimistic-concurrency version) and is either a create or an
 * edit document, so a form for `INV-1` is compiled with `INV-1` in it. Lists compile the same way,
 * for symmetry and so the shell can mark the current route.
 *
 * Kerangka decides; UIDL renders (PLAN.md §4). Everything this emits that writes goes through
 * `mutate` (create, update, transition) on the model's own entities and operations, which the
 * `@kerangka/uidl` bridge already sends to the server, where permissions and rules are enforced.
 *
 * A dashboard is compiled with the values its host computed for the caller (ADR-0045): a KPI is
 * an aggregate over every record the caller may read, which neither a page of rows nor a filter
 * the bridge can express is enough to compute, so the server evaluates it and this prints it.
 */

import type { FieldDefinition, KIRDocument } from "@kerangka/compiler";
import {
  compileDashboardPage,
  compileFormPage,
  compileListPage,
  wrapInShell,
  type DashboardKpi,
  type FieldMeta,
  type FieldWidget,
  type FormPageMeta,
  type HostCapabilities,
  type ListPageMeta,
  type LocalizedText,
  type RoutePolicy,
  type ShellMeta,
  type StateTransition,
} from "uidl-runtime/recipes";

/** The document type the recipes return, without importing the React-bearing entry. */
export type Screen = ReturnType<typeof compileListPage>;

export interface ProjectorOptions {
  /** Labels and chrome language. Default "en". */
  lang?: "id" | "en";
}

export type ScreenKind = "list" | "form" | "dashboard";

export type ScreenView =
  | {
      /** The view id: a declared view, or a scaffold such as `invoice-list`. */
      id: string;
      kind: "list" | "form";
      entity: string;
      /** The route a host serves it at: `/{id}` for a list, `/{id}/:id` for a form. */
      route: string;
      sections?: string[][];
      sectionTitles?: string[];
    }
  | {
      id: string;
      kind: "dashboard";
      /** `/` for `home`, `/{id}` otherwise, as the shell links it. */
      route: string;
    };

/** One entry of a dashboard view, as the model declares it (`views.<id>.dashboard[]`). */
export interface KpiEntry {
  kpi?: string;
  count?: string;
  sum?: string;
  avg?: string;
  where?: string;
}

/**
 * What the host computed for one KPI: its value, nothing the actor may see (the KPI is left
 * out), or a failure to evaluate it (the KPI shows no number; the reason stays on the server).
 */
export type KpiResult = { value: number } | { withheld: true } | { error: string };

/** A stored record to edit: its fields and the version the server issued with them. */
export interface RecordToEdit {
  id: string;
  data: Record<string, unknown>;
  version?: number;
}

type ViewDef = Record<string, unknown>;

const humanize = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const both = (text: string): LocalizedText => ({ id: text, en: text });

export class RecipeProjector {
  private readonly lang: "id" | "en";
  private readonly screens: ScreenView[];

  constructor(
    private readonly kir: KIRDocument,
    options: ProjectorOptions = {}
  ) {
    this.lang = options.lang ?? "en";
    this.screens = this.collectScreens();
  }

  /** Every screen this model projects, declared views first in their order, then scaffolds. */
  views(): ScreenView[] {
    return this.screens.map((s) => ({ ...s }));
  }

  view(id: string): ScreenView | undefined {
    return this.screens.find((s) => s.id === id);
  }

  /** The KPIs of a dashboard view, in order, for the host to compute. */
  kpis(viewId: string): KpiEntry[] {
    this.require(viewId, "dashboard");
    const declared = (this.kir.views?.[viewId] ?? {}) as ViewDef;
    return (declared.dashboard as KpiEntry[]).map((kpi) => ({ ...kpi }));
  }

  /**
   * The dashboard screen for a dashboard view, with one result per KPI in `kpis(viewId)`. The
   * values are the caller's: the host computed each over the records that caller may read.
   */
  dashboard(viewId: string, results: KpiResult[]): Screen {
    const view = this.require(viewId, "dashboard");
    const entries = this.kpis(viewId);
    if (results.length !== entries.length) {
      throw new Error(`Dashboard '${viewId}' has ${entries.length} KPIs; ${results.length} results were given`);
    }
    const kpis: DashboardKpi[] = [];
    entries.forEach((entry, index) => {
      const result = results[index]!;
      if ("withheld" in result) return;
      kpis.push({
        label: both(entry.kpi ?? `KPI ${index + 1}`),
        value: "value" in result ? result.value : "\u2014",
        format: this.kpiFormat(entry),
      });
    });
    const document = compileDashboardPage(
      { name: viewId, label: both(humanize(viewId)), kpis },
      { hostCapabilities: this.capabilities(), uiPolicy: { lang: this.lang }, docId: viewId }
    );
    return this.inShell({ ...document, route: view.route }, view.route);
  }

  /** The list screen for a list view. */
  list(viewId: string): Screen {
    const view = this.require(viewId, "list");
    const entity = this.kir.entities[view.entity]!;
    const declared = (this.kir.views?.[viewId] ?? {}) as ViewDef;
    const fields = this.fieldsOf(view.entity);
    const declaredColumns = Array.isArray(declared.columns) ? (declared.columns as string[]) : undefined;
    const columnNames = (declaredColumns ?? fields.map((f) => f.key))
      .filter((name) => !name.includes(".") && entity.fields[name]?.type !== "list")
      .slice(0, declaredColumns ? undefined : 5);
    const meta: ListPageMeta = {
      name: view.entity,
      label: both(humanize(viewId)),
      titleField: columnNames[0] ?? "id",
      fields,
      columns: columnNames.map((field) => ({ field })),
      defaultSort: { field: columnNames[0] ?? "id", dir: "asc" },
    };
    const formView = this.formFor(view.entity, typeof declared.open === "string" ? declared.open : undefined);
    const document = compileListPage(meta, {
      hostCapabilities: this.capabilities(),
      uiPolicy: { lang: this.lang },
      routePolicy: this.routes(viewId, formView?.id),
      docId: viewId,
      // A row opens the form at the route the bridge decorated it with (`withRowRoutes`).
      rowOpenActions: [{ navigate: { route: { $bind: "event.route" } } }],
      createNewActions: formView ? [{ navigate: { route: `/${formView.id}/new` } }] : [],
    });
    return this.inShell({ ...document, route: view.route }, `/${viewId}`);
  }

  /**
   * The form screen for a form view: a create document without `record`, an edit document for
   * the record given. Its workflow transitions and its input-free actions become buttons that
   * `mutate` the record; each shows only in the states the transition leaves from.
   */
  form(viewId: string, record?: RecordToEdit): Screen {
    const view = this.require(viewId, "form");
    const entity = this.kir.entities[view.entity]!;
    const declared = (this.kir.views?.[viewId] ?? {}) as ViewDef;
    const sections = Array.isArray(declared.sections) ? (declared.sections as string[][]) : undefined;
    const fields = this.fieldsOf(view.entity, sections, declared.sectionTitles as string[] | undefined);
    const meta: FormPageMeta = {
      name: view.entity,
      label: both(humanize(view.entity)),
      titleField: fields[0]?.key ?? "id",
      fields,
      ...(this.statesOf(view.entity) ? { states: this.statesOf(view.entity)! } : {}),
    };
    const listView = this.listFor(view.entity);
    const document = compileFormPage(meta, record ? record.id : "new", {
      hostCapabilities: this.capabilities(),
      uiPolicy: { lang: this.lang },
      routePolicy: this.routes(listView?.id, viewId),
      docId: record ? `${viewId}-${record.id}` : `${viewId}-new`,
      listRoute: listView ? `/${listView.id}` : "/",
      ...(record ? { initialData: record.data } : {}),
      ...(record?.version !== undefined ? { initialVersion: record.version } : {}),
      extraHeaderActions: record ? this.actionButtons(view.entity, entity) : [],
    });
    const route = record ? `/${viewId}/${record.id}` : `/${viewId}/new`;
    return this.inShell({ ...document, route }, listView ? `/${listView.id}` : route);
  }

  // ------------------------------------------------------------------ internals

  private collectScreens(): ScreenView[] {
    const screens: ScreenView[] = [];
    const views = (this.kir.views ?? {}) as Record<string, ViewDef>;
    for (const [id, def] of Object.entries(views)) {
      if (Array.isArray(def.dashboard)) {
        screens.push({ id, kind: "dashboard", route: id === "home" ? "/" : `/${id}` });
      } else if (typeof def.list === "string" && this.kir.entities[def.list]) {
        screens.push({ id, kind: "list", entity: def.list, route: `/${id}` });
      } else if (typeof def.form === "string" && this.kir.entities[def.form]) {
        const formScreen: {
          id: string;
          kind: "form";
          entity: string;
          route: string;
          sections?: string[][];
          sectionTitles?: string[];
        } = {
          id,
          kind: "form",
          entity: def.form,
          route: `/${id}/:id`,
        };
        if (Array.isArray(def.sections)) formScreen.sections = def.sections as string[][];
        if (Array.isArray(def.sectionTitles)) formScreen.sectionTitles = def.sectionTitles as string[];
        screens.push(formScreen);
      }
    }
    // The same scaffolds the compiler's generator makes for an entity with no view of its own.
    for (const [name, entity] of Object.entries(this.kir.entities)) {
      if (entity.embedded) continue;
      const base = name.toLowerCase();
      if (!screens.some((s) => s.kind === "list" && s.entity === name)) {
        screens.push({ id: `${base}-list`, kind: "list", entity: name, route: `/${base}-list` });
      }
      if (!screens.some((s) => s.kind === "form" && s.entity === name)) {
        screens.push({ id: `${base}-form`, kind: "form", entity: name, route: `/${base}-form/:id` });
      }
    }
    return screens;
  }

  private require(viewId: string, kind: "dashboard"): Extract<ScreenView, { kind: "dashboard" }>;
  private require(viewId: string, kind: "list" | "form"): Exclude<ScreenView, { kind: "dashboard" }>;
  private require(viewId: string, kind: ScreenKind): ScreenView {
    const view = this.view(viewId);
    if (!view) throw new ScreenNotFoundError(`No screen '${viewId}' in this model`);
    if (view.kind !== kind) throw new ScreenNotFoundError(`Screen '${viewId}' is a ${view.kind}, not a ${kind}`);
    return view;
  }

  /** A count is a whole number; a sum of whole numbers is too; anything else is a number. */
  private kpiFormat(entry: KpiEntry): DashboardKpi["format"] {
    if (typeof entry.count === "string") return "integer";
    const source = entry.sum ?? entry.avg ?? "";
    const [entity, field] = source.split(".");
    const type = entity && field ? this.kir.entities[entity]?.fields[field]?.type : undefined;
    return typeof entry.sum === "string" && (type === "int" || type === "integer") ? "integer" : "number";
  }

  private formFor(entity: string, preferred?: string): ScreenView | undefined {
    const named = preferred ? this.view(preferred) : undefined;
    if (named?.kind === "form") return named;
    return this.screens.find((s) => s.kind === "form" && s.entity === entity);
  }

  private listFor(entity: string): ScreenView | undefined {
    return this.screens.find((s) => s.kind === "list" && s.entity === entity);
  }

  private routes(listViewId: string | undefined, formViewId: string | undefined): RoutePolicy {
    return {
      ...(listViewId ? { resolveListRoute: () => `/${listViewId}` } : {}),
      ...(formViewId ? { resolveFormRoute: (_meta, id) => `/${formViewId}/${id}` } : {}),
    };
  }

  /** What the screens may name: every entity, and every transition and action of the model. */
  private capabilities(): HostCapabilities {
    const collections = Object.entries(this.kir.entities)
      .filter(([, e]) => !e.embedded)
      .map(([name]) => name);
    const transitions = new Set<string>();
    for (const entity of Object.values(this.kir.entities)) {
      for (const name of Object.keys(entity.workflow?.transitions ?? {})) transitions.add(name);
      for (const name of Object.keys(entity.actions ?? {})) transitions.add(name);
    }
    return { collections, commands: [], transitions: [...transitions] };
  }

  private fieldsOf(entityName: string, sections?: string[][], sectionTitles?: string[]): FieldMeta[] {
    const entity = this.kir.entities[entityName]!;
    const sectionOf = new Map<string, string>();
    sections?.forEach((names, index) => names.forEach((name) => sectionOf.set(name, sectionTitles?.[index]?.trim() ?? `section-${index + 1}`)));
    const order = sections ? sections.flat() : Object.keys(entity.fields);
    const out: FieldMeta[] = [];
    for (const key of order) {
      const field = entity.fields[key];
      if (!field || key === "id") continue;
      const meta = fieldMeta(key, field);
      if (!meta) continue;
      out.push({ ...meta, ...(sectionOf.has(key) ? { section: sectionOf.get(key)! } : {}) });
    }
    return out;
  }

  private statesOf(entityName: string): FormPageMeta["states"] | undefined {
    const workflow = this.kir.entities[entityName]?.workflow;
    if (!workflow) return undefined;
    const states = workflow.states ?? [];
    const transitions: StateTransition[] = Object.entries(workflow.transitions ?? {}).map(([name, t]) => ({
      name,
      label: both(humanize(name)),
      from: Array.isArray(t.from) ? t.from : [t.from],
      to: t.to,
    }));
    return {
      field: workflow.field ?? "status",
      values: states,
      initial: workflow.initial ?? states[0] ?? "",
      transitions,
    };
  }

  /** An action with no input is one click; one with input needs a form of its own, so it is left out. */
  private actionButtons(entityName: string, entity: KIRDocument["entities"][string]) {
    return Object.entries(entity.actions ?? {})
      .filter(([, action]) => !action.input || Object.keys(action.input).length === 0)
      .map(([name]) => ({
        id: `action-${name}`,
        type: "Button",
        props: { label: humanize(name), variant: "secondary" },
        events: {
          onClick: [
            {
              mutate: {
                operation: "transition",
                collection: entityName,
                id: { $expr: { path: "state.id" } },
                transition: name,
                version: { $expr: { path: "state._meta.version" } },
                statusPath: "formStatus",
                resultPath: "savedRecord",
                errorPath: "formError",
                fieldErrorsPath: "formErrors",
              },
            },
          ],
        },
      }));
  }

  private inShell(document: Screen, currentRoute: string): Screen {
    const navigation = this.kir.navigation;
    if (!Array.isArray(navigation) || navigation.length === 0) return document;
    const items = navigation
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, label: both(humanize(id)), route: id === "home" ? "/" : `/${id}` }));
    const meta: ShellMeta = {
      name: this.kir.app,
      title: both(String(this.kir.meta?.title ?? humanize(this.kir.app))),
      items,
    };
    return wrapInShell(document, meta, {
      hostCapabilities: this.capabilities(),
      uiPolicy: { lang: this.lang },
      currentRoute,
    });
  }
}

export class ScreenNotFoundError extends Error {
  readonly code = "SCREEN_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "ScreenNotFoundError";
  }
}

/**
 * A default the form can show as it is. `today()` or `actor.id` is an expression the engine
 * evaluates when the record is created; shown in a form it would be saved as that text.
 */
function isLiteralDefault(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  return typeof value === "string" && !/[().]/.test(value);
}

/** How one compiled Kerangka field is edited and printed. A list of embedded rows is left out. */
export function fieldMeta(key: string, field: FieldDefinition): FieldMeta | undefined {
  const label = both(humanize(key));
  const base = {
    key,
    label,
    ...(field.required ? { required: true } : {}),
    ...(field.compute !== undefined ? { readOnly: true } : {}),
    ...(isLiteralDefault(field.default) ? { default: field.default } : {}),
  };
  const widget = (w: FieldWidget, extra: Partial<FieldMeta> = {}): FieldMeta => ({ ...base, widget: w, ...extra });
  switch (field.type) {
    case "list":
      return undefined;
    case "bool":
    case "boolean":
      return widget("Checkbox");
    case "enum":
      return widget("Select", { options: (field.values ?? []).map((v) => ({ value: v, label: humanize(v) })) });
    case "decimal":
      return widget("Currency", { format: "number" });
    case "int":
    case "integer":
    case "float":
      return widget("TextField", { format: "number" });
    case "date":
    case "datetime":
      return widget("Date", { format: "date" });
    case "text":
      return widget("Textarea");
    case "ref":
      return field.target ? widget("Link", { options: { doctype: field.target, valueKey: "id", labelKey: "id" } }) : widget("TextField");
    default:
      return widget("TextField");
  }
}
