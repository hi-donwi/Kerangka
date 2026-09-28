/**
 * Kerangka Static Verification Engine
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 *
 * Verifies workflows, decision tables, permissions, and events (PLAN.md §1731–1740 & §21).
 */

import { pointer, SourceLocator } from "../diagnostics.js";
import { CompilerDiagnostic, KIRDocument } from "../types.js";

export interface VerificationResult {
  ok: boolean;
  findings: CompilerDiagnostic[];
  errors: CompilerDiagnostic[];
  warnings: CompilerDiagnostic[];
}

export interface NumericalInterval {
  min: number;
  minInclusive: boolean;
  max: number;
  maxInclusive: boolean;
}

/**
 * Parses a numerical cell string (e.g. "<= 10", "> 5", "[10..20]", "(5..15)") into an interval.
 */
function parseNumericalCell(cell: unknown): NumericalInterval | null {
  if (typeof cell === "number") {
    return { min: cell, minInclusive: true, max: cell, maxInclusive: true };
  }
  if (typeof cell !== "string") return null;

  const trimmed = cell.trim();
  if (trimmed === "-" || trimmed === "") {
    return { min: -Infinity, minInclusive: true, max: Infinity, maxInclusive: true };
  }

  // Bracket range: [10..20], (5..15], [0..100)
  const rangeMatch = trimmed.match(/^([[(])\s*([0-9.-]+)\s*\.\.\s*([0-9.-]+)\s*([\])])$/);
  if (rangeMatch) {
    const [, leftBracket, minStr, maxStr, rightBracket] = rangeMatch;
    return {
      min: Number(minStr),
      minInclusive: leftBracket === "[",
      max: Number(maxStr),
      maxInclusive: rightBracket === "]",
    };
  }

  // Comparisons: <= 10, < 10, >= 10, > 10
  if (trimmed.startsWith("<=")) {
    const val = Number(trimmed.slice(2).trim());
    if (!isNaN(val)) return { min: -Infinity, minInclusive: true, max: val, maxInclusive: true };
  }
  if (trimmed.startsWith("<")) {
    const val = Number(trimmed.slice(1).trim());
    if (!isNaN(val)) return { min: -Infinity, minInclusive: true, max: val, maxInclusive: false };
  }
  if (trimmed.startsWith(">=")) {
    const val = Number(trimmed.slice(2).trim());
    if (!isNaN(val)) return { min: val, minInclusive: true, max: Infinity, maxInclusive: true };
  }
  if (trimmed.startsWith(">")) {
    const val = Number(trimmed.slice(1).trim());
    if (!isNaN(val)) return { min: val, minInclusive: false, max: Infinity, maxInclusive: true };
  }

  const exactNum = Number(trimmed);
  if (!isNaN(exactNum)) {
    return { min: exactNum, minInclusive: true, max: exactNum, maxInclusive: true };
  }

  return null;
}

/** Checks whether two numerical intervals overlap. */
function intervalsOverlap(a: NumericalInterval, b: NumericalInterval): boolean {
  if (a.max < b.min || b.max < a.min) return false;
  if (a.max === b.min && (!a.maxInclusive || !b.minInclusive)) return false;
  if (b.max === a.min && (!b.maxInclusive || !a.minInclusive)) return false;
  return true;
}

/**
 * Verifies decision tables for gaps and overlapping rows.
 */
