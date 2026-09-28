/**
 * Kerangka Standard Library Definitions
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import {
  StdLintPreset,
  StdPackageManifest,
  StdTemplate,
  StdTraitDefinition,
  StdTypeDefinition,
  StdViewTemplate,
  StdWorkflowTemplate,
} from "./types.js";

export const MoneyType: StdTypeDefinition = {
  type: "Money",
  description: "Monetary amount paired with a three-letter currency code (ISO 4217)",
  fields: {
    amount: "decimal(12,2)!",
    currency: "string! = 'USD'",
  },
  rules: [
    "length(currency) == 3",
  ],
};

export const AddressType: StdTypeDefinition = {
  type: "Address",
  description: "Postal or physical mailing address",
  fields: {
    street: "string!",
    city: "string!",
    state: "string",
    postalCode: "string!",
    country: "string!",
  },
};

export const PeriodType: StdTypeDefinition = {
  type: "Period",
  description: "Date interval with start and end dates where endDate >= startDate",
  fields: {
    startDate: "date!",
    endDate: "date!",
  },
  rules: [
    "endDate >= startDate",
  ],
};

export const AuditableTrait: StdTraitDefinition = {
  trait: "auditable",
  description: "Adds audit trail fields and default timestamps/actors",
  fields: {
    createdAt: { type: "datetime!", system: true, immutable: true },
    createdBy: { type: "string!", system: true, immutable: true },
    updatedAt: { type: "datetime!", system: true },
    updatedBy: { type: "string!", system: true },
  },
  defaults: {
    createdAt: "now()",
    createdBy: "actor.id",
    updatedAt: "now()",
    updatedBy: "actor.id",
  },
};

export const SoftDeleteTrait: StdTraitDefinition = {
  trait: "softDelete",
  description: "Adds soft-deletion tracking and automatic query read filter",
  fields: {
    deletedAt: { type: "datetime", system: true },
    deletedBy: { type: "string", system: true },
  },
  readFilter: "deletedAt == null",
};

export const TenantScopedTrait: StdTraitDefinition = {
  trait: "tenantScoped",
  description: "Enforces tenant isolation with immutable tenantId and automatic read filter",
  fields: {
    tenantId: { type: "string!", system: true, immutable: true },
  },
  defaults: {
    tenantId: "actor.tenantId",
  },
  readFilter: "tenantId == actor.tenantId",
};

export const ApprovalWorkflowTemplate: StdWorkflowTemplate = {
  template: "approval",
  type: "workflow",
  description: "Standard multi-state approval workflow with submitter and approver roles",
  params: ["submitter", "approver"],
  states: ["draft", "submitted", "approved", "rejected"],
  initial: "draft",
  transitions: [
    { from: "draft", to: "submitted", action: "submit", roles: ["${submitter}"] },
    { from: "submitted", to: "approved", action: "approve", roles: ["${approver}"] },
    { from: "submitted", to: "rejected", action: "reject", roles: ["${approver}"] },
  ],
};

export const MasterDetailViewTemplate: StdViewTemplate = {
  template: "masterDetail",
  type: "view",
  description: "Master-detail layout template for collection browsing and item inspection",
  params: ["entity", "title"],
  layout: "split",
  master: {
    component: "List",
    entity: "${entity}",
    title: "${title}",
  },
  detail: {
    component: "Form",
    entity: "${entity}",
  },
};

export const KerangkaRecommendedPreset: StdLintPreset = {
  budgets: {
    linesPerFile: 300,
    fieldsPerAggregate: 40,
    statementsPerAction: 10,
    nodesPerExpression: 30,
    transitionsPerWorkflow: 15,
    aggregatesPerContext: 12,
    dependenciesPerContext: 4,
  },
  naming: {
    app: "kebab",
    context: "kebab",
    aggregate: "pascal",
    type: "pascal",
    event: "pascal",
    field: "camel",
    action: "camel",
    def: "camel",
  },
  unused: {
    exports: true,
    defs: true,
    fields: true,
  },
  topology: true,
};

export const STD_PACKAGE: StdPackageManifest = {
  package: "@kerangka/std",
  version: "0.1.0",
  description: "Standard library for Kerangka: value types, traits, workflow templates, and lint presets",
  types: {
    Money: MoneyType,
    Address: AddressType,
    Period: PeriodType,
  },
  traits: {
    auditable: AuditableTrait,
    softDelete: SoftDeleteTrait,
    tenantScoped: TenantScopedTrait,
  },
  templates: {
    approval: ApprovalWorkflowTemplate,
    masterDetail: MasterDetailViewTemplate,
  },
  presets: {
    "kerangka:recommended": KerangkaRecommendedPreset,
  },
};

/**
 * Instantiates a template by substituting ${param} with the provided string argument.
 * PLAN.md §7.5: Templates substitute values only (${param} becomes a JSON value).
 * They contain no conditionals and no loops.
 */
export function instantiateTemplate<T = unknown>(
  template: StdTemplate | Record<string, unknown>,
  params: Record<string, string>
): T {
  const substitute = (val: unknown): unknown => {
    if (typeof val === "string") {
      let replaced = val;
      for (const [key, replacement] of Object.entries(params)) {
        replaced = replaced.replaceAll(`\${${key}}`, replacement);
      }
      return replaced;
    }
    if (Array.isArray(val)) {
      return val.map(substitute);
    }
    if (val !== null && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = substitute(v);
      }
      return out;
    }
    return val;
  };

  return substitute(template) as T;
}
