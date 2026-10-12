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
import { expandTemplate } from "./template.js";

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
  description:
    "Draft, submit, then approve or reject. The entity declares its state field " +
    "(default 'status') as enum(draft, submitted, approved, rejected)",
  params: {
    submitter: { description: "the role that may submit a draft" },
    approver: { description: "the role that may approve or reject a submission" },
  },
  states: ["draft", "submitted", "approved", "rejected"],
  initial: "draft",
  transitions: {
    submit: { from: "draft", to: "submitted", roles: ["${submitter}"] },
    approve: { from: "submitted", to: "approved", roles: ["${approver}"] },
    reject: { from: "submitted", to: "rejected", roles: ["${approver}"] },
  },
};

export const MasterDetailViewTemplate: StdViewTemplate = {
  template: "masterDetail",
  type: "view",
  description: "A list of one entity whose rows open that entity's form",
  params: {
    entity: { description: "the entity to list" },
    columns: { description: "the fields shown as columns, as a list of field names" },
  },
  list: "${entity}",
  columns: "${columns}",
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
 * Instantiate a template with arguments, returning only what it expands to.
 *
 * Throws with every problem when the arguments do not fit the template. The compiler reports
 * the same problems as diagnostics instead; both go through `expandTemplate`, so the two can
 * never disagree about what a template means.
 */
export function instantiateTemplate<T = Record<string, unknown>>(
  template: StdTemplate | Record<string, unknown>,
  params: Record<string, unknown>
): T {
  const result = expandTemplate(template as Record<string, unknown>, params);
  if (!result.value) {
    throw new Error(result.problems.map((p) => `${p.code}: ${p.message}`).join("\n"));
  }
  return result.value as T;
}
