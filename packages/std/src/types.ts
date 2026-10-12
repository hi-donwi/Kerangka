/**
 * Kerangka Standard Library Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import type { TemplateParams } from "./template.js";

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

/** One transition, in the shape a model document writes it (keyed by its action name). */
export interface StdWorkflowTransition {
  from: string | string[];
  to: string;
  roles?: string[] | string;
  when?: string;
  [key: string]: unknown;
}

/** What every template declares about itself; none of it is part of the expansion. */
export interface StdTemplateMeta {
  template: string;
  description?: string;
  params?: TemplateParams;
}

/** Expands at an entity's `workflow`. */
export interface StdWorkflowTemplate extends StdTemplateMeta {
  type: "workflow";
  field?: string;
  states?: string[];
  initial?: string;
  terminal?: string[];
  transitions: Record<string, StdWorkflowTransition>;
  [key: string]: unknown;
}

/** Expands at one entry of an entity's `actions`. */
export interface StdActionTemplate extends StdTemplateMeta {
  type: "action";
  [key: string]: unknown;
}

/** Expands at one entry of the document's `views`. */
export interface StdViewTemplate extends StdTemplateMeta {
  type: "view";
  [key: string]: unknown;
}

/** Expands at one entry of `entities`, under the name the document gives it. */
export interface StdEntityTemplate extends StdTemplateMeta {
  type: "entity";
  [key: string]: unknown;
}

export type StdTemplate = StdWorkflowTemplate | StdActionTemplate | StdViewTemplate | StdEntityTemplate;

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
