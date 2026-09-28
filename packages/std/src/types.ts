/**
 * Kerangka Standard Library Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface StdTypeDefinition {
  type: string;
  description?: string;
  fields: Record<string, unknown>;
  rules?: string[];
  invariants?: string[];
}

export interface StdTraitDefinition {
  trait: string;
  description?: string;
  fields: Record<string, unknown>;
  defaults?: Record<string, string>;
  readFilter?: string;
  rules?: string[];
  invariants?: string[];
}

export interface StdWorkflowTransition {
  from: string;
  to: string;
  action: string;
  roles?: string[];
  guard?: string;
}

export interface StdWorkflowTemplate {
  template: string;
  type: "workflow";
  description?: string;
  params: string[];
  states: string[];
  initial: string;
  transitions: StdWorkflowTransition[];
}

export interface StdViewTemplate {
  template: string;
  type: "view";
  description?: string;
  params: string[];
  layout: string;
  master?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  [key: string]: unknown;
}

export type StdTemplate = StdWorkflowTemplate | StdViewTemplate;

export interface StdLintPreset {
  budgets: {
    linesPerFile: number;
    fieldsPerAggregate: number;
    statementsPerAction: number;
    nodesPerExpression: number;
    transitionsPerWorkflow: number;
    aggregatesPerContext: number;
    dependenciesPerContext: number;
  };
  naming: {
    app: string;
    context: string;
    aggregate: string;
    type: string;
    event: string;
    field: string;
    action: string;
    def: string;
  };
  unused: {
    exports: boolean;
    defs: boolean;
    fields: boolean;
  };
  topology: boolean;
}

export interface StdPackageManifest {
  package: string;
  version: string;
  description?: string;
  types?: Record<string, StdTypeDefinition>;
  traits?: Record<string, StdTraitDefinition>;
  templates?: Record<string, StdTemplate>;
  presets?: Record<string, StdLintPreset>;
}
