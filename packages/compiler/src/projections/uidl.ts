/**
 * Kerangka UIDL Document Projection
 * Specification Version: 1.x
 * License: Apache-2.0
 *
 * Co-developed with UIDL-Runtime (https://uidl.dev).
 *
 * Documents emitted here target the UIDL 1.x contract:
 * - `version` is a value the version schema accepts ("1.0.0" is tolerated canonically "1.0").
 * - Every `{"$bind": "..."}` lives inside a node's `props` (the runtime resolves bindings from
 *   there — `renderer/RenderNode.tsx:resolveProps`), never in a separate `bindings` map, and the
 *   path starts with one of the five render scopes: `local.` `state.` `session.` `route.` `data.`
 *   (`spec/schema/binding.schema.json`). Action-time `event.*` binds resolve in the interpreter.
 * - Every event value is an **array** of actions; a single action object is skipped by the
 *   runtime and must not be emitted.
 * - Component types are drawn only from the UIDL-Runtime reference registry
 *   (`packages/core/src/registry/defaults.ts`). A type missing from the registry renders blank,
 *   so nothing here may invent one.
 * - `$query` descriptors are strict: `filters` and `sort` are arrays, `page` is `{number,size}`,
 *   `search` is a scalar, and there is no `id` key (`spec/schema/query.schema.json`).
 */

import { FieldDefinition, KIRDocument } from "../types.js";

export interface UIDLNode {
  id: string;
  type: string;
  name?: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: UIDLNode[];
  slots?: Record<string, UIDLNode[]>;
  bindings?: Record<string, unknown>;
  events?: Record<string, unknown>;
}

export interface UIDLDocument {
  $schema?: string;
  version: string;
  id: string;
  name: string;
  route?: string;
  theme?: string;
  state?: Record<string, unknown>;
  dataSources?: Record<string, unknown>;
  root: UIDLNode;
}

/** Preset styles using values the runtime's Tailwind mapper understands. */
const COLUMN_STYLE: Record<string, unknown> = { display: "flex", flexDirection: "column", gap: "gap-2" };
const ROW_STYLE: Record<string, unknown> = { display: "flex", flexDirection: "row", gap: "gap-2" };

/** A `$query` filter with the strict shape (`spec/schema/query.schema.json`). */
interface UIDLFilter {
  field: string;
  op: "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "between";
  value: unknown;
}

/** The widget types a form may use, from the reference registry only. */
type FormWidgetType = "TextField" | "Select" | "Checkbox";

export class UIDLGenerator {
  static readonly SCHEMA_URI = "https://uidl.dev/schema/v1/document.schema.json";
  static readonly SPEC_VERSION = "1.0.0";

  /**
   * Generates one UIDL document per declared view (dashboard / list / form), plus scaffold
   * list+form documents for entities that have no custom views. Every document carries a
   * `Navbar` when the app declares navigation.
   */
  static generate(kir: KIRDocument): Record<string, UIDLDocument> {
    const documents: Record<string, UIDLDocument> = {};
    const views = (kir.views || {}) as Record<string, Record<string, unknown>>;

    for (const [viewId, viewDef] of Object.entries(views)) {
      if (viewDef.dashboard) {
        documents[viewId] = UIDLGenerator.generateDashboardView(viewId, viewDef, kir);
      } else if (viewDef.list) {
        documents[viewId] = UIDLGenerator.generateListView(viewId, viewDef, kir);
      } else if (viewDef.form) {
        documents[viewId] = UIDLGenerator.generateFormView(viewId, viewDef, kir);
      }
    }

    // Auto-scaffold list/form views for entities without a custom view.
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      if (entity.embedded) continue;
      const hasCustomList = Object.values(views).some((v) => v.list === entityName);
      const hasCustomForm = Object.values(views).some((v) => v.form === entityName);
      if (!hasCustomList) documents[`${entityName.toLowerCase()}-list`] = UIDLGenerator.generateScaffoldList(entityName, kir);
      if (!hasCustomForm) documents[`${entityName.toLowerCase()}-form`] = UIDLGenerator.generateScaffoldForm(entityName, kir);
    }