export function verifyDecisionTables(
  decisions: Record<string, unknown> | undefined,
  locator?: SourceLocator
): CompilerDiagnostic[] {
  const findings: CompilerDiagnostic[] = [];
  if (!decisions) return findings;

  for (const [tableName, tableRaw] of Object.entries(decisions)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = tableRaw as any;
    if (!table || typeof table !== "object") continue;

    const hitPolicy = table.hitPolicy || "first";
    const inputs: Array<{ name: string; type?: string }> = Array.isArray(table.inputs) ? table.inputs : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules: Array<{ inputs: any[]; outputs: Record<string, unknown> }> = Array.isArray(table.rules)
      ? table.rules
      : [];

    const tablePtr = pointer("decisions", tableName);
    const tablePos = locator?.locate(tablePtr);

    if (inputs.length > 0 && rules.length === 0) {
      findings.push({
        severity: "error",
        code: "DECISION_EMPTY_TABLE",
        message: `Decision table '${tableName}' declares inputs but contains no rules.`,
        path: tablePtr,
        line: tablePos?.line,
        column: tablePos?.column,
        hint: `Add rules to table '${tableName}' or specify a default output.`,
      });
      continue;
    }

    // Check for catch-all default row ("-" in all input cells)
    const hasCatchAll = rules.some((r) =>
      Array.isArray(r.inputs) && r.inputs.every((cell) => cell === "-" || cell === "" || cell === undefined || cell === null)
    );

    // 1. Overlapping rows check (especially significant for "unique" hit policy)
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const ruleA = rules[i]!;
        const ruleB = rules[j]!;

        let allColumnsOverlap = true;
        for (let colIdx = 0; colIdx < inputs.length; colIdx++) {
          const cellA = ruleA.inputs?.[colIdx];
          const cellB = ruleB.inputs?.[colIdx];

          // Wildcard cell matches everything
          if (cellA === "-" || cellA === undefined || cellB === "-" || cellB === undefined) {
            continue;
          }

          // Check numerical intervals
          const intA = parseNumericalCell(cellA);
          const intB = parseNumericalCell(cellB);
          if (intA && intB) {
            if (!intervalsOverlap(intA, intB)) {
              allColumnsOverlap = false;
              break;
            }
            continue;
          }

          // String / categorical equality
          const strA = String(cellA).trim().replace(/^['"]|['"]$/g, "");
          const strB = String(cellB).trim().replace(/^['"]|['"]$/g, "");
          if (strA !== strB) {
            allColumnsOverlap = false;
            break;
          }
        }

        if (allColumnsOverlap) {
          const ruleBPtr = pointer("decisions", tableName, "rules", j);
          const ruleBPos = locator?.locate(ruleBPtr);
          const isUniquePolicy = hitPolicy === "unique";
          findings.push({
            severity: isUniquePolicy ? "error" : "warning",
            code: "DECISION_OVERLAPPING_ROWS",
            message: `Decision table '${tableName}' has overlapping rules: rule #${i + 1} and rule #${j + 1} can match the same inputs.`,
            path: ruleBPtr,
            line: ruleBPos?.line,
            column: ruleBPos?.column,
            hint: isUniquePolicy
              ? `Under 'unique' hit policy, rules must be mutually exclusive. Refine conditions or change hit policy to 'first'.`
              : `Rule #${i + 1} will always shadow rule #${j + 1} under 'first' hit policy.`,
          });
        }
      }
    }

    // 2. Numerical gap check
    if (!hasCatchAll && inputs.length === 1) {
      const col = inputs[0]!;
      const intervals: NumericalInterval[] = [];
      let allNumerical = true;

      for (const rule of rules) {
        const cell = rule.inputs?.[0];
        const intv = parseNumericalCell(cell);
        if (intv) {
          intervals.push(intv);
        } else {
          allNumerical = false;
          break;
        }
      }

      if (allNumerical && intervals.length > 0) {
        // Sort intervals by min
        intervals.sort((a, b) => a.min - b.min);

        // Check if starts at -Infinity
        const first = intervals[0]!;
        if (first.min > -Infinity && first.min > 0) {
          findings.push({
            severity: "error",
            code: "DECISION_TABLE_GAP",
            message: `Decision table '${tableName}' has a gap: input values below ${first.min} are not covered by any rule.`,
            path: tablePtr,
            line: tablePos?.line,
            column: tablePos?.column,
            hint: `Add a rule covering '${col.name} < ${first.min}' or add a default '-' row.`,
          });
        }

        // Check between intervals
        for (let k = 0; k < intervals.length - 1; k++) {
          const curr = intervals[k]!;
          const next = intervals[k + 1]!;
          if (curr.max < next.min) {
            findings.push({
              severity: "error",
              code: "DECISION_TABLE_GAP",
              message: `Decision table '${tableName}' has a gap between ${curr.max} and ${next.min}: no rule matches this range.`,
              path: tablePtr,
              line: tablePos?.line,
              column: tablePos?.column,
              hint: `Add a rule for the range between ${curr.max} and ${next.min}, or add a default '-' row.`,
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Verifies workflows for dead-end states, unreachable states, and unrunnable transitions.
 */
export function verifyWorkflows(
  entities: Record<string, unknown> | undefined,
  appRoles: string[] = [],
  locator?: SourceLocator
): CompilerDiagnostic[] {
  const findings: CompilerDiagnostic[] = [];
  if (!entities) return findings;

  for (const [entityName, entityRaw] of Object.entries(entities)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entity = entityRaw as any;
    const workflow = entity?.workflow;
    if (!workflow || typeof workflow !== "object") continue;

    const states: string[] = Array.isArray(workflow.states) ? workflow.states : [];
    const initial: string | undefined = workflow.initial;
    const terminal: string[] = Array.isArray(workflow.terminal) ? workflow.terminal : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitions: Record<string, any> = workflow.transitions || {};

    const workflowPtr = pointer("entities", entityName, "workflow");
    const workflowPos = locator?.locate(workflowPtr);

    // Build transition graph: fromState -> Set<toState>
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    for (const state of states) {
      outgoing.set(state, new Set());
      incoming.set(state, new Set());
    }

    for (const [transName, transDef] of Object.entries(transitions)) {
      const transPtr = pointer("entities", entityName, "workflow", "transitions", transName);
      const transPos = locator?.locate(transPtr);

      const fromList: string[] = Array.isArray(transDef.from)
        ? transDef.from
        : typeof transDef.from === "string"
        ? [transDef.from]
        : [];
      const toState: string = transDef.to;

      // Role check: does transition have roles that exist in app?
      if (Array.isArray(transDef.roles)) {
        if (transDef.roles.length === 0) {
          findings.push({
            severity: "error",
            code: "WORKFLOW_UNRUNNABLE_TRANSITION",
            message: `Transition '${transName}' on '${entityName}' has an empty roles list and cannot be run by anyone.`,
            path: transPtr,
            line: transPos?.line,
            column: transPos?.column,
            hint: `Specify at least one authorized role, or remove the empty 'roles' array to allow default authorization.`,
          });
        } else if (appRoles.length > 0) {
          for (const role of transDef.roles) {
            if (!appRoles.includes(role)) {
              findings.push({
                severity: "error",
                code: "WORKFLOW_INVALID_ROLE",
                message: `Transition '${transName}' on '${entityName}' references unknown role '${role}'.`,
                path: transPtr,
                line: transPos?.line,
                column: transPos?.column,
                hint: `Declare role '${role}' in the app's top-level 'roles' list.`,
              });
            }
          }
        }
      }

      for (const fromState of fromList) {
        outgoing.get(fromState)?.add(toState);
        incoming.get(toState)?.add(fromState);
      }
    }

    // 1. Dead-end states check (state has 0 outgoing transitions but is NOT declared in terminal)
    const explicitTerminal = workflow.terminal || workflow.final;
    if (Array.isArray(explicitTerminal) && explicitTerminal.length > 0) {
      for (const state of states) {
        const outCount = outgoing.get(state)?.size || 0;
        const isTerminal = explicitTerminal.includes(state);

        if (outCount === 0 && !isTerminal) {
          const statePtr = pointer("entities", entityName, "workflow", "states");
          const statePos = locator?.locate(statePtr);
          findings.push({
            severity: "error",
            code: "WORKFLOW_DEAD_END_STATE",
            message: `State '${state}' in '${entityName}.workflow' is a dead-end: it has no outgoing transitions and is not declared in 'terminal'.`,
            path: statePtr,
            line: statePos?.line,
            column: statePos?.column,
            hint: `Add an outgoing transition from '${state}', or declare it in 'terminal: [...]'.`,
          });
        }
      }
    }

    // 2. Unreachable states check (states not reachable from initial)
    if (initial && states.includes(initial)) {
      const reachable = new Set<string>();
      const queue = [initial];
      reachable.add(initial);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = outgoing.get(curr);
        if (neighbors) {
          for (const next of neighbors) {
            if (!reachable.has(next)) {
              reachable.add(next);
              queue.push(next);
            }
          }
        }
      }

      for (const state of states) {
        if (!reachable.has(state)) {
          const statePtr = pointer("entities", entityName, "workflow", "states");
          const statePos = locator?.locate(statePtr);
          findings.push({
            severity: "error",
            code: "WORKFLOW_UNREACHABLE_STATE",
            message: `State '${state}' in '${entityName}.workflow' is unreachable from initial state '${initial}'.`,
            path: statePtr,
            line: statePos?.line,
            column: statePos?.column,
            hint: `Add a transition leading to '${state}', or remove it from 'states'.`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Verifies permissions: actions that no role can execute, and roles that can do nothing.
 */
export function verifyPermissions(
  doc: KIRDocument | Record<string, unknown>,
  locator?: SourceLocator
): CompilerDiagnostic[] {
  const findings: CompilerDiagnostic[] = [];
  const appRoles: string[] = Array.isArray(doc.roles) ? doc.roles : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = (doc.entities || {}) as Record<string, any>;

  const activeRoles = new Set<string>();

  for (const [entityName, entity] of Object.entries(entities)) {
    const actions = entity.actions || {};
    for (const [actionName, actionDef] of Object.entries(actions)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = actionDef as any;
      const actionPtr = pointer("entities", entityName, "actions", actionName);
      const actionPos = locator?.locate(actionPtr);

      if (Array.isArray(a.roles)) {
        if (a.roles.length === 0) {
          findings.push({
            severity: "error",
            code: "PERMISSION_ACTION_NO_ROLE",
            message: `Action '${entityName}.${actionName}' has an empty roles list and cannot be executed by any actor.`,
            path: actionPtr,
            line: actionPos?.line,
            column: actionPos?.column,
            hint: `Specify at least one authorized role or remove the empty 'roles' array.`,
          });
        } else {
          for (const r of a.roles) {
            activeRoles.add(r);
          }
        }
      }
    }

    const workflow = entity.workflow;
    if (workflow && workflow.transitions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const transDef of Object.values(workflow.transitions) as any[]) {
        if (Array.isArray(transDef.roles)) {
          for (const r of transDef.roles) {
            activeRoles.add(r);
          }
        }
      }
    }

    const perms = entity.permissions;
    if (perms && typeof perms === "object") {
      for (const val of Object.values(perms)) {
        if (Array.isArray(val)) {
          for (const r of val) {
            if (typeof r === "string") activeRoles.add(r);
          }
        } else if (val && typeof val === "object") {
          for (const r of Object.keys(val)) {
            activeRoles.add(r);
          }
        }
      }
    }
  }

  // Check roles that can do nothing
  for (const role of appRoles) {
    if (!activeRoles.has(role) && role !== "admin") {
      const rolePtr = pointer("roles");
      const rolePos = locator?.locate(rolePtr);
      findings.push({
        severity: "warning",
        code: "PERMISSION_ROLE_CAN_DO_NOTHING",
        message: `Role '${role}' is declared in the app but has no actions or transitions assigned to it.`,
        path: rolePtr,
        line: rolePos?.line,
        column: rolePos?.column,
        hint: `Assign permissions/roles to '${role}', or remove it from the 'roles' list.`,
      });
    }
  }

  return findings;
}

/**
 * Verifies events and policies: orphan emitted events and orphan listened events.
 */
export function verifyEvents(
  doc: KIRDocument | Record<string, unknown>,
  locator?: SourceLocator
): CompilerDiagnostic[] {
  const findings: CompilerDiagnostic[] = [];
  const emittedEvents = new Set<string>();
  const listenedEvents = new Set<string>();

  // Collect declared events
  if (doc.events && typeof doc.events === "object") {
    for (const evtName of Object.keys(doc.events)) {
      emittedEvents.add(evtName);
    }
  }

  // Collect emissions from entities
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = (doc.entities || {}) as Record<string, any>;
  for (const entity of Object.values(entities)) {
    // Actions
    if (entity.actions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const action of Object.values(entity.actions) as any[]) {
        if (Array.isArray(action.emit)) {
          for (const e of action.emit) {
            const name = typeof e === "string" ? e : e.name || e.event;
            if (name) emittedEvents.add(name);
          }
        }
      }
    }
    // Workflow transitions
    if (entity.workflow?.transitions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const trans of Object.values(entity.workflow.transitions) as any[]) {
        if (Array.isArray(trans.emit)) {
          for (const e of trans.emit) {
            const name = typeof e === "string" ? e : e.name || e.event;
            if (name) emittedEvents.add(name);
          }
        }
      }
    }
  }

  // Collect policy listeners
  if (doc.policies && typeof doc.policies === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [policyName, policyDef] of Object.entries(doc.policies) as [string, any][]) {
      const onEvent = policyDef?.on;
      if (typeof onEvent === "string") {
        listenedEvents.add(onEvent);
        if (!emittedEvents.has(onEvent)) {
          const policyPtr = pointer("policies", policyName);
          const policyPos = locator?.locate(policyPtr);
          findings.push({
            severity: "error",
            code: "EVENT_ORPHAN_LISTENER",
            message: `Policy '${policyName}' listens for event '${onEvent}', but no entity or context emits it.`,
            path: policyPtr,
            line: policyPos?.line,
            column: policyPos?.column,
            hint: `Ensure an action or transition emits '${onEvent}', or correct the event name.`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Top-level static verification function for a Kerangka model.
 */
export function verifyDocument(
  doc: KIRDocument | Record<string, unknown>,
  sourceText?: string
): VerificationResult {
  const locator = sourceText ? SourceLocator.fromText(sourceText) : undefined;
  const appRoles: string[] = Array.isArray(doc.roles) ? doc.roles : [];

  const findings: CompilerDiagnostic[] = [
    ...verifyWorkflows(doc.entities as Record<string, unknown>, appRoles, locator),
    ...verifyDecisionTables(doc.decisions as Record<string, unknown>, locator),
    ...verifyPermissions(doc, locator),
    ...verifyEvents(doc, locator),
  ];

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  return {
    ok: errors.length === 0,
    findings,
    errors,
    warnings,
  };
}
