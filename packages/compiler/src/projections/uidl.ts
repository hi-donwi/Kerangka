/**
 * Kerangka UIDL Document Projection Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Co-evolved with UIDL-Runtime (https://uidl.dev)
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

export class UIDLGenerator {
  static readonly SCHEMA_URI = "https://uidl.dev/schema/v1/document.schema.json";
  static readonly SPEC_VERSION = "1.0.0";

  /**
   * Generates a collection of UIDL Documents (one per declared view plus navigation shell).
   */
  static generate(kir: KIRDocument): Record<string, UIDLDocument> {
    const documents: Record<string, UIDLDocument> = {};
    const views = kir.views || {};

    for (const [viewId, rawViewDef] of Object.entries(views)) {
      const viewDef = rawViewDef as Record<string, unknown>;

      if (viewDef.dashboard) {
        documents[viewId] = this.generateDashboardView(viewId, viewDef, kir);
      } else if (viewDef.list) {
        documents[viewId] = this.generateListView(viewId, viewDef, kir);
      } else if (viewDef.form) {
        documents[viewId] = this.generateFormView(viewId, viewDef, kir);
      }
    }

    // Auto-scaffold views for entities that do not have custom views
    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      if (entity.embedded) continue;
      const listKey = `${entityName.toLowerCase()}-list`;
      const formKey = `${entityName.toLowerCase()}-form`;

      if (!documents[listKey] && !Object.values(views).some((v: any) => v.list === entityName)) {
        documents[listKey] = this.generateScaffoldList(entityName, entity, kir);
      }
      if (!documents[formKey] && !Object.values(views).some((v: any) => v.form === entityName)) {
        documents[formKey] = this.generateScaffoldForm(entityName, entity, kir);
      }
    }

    // Generate App Navigation Shell
    documents["navigation-shell"] = this.generateNavigationShell(kir, documents);

    return documents;
  }

  private static generateDashboardView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument
  ): UIDLDocument {
    const kpis = (viewDef.dashboard as Array<Record<string, unknown>>) || [];
    const route = viewId === "home" ? "/" : `/${viewId}`;

    const kpiCards: UIDLNode[] = kpis.map((kpi, index) => {
      const title = (kpi.kpi as string) || `KPI ${index + 1}`;
      const metric = (kpi.sum as string) || (kpi.count as string) || (kpi.avg as string) || "";
      const filter = (kpi.where as string) || "";

      return {
        id: `kpi-card-${index}`,
        type: "MetricCard",
        props: {
          title,
          metric,
          filter,
          aggregation: kpi.sum ? "sum" : kpi.count ? "count" : "avg"
        },
        style: {
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#ffffff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
        }
      };
    });

    return {
      $schema: this.SCHEMA_URI,
      version: this.SPEC_VERSION,
      id: viewId,
      name: `${this.capitalize(viewId)} Dashboard`,
      route,
      root: {
        id: `root-${viewId}`,
        type: "Container",
        props: { padding: "24px" },
        children: [
          {
            id: `${viewId}-heading`,
            type: "Heading",
            props: { text: `${this.capitalize(viewId)} Dashboard`, level: 1 }
          },
          {
            id: `${viewId}-grid`,
            type: "Grid",
            props: { columns: 2, gap: "16px" },
            style: { marginTop: "24px" },
            children: kpiCards
          }
        ]
      }
    };
  }

  private static generateListView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument
  ): UIDLDocument {
    const entityName = viewDef.list as string;
    const entity = kir.entities[entityName];
    const columns = (viewDef.columns as string[]) || (entity ? Object.keys(entity.fields).slice(0, 5) : ["id"]);
    const openTarget = (viewDef.open as string) || `${entityName.toLowerCase()}-form`;
    const route = `/${viewId}`;

    const tableColumns = columns.map(col => ({
      key: col,
      title: this.formatColumnHeader(col),
      format: entity?.fields[col]?.type === "decimal" ? "currency" : undefined,
      badge: entity?.fields[col]?.type === "enum" ? true : undefined
    }));

    return {
      $schema: this.SCHEMA_URI,
      version: this.SPEC_VERSION,
      id: viewId,
      name: this.capitalize(viewId),
      route,
      state: {
        searchQuery: "",
        page: 1,
        pageSize: 20
      },
      dataSources: {
        items: {
          $query: {
            collection: entityName,
            fields: columns,
            filters: {},
            sort: "createdAt:desc"
          }
        }
      },
      root: {
        id: `root-${viewId}`,
        type: "Container",
        props: { padding: "24px" },
        children: [
          {
            id: `${viewId}-header`,
            type: "Row",
            props: { justifyContent: "space-between", alignItems: "center", marginBottom: "16px" },
            children: [
              {
                id: `${viewId}-title`,
                type: "Heading",
                props: { text: this.capitalize(viewId), level: 1 }
              },
              {
                id: `${viewId}-create-btn`,
                type: "Button",
                props: { label: `New ${entityName}`, variant: "primary" },
                events: {
                  onClick: {
                    action: "navigate",
                    to: `/${openTarget}/new`
                  }
                }
              }
            ]
          },
          {
            id: `${viewId}-table`,
            type: "Table",
            props: {
              dataSource: "items",
              columns: tableColumns
            },
            events: {
              onRowClick: {
                action: "navigate",
                to: `/${openTarget}/:id`
              }
            }
          }
        ]
      }
    };
  }

  private static generateFormView(
    viewId: string,
    viewDef: Record<string, unknown>,
    kir: KIRDocument
  ): UIDLDocument {
    const entityName = viewDef.form as string;
    const entity = kir.entities[entityName];
    const actions = (viewDef.actions as string[]) || [];
    const sections = (viewDef.sections as string[][]) || [];
    const route = `/${viewId}/:id`;

    // Action buttons
    const actionButtons: UIDLNode[] = actions.map(actionName => ({
      id: `btn-action-${actionName}`,
      type: "Button",
      props: {
        label: this.capitalize(actionName),
        variant: actionName === "void" || actionName === "delete" ? "danger" : "secondary"
      },
      events: {
        onClick: {
          action: "mutate",
          command: `${entityName}.${actionName}`,
          id: "$bind:params.id"
        }
      }
    }));

    // Sections
    const sectionNodes: UIDLNode[] = [];
    if (sections.length > 0 && entity) {
      sections.forEach((secFields, secIdx) => {
        const fieldNodes: UIDLNode[] = [];

        for (const fieldName of secFields) {
          const field = entity.fields[fieldName];
          if (!field) continue;

          if (field.type === "list" && field.element) {
            fieldNodes.push({
              id: `field-${fieldName}`,
              type: "SubTable",
              props: {
                label: this.formatColumnHeader(fieldName),
                field: fieldName,
                itemType: field.element.target || "Item"
              }
            });
          } else {
            fieldNodes.push({
              id: `field-${fieldName}`,
              type: this.mapFieldToInputType(field),
              props: {
                name: fieldName,
                label: this.formatColumnHeader(fieldName),
                required: field.required,
                readOnly: field.compute !== undefined,
                options: field.values
              },
              bindings: {
                value: `$bind:record.${fieldName}`
              }
            });
          }
        }

        sectionNodes.push({
          id: `section-${secIdx}`,
          type: "Section",
          props: {
            title: `Section ${secIdx + 1}`
          },
          style: { marginBottom: "20px" },
          children: fieldNodes
        });
      });
    }

    return {
      $schema: this.SCHEMA_URI,
      version: this.SPEC_VERSION,
      id: viewId,
      name: `${entityName} Details`,
      route,
      dataSources: {
        record: {
          $query: {
            collection: entityName,
            id: "$bind:params.id"
          }
        }
      },
      root: {
        id: `root-${viewId}`,
        type: "Container",
        props: { padding: "24px" },
        children: [
          {
            id: `${viewId}-header`,
            type: "Row",
            props: { justifyContent: "space-between", alignItems: "center", marginBottom: "20px" },
            children: [
              {
                id: `${viewId}-title`,
                type: "Heading",
                props: { text: `${entityName} Details`, level: 1 }
              },
              {
                id: `${viewId}-actions`,
                type: "Row",
                props: { gap: "8px" },
                children: actionButtons
              }
            ]
          },
          {
            id: `${viewId}-form-body`,
            type: "Form",
            props: {
              record: "$bind:record"
            },
            children: sectionNodes
          }
        ]
      }
    };
  }

  private static generateScaffoldList(
    entityName: string,
    entity: KIRDocument["entities"][string],
    kir: KIRDocument
  ): UIDLDocument {
    return this.generateListView(
      `${entityName.toLowerCase()}-list`,
      {
        list: entityName,
        columns: Object.keys(entity.fields).slice(0, 5),
        open: `${entityName.toLowerCase()}-form`
      },
      kir
    );
  }

  private static generateScaffoldForm(
    entityName: string,
    entity: KIRDocument["entities"][string],
    kir: KIRDocument
  ): UIDLDocument {
    const transitions = entity.workflow?.transitions ? Object.keys(entity.workflow.transitions) : [];
    const fields = Object.keys(entity.fields);

    return this.generateFormView(
      `${entityName.toLowerCase()}-form`,
      {
        form: entityName,
        actions: transitions,
        sections: [fields]
      },
      kir
    );
  }

  private static generateNavigationShell(
    kir: KIRDocument,
    documents: Record<string, UIDLDocument>
  ): UIDLDocument {
    const navItems = (kir.navigation as string[]) || Object.keys(kir.views || {});
    const items = navItems.map(navId => {
      const doc = documents[navId];
      return {
        id: navId,
        label: doc?.name || this.capitalize(navId),
        route: doc?.route || `/${navId}`,
        viewId: navId
      };
    });

    return {
      $schema: this.SCHEMA_URI,
      version: this.SPEC_VERSION,
      id: "navigation-shell",
      name: `${kir.meta?.title || kir.app} Navigation`,
      route: "/*",
      root: {
        id: "shell-root",
        type: "AppShell",
        props: {
          appName: kir.meta?.title || kir.app,
          navigationItems: items
        },
        children: [
          {
            id: "outlet",
            type: "RouterOutlet",
            props: {}
          }
        ]
      }
    };
  }

  private static mapFieldToInputType(field: FieldDefinition): string {
    switch (field.type) {
      case "string":
      case "email":
        return "TextInput";
      case "int":
      case "integer":
      case "float":
      case "decimal":
        return "NumberInput";
      case "boolean":
      case "bool":
        return "Checkbox";
      case "date":
        return "DatePicker";
      case "datetime":
        return "DateTimePicker";
      case "enum":
        return "Select";
      case "ref":
        return "Lookup";
      default:
        return "TextInput";
    }
  }

  private static formatColumnHeader(str: string): string {
    return str
      .split(".")
      .map(part => part.replace(/([A-Z])/g, " $1").trim())
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" - ");
  }

  private static capitalize(str: string): string {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