    // A Navbar links the app's navigable documents, so it can only be computed once every
    // document's route is known. Prepending after generation keeps the per-view generators pure.
    for (const [viewId, doc] of Object.entries(documents)) {
      const nav = UIDLGenerator.navbarNode(kir, viewId, documents);
      if (nav.length > 0) {
        doc.root = { ...doc.root, children: [...nav, ...(doc.root.children || [])] };
      }
    }

    return documents;
  }

  // ---------------------------------------------------------------- dashboard

  private static generateDashboardView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument,
  ): UIDLDocument {
    const kpis = viewDef.dashboard as Array<Record<string, unknown>>;
    const dataSources: Record<string, unknown> = {};

    const kpiNodes: UIDLNode[] = (kpis || []).map((kpi, index) => {
      const key = `kpi-${index}`;
      const title = (kpi.kpi as string) || `KPI ${index + 1}`;
      const query = UIDLGenerator.buildKpiQuery(kpi);
      if (query) dataSources[key] = { $query: query };

      return {
        id: key,
        type: "Column" as const,
        style: { ...COLUMN_STYLE, padding: "p-4" },
        children: [
          {
            id: `${key}-label`,
            type: "Text" as const,
            props: { value: title },
          },
          {
            id: `${key}-value`,
            type: "Text" as const,
            props: { value: UIDLGenerator.buildKpiBinding(kpi, index) },
            style: { fontSize: "text-2xl", fontWeight: "font-semibold" },
          },
        ],
      };
    });

    return {
      $schema: UIDLGenerator.SCHEMA_URI,
      version: UIDLGenerator.SPEC_VERSION,
      id: viewId,
      name: `${UIDLGenerator.capitalize(viewId)} Dashboard`,
      route: viewId === "home" ? "/" : `/${viewId}`,
      ...(dataSources ? { dataSources } : {}),
      root: {
        id: `root-${viewId}`,
        type: "Container",
        children: [
          {
            id: `${viewId}-content`,
            type: "Column" as const,
            style: { ...COLUMN_STYLE, padding: "p-4" },
            children: [
              {
                id: `${viewId}-title`,
                type: "Text" as const,
                props: { value: `${UIDLGenerator.capitalize(viewId)} Dashboard`, heading: 1 },
              },
              ...(kpiNodes.length > 0
                ? [{ id: `${viewId}-kpis`, type: "Column" as const, style: COLUMN_STYLE, children: kpiNodes }]
                : []),
            ],
          },
        ],
      },
    };
  }

  /**
   * A KPI value is bound to the query envelope the bridge fills: a `sum`/`avg` lands as one
   * aggregated row (`state.$data.<kpi>.rows[0].<field>`), a `count` as the result total
   * (`state.$data.<kpi>.total`). Both read the reserved `state.$data` read-only envelope.
   */
  private static buildKpiBinding(kpi: Record<string, unknown>, index: number): Record<string, string> {
    const key = `kpi-${index}`;
    const source = String(kpi.sum || kpi.avg || kpi.count || "");
    const field = UIDLGenerator.lastSegment(source);
    if (field && kpi.count === undefined) {
      return { $bind: `state.$data.${key}.rows[0].${field}` };
    }
    return { $bind: `state.$data.${key}.total` };
  }

  /**
   * Lowers a KPI definition into a `$query` on the aggregate's collection. The `where` clause is
   * lowered only when it is a single comparison on a plain field; anything richer is left to the
   * bridge, which may enforce the predicate at the boundary.
   */
  private static buildKpiQuery(kpi: Record<string, unknown>): Record<string, unknown> | undefined {
    const source = String(kpi.sum || kpi.avg || kpi.count || "");
    const collection = UIDLGenerator.firstSegment(source);
    if (!collection) return undefined;

    const field = UIDLGenerator.lastSegment(source);
    const query: Record<string, unknown> = { collection };
    if (field && field !== collection) query.fields = [field];

    const filter = UIDLGenerator.lowerWhere(String(kpi.where || ""));
    if (filter) query.filters = [filter];

    return query;
  }

  // ---------------------------------------------------------------- list

  private static generateListView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument,
  ): UIDLDocument {
    const entityName = viewDef.list as string;
    const entity = kir.entities[entityName];
    const fields = entity ? entity.fields : {};
    const columns = (viewDef.columns as string[]) || Object.keys(fields).slice(0, 5);
    const openTarget = (viewDef.open as string) || `${entityName.toLowerCase()}-form`;
    const route = `/${viewId}`;

    // Projected fields must be addressable top-level columns; dotted relation columns stay in the
    // table (the bridge flattens them onto rows) but are not promised by the query.
    const projectedFields = columns.filter((col) => !col.includes("."));

    const tableColumns = columns.map((col) => {
      const colDef: Record<string, unknown> = {
        key: col,
        label: UIDLGenerator.formatColumnHeader(col),
      };
      const format = UIDLGenerator.columnFormat(fields[col]?.type);
      if (format) colDef.format = format;
      return colDef;
    });

    return {
      $schema: UIDLGenerator.SCHEMA_URI,
      version: UIDLGenerator.SPEC_VERSION,
      id: viewId,
      name: UIDLGenerator.capitalize(viewId),
      route,
      state: { page: 1, pageSize: 20, search: "" },
      dataSources: {
        items: {
          $query: {
            collection: entityName,
            ...(projectedFields.length > 0 ? { fields: projectedFields } : {}),
            page: { number: { $bind: "state.page" }, size: { $bind: "state.pageSize" } },
            search: { $bind: "state.search" },
          },
        },
      },
      root: {
        id: `root-${viewId}`,
        type: "Container",
        children: [
          {
            id: `${viewId}-content`,
            type: "Column" as const,
            style: { ...COLUMN_STYLE, padding: "p-4" },
            children: [
              {
                id: `${viewId}-header`,
                type: "Row" as const,
                style: { ...ROW_STYLE, justifyContent: "space-between", alignItems: "center" },
                children: [
                  {
                    id: `${viewId}-title`,
                    type: "Text" as const,
                    props: { value: UIDLGenerator.capitalize(viewId), heading: 1 },
                  },
                  {
                    id: `${viewId}-create`,
                    type: "Button" as const,
                    props: { label: `New ${entityName}`, variant: "primary" },
                    events: { onClick: [{ navigate: { route: `/${openTarget}/new` } }] },
                  },
                ],
              },
              {
                id: `${viewId}-search`,
                type: "TextField" as const,
                props: { label: "Search", placeholder: "Search records" },
                events: { onChange: [{ setState: { path: "state.search", value: null } }] },
              },
              {
                id: `${viewId}-table`,
                type: "DataTable" as const,
                props: {
                  title: UIDLGenerator.capitalize(entityName),
                  dataSource: "items",
                  columns: tableColumns,
                  paginate: false,
                  emptyMessage: "No records match",
                },
                events: {
                  // Row activation carries the whole row; the bridge decorates each row with a
                  // `route` field so a document can navigate without string arithmetic. This is the
                  // runtime's documented row-navigation pattern (`interpreter.ts`).
                  onOpen: [{ navigate: { route: { $bind: "event.route" } } }],
                },
              },
              {
                id: `${viewId}-pagebar`,
                type: "PageBar" as const,
                props: {
                  total: { $bind: "state.$data.items.total" },
                  page: { $bind: "state.page" },
                  pageSize: { $bind: "state.pageSize" },
                },
                events: {
                  onPageChange: [{ setState: { path: "state.page", value: null } }],
                  onPageSizeChange: [{ setState: { path: "state.pageSize", value: null } }],
                },
              },
            ],
          },
        ],
      },
    };
  }

  // ---------------------------------------------------------------- form

  private static generateFormView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument,
  ): UIDLDocument {
    const entityName = viewDef.form as string;
    const entity = kir.entities[entityName];
    const actions = (viewDef.actions as string[]) || [];
    const sections = (viewDef.sections as string[][]) || [];
    const route = `/${viewId}/:id`;

    const actionButtons: UIDLNode[] = actions.map((actionName) => ({
      id: `action-${actionName}`,
      type: "Button" as const,
      props: {
        label: UIDLGenerator.capitalize(actionName),
        variant: actionName === "delete" || actionName === "void" ? "primary" : "secondary",
        // Disabled while a mutation is in flight; `==` is part of the expression vocabulary.
        disabled: {
          $expr: { "==": [{ path: "state.mutation.status" }, { literal: "loading" }] },
        },
      },
      events: {
        onClick: [
          {
            mutate: {
              operation: "transition",
              collection: entityName,
              id: { $bind: "state.params.id" },
              transition: actionName,
              statusPath: "mutation.status",
              resultPath: "mutation.result",
              errorPath: "mutation.error",
              fieldErrorsPath: "mutation.fieldErrors",
            },
          },
        ],
      },
    }));

    const sectionNodes: UIDLNode[] = [];
    if (entity) {
      sections.forEach((sectionFields, sectionIndex) => {
        const fieldNodes: UIDLNode[] = sectionFields
          .map((fieldName) => UIDLGenerator.formFieldNode(entityName, fieldName, entity.fields[fieldName], kir))
          .filter((node): node is UIDLNode => node !== null);

        // A section is a heading plus its fields; `Section` does not exist in the registry.
        sectionNodes.push(
          {
            id: `${viewId}-section-${sectionIndex}`,
            type: "Text" as const,
            props: { value: `Section ${sectionIndex + 1}`, heading: 2 },
          },
          ...fieldNodes,
        );
      });
    }

    // The record query filters on the id the URL carried. The host seeds `state.params.id` from
    // the route before mounting; the bridge then seeds `state.form` from `rows[0]` (or a blank
    // template when the id is `new`). Both are reads of document state, so they stay resolvable
    // in the runtime and reusable across hosts.
    const recordQueryFields = entity ? Object.keys(entity.fields) : undefined;

    return {
      $schema: UIDLGenerator.SCHEMA_URI,
      version: UIDLGenerator.SPEC_VERSION,
      id: viewId,
      name: `${entityName} Details`,
      route,
      state: { params: {}, form: {}, mutation: {} },
      dataSources: {
        record: {
          $query: {
            collection: entityName,
            ...(recordQueryFields ? { fields: recordQueryFields } : {}),
            filters: [{ field: "id", op: "eq", value: { $bind: "state.params.id" } }],
            page: { number: 1, size: 1 },
          },
        },
      },
      root: {
        id: `root-${viewId}`,
        type: "Container",
        children: [
          {
            id: `${viewId}-body`,
            type: "Column" as const,
            style: { ...COLUMN_STYLE, padding: "p-4" },
            children: [
              ...UIDLGenerator.formActionHeader(viewId, entityName, actionButtons),
              {
                id: `${viewId}-fields`,
                type: "Form" as const,
                children: sectionNodes,
              },
            ],
          },
        ],
      },
    };
  }

  private static formActionHeader(viewId: string, entityName: string, actionButtons: UIDLNode[]): UIDLNode[] {
    return [
      {
        id: `${viewId}-header`,
        type: "Row" as const,
        style: { ...ROW_STYLE, justifyContent: "space-between", alignItems: "center" },
        children: [
          {
            id: `${viewId}-title`,
            type: "Text" as const,
            props: { value: `${entityName} Details`, heading: 1 },
          },
          {
            id: `${viewId}-actions`,
            type: "Row" as const,
            style: ROW_STYLE,
            children: actionButtons,
          },
        ],
      },
    ];
  }

  /**
   * One editable field as a registry widget. `value`/`checked` bind into `state.form.*`; the
   * onChange `setState` (value `null` = "use what the event carried") keeps the two in sync.
   * Computed fields render read-only.
   */
  private static formFieldNode(
    entityName: string,
    fieldName: string,
    field: FieldDefinition | undefined,
    kir: KIRDocument,
  ): UIDLNode | null {
    if (!field) return null;
    const label = UIDLGenerator.formatColumnHeader(fieldName);

    if (field.type === "list") {
      return UIDLGenerator.lineItemsTable(entityName, fieldName, field, kir);
    }

    const widget = UIDLGenerator.widgetFor(field);
    const isComputed = field.compute !== undefined;

    const base = {
      id: `field-${fieldName}`,
      type: widget,
      props: {
        label,
        readOnly: isComputed,
      },
      // A computed field has nothing to write; only editable fields listen for changes.
      ...(isComputed
        ? {}
        : {
            events: {
              onChange: [{ setState: { path: `state.form.${fieldName}`, value: null } }],
            },
          }),
    };

    if (widget === "Checkbox") {
      return {
        ...base,
        props: { ...base.props, checked: { $bind: `state.form.${fieldName}` } },
      };
    }

    if (widget === "Select") {
      const options = (field.values || []).map((value) => ({
        value,
        label: UIDLGenerator.capitalize(value),
      }));
      return {
        ...base,
        props: {
          ...base.props,
          value: { $bind: `state.form.${fieldName}` },
          ...(options.length > 0 ? { options } : {}),
        },
      };
    }

    return {
      ...base,
      props: {
        ...base.props,
        value: { $bind: `state.form.${fieldName}` },
      },
    };
  }

  /**
   * An embedded list field renders as a nested DataTable bound straight to the live
   * `state.form.<field>` rows — no extra data source, so edits re-render immediately.
   */
  private static lineItemsTable(
    entityName: string,
    fieldName: string,
    field: FieldDefinition,
    kir: KIRDocument,
  ): UIDLNode {
    const target = field.element?.target;
    const childEntity = target ? kir.entities[target] : undefined;
    const childFieldNames = childEntity ? Object.keys(childEntity.fields).slice(0, 5) : [];
    const columns: Record<string, unknown>[] =
      childFieldNames.length > 0
        ? childFieldNames.map((key) => ({ key, label: UIDLGenerator.formatColumnHeader(key) }))
        : [{ key: fieldName, label: UIDLGenerator.formatColumnHeader(fieldName) }];

    return {
      id: `field-${fieldName}`,
      type: "DataTable" as const,
      props: {
        title: UIDLGenerator.formatColumnHeader(fieldName),
        rows: { $bind: `state.form.${fieldName}` },
        columns,
        paginate: false,
        emptyMessage: "No entries",
      },
    };
  }

  // ---------------------------------------------------------------- scaffolds

  private static generateScaffoldList(entityName: string, kir: KIRDocument): UIDLDocument {
    const entity = kir.entities[entityName];
    return UIDLGenerator.generateListView(
      `${entityName.toLowerCase()}-list`,
      {
        list: entityName,
        columns: Object.keys(entity?.fields || {}).slice(0, 5),
        open: `${entityName.toLowerCase()}-form`,
      },
      kir,
    );
  }

  private static generateScaffoldForm(entityName: string, kir: KIRDocument): UIDLDocument {
    const entity = kir.entities[entityName];
    const transitions = entity?.workflow?.transitions ? Object.keys(entity.workflow.transitions) : [];
    const fields = Object.keys(entity?.fields || {});
    return UIDLGenerator.generateFormView(
      `${entityName.toLowerCase()}-form`,
      {
        form: entityName,
        actions: transitions,
        sections: [fields],
      },
      kir,
    );
  }

  // ---------------------------------------------------------------- navigation

  /**
   * A per-view Navbar listing the app's navigable dashboard/list documents. Forms are excluded —
   * they need an id before they render, and a constant route to one would be wrong. Scaffolds are
   * excluded too: they are reached from their own list, not from the top bar.
   */
  private static navbarNode(kir: KIRDocument, currentViewId: string, docs: Record<string, UIDLDocument>): UIDLNode[] {
    const declared = (kir.navigation as string[] | undefined) || Object.keys(kir.views || {});
    const items: { navId: string; route: string }[] = [];
    for (const navId of declared) {
      const doc = docs[navId];
      if (navId === currentViewId || !doc?.route || doc.route.includes(":id")) continue;
      items.push({ navId, route: doc.route });
    }

    if (items.length === 0) return [];

    return [
      {
        id: `${currentViewId}-navbar`,
        type: "Navbar" as const,
        children: [
          {
            id: `${currentViewId}-brand`,
            type: "Text" as const,
            props: { value: kir.meta?.title || kir.app },
            style: { fontWeight: "font-semibold" },
          },
          ...items.map(({ navId, route }) => ({
            id: `nav-${navId}`,
            type: "Button" as const,
            props: { label: UIDLGenerator.capitalize(navId), variant: "secondary" as const },
            events: { onClick: [{ navigate: { route } }] },
          })),
        ],
      },
    ];
  }

  // ---------------------------------------------------------------- mapping helpers

  /** Reference-registry widget for a Kerangka field type. */
  private static widgetFor(field: FieldDefinition): FormWidgetType {
    switch (field.type) {
      case "boolean":
      case "bool":
        return "Checkbox";
      case "enum":
        return "Select";
      default:
        return "TextField";
    }
  }

  /** ListCell format hint for a field type, or none when the type has no special printing. */
  private static columnFormat(type: string | undefined): string | undefined {
    switch (type) {
      case "decimal":
      case "float":
        return "currency";
      case "date":
      case "datetime":
        return "date";
      case "enum":
        return "status";
      case "boolean":
      case "bool":
        return "check";
      default:
        return undefined;
    }
  }

  /** Lowers `field == value` (and the other comparison operators) to a strict `$query` filter. */
  private static lowerWhere(where: string): UIDLFilter | undefined {
    const trimmed = where.trim();
    if (!trimmed) return undefined;

    // Only a *single* atomic comparison is lowered. Once the predicate composes (&&, ||, `in`,
    // calls, another comparison), its truth can no longer be represented by one filter row, so it
    // is left to the host to enforce rather than mis-lowered.
    if (/&&|\|\||\b(and|or|not|in|between|contains|like)\b/i.test(trimmed)) return undefined;

    const match = /^([A-Za-z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(trimmed);
    if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined;
    const [, rawField, op, rawValue] = match;
    const field = rawField.replace(/^([^.]+)\./, "$1.");
    if (field.length === 0) return undefined;

    // The RHS must be one token: a quoted string, a bare identifier, or a number. A bare
    // comparison or whitespace means the "last operator wins" greedy capture swallowed more
    // predicate than the schema can keep honest.
    const rhs = rawValue.trim();
    if (rhs.length === 0 || /[<>=!]/.test(rhs) || /\s/.test(rhs)) return undefined;

    const unquoted = rhs.replace(/^(['"])(.*)\1$/, "$2");
    const numeric = Number(unquoted);
    const value = Number.isNaN(numeric) ? (unquoted.length > 0 ? unquoted : rhs) : numeric;

    switch (op) {
      case "==": return { field, op: "eq", value };
      case "!=": return { field, op: "ne", value };
      case ">=": return Number.isNaN(numeric) ? undefined : { field, op: "gte", value };
      case "<=": return Number.isNaN(numeric) ? undefined : { field, op: "lte", value };
      case ">": return Number.isNaN(numeric) ? undefined : { field, op: "gt", value };
      case "<": return Number.isNaN(numeric) ? undefined : { field, op: "lt", value };
      default: return undefined;
    }
  }

  private static firstSegment(source: string): string {
    return source.split(".").find(Boolean) || "";
  }

  private static lastSegment(source: string): string {
    const parts = source.split(".");
    if (parts.length < 2) return "";
    return parts.at(-1) ?? "";
  }

  private static formatColumnHeader(str: string): string {
    return str
      .split(".")
      .map((part) => part.replace(/([A-Z])/g, " $1").trim())
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" - ");
  }

  private static capitalize(str: string): string {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}