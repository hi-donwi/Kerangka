/**
 * Template Expansion
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * PLAN.md §7.5: a template is a parameterised fragment (a workflow, an action, a view, or a
 * whole entity, ADR-0043) and it substitutes values only. No conditionals, no loops, no
 * nesting: what the author reads in
 * the package is what the compiled model holds, with the arguments put in.
 *
 * Lives here rather than in the compiler so that `instantiateTemplate` and the compiler share
 * one implementation; the compiler depends on this package, never the other way round.
 */

/** The positions a template may stand in. */
export const TEMPLATE_KINDS = ["workflow", "action", "view", "entity"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Keys that describe a template and are never part of what it expands to. */
export const TEMPLATE_META_KEYS = ["template", "type", "description", "params"] as const;

export interface TemplateParamSpec {
  /** Used when the instance does not pass the parameter. Without it the parameter is required. */
  default?: unknown;
  description?: string;
}

/** Either a list of required parameter names, or a map of names to their specification. */
export type TemplateParams = string[] | Record<string, TemplateParamSpec>;

export type TemplateProblemCode =
  | "TEMPLATE_INVALID"
  | "TEMPLATE_PARAM_UNKNOWN"
  | "TEMPLATE_PARAM_MISSING"
  | "TEMPLATE_PARAM_UNDECLARED"
  | "TEMPLATE_PARAM_NOT_SCALAR"
  | "TEMPLATE_PARAM_IN_KEY";

export interface TemplateProblem {
  code: TemplateProblemCode;
  message: string;
  /**
   * RFC 6901 pointer relative to the instance: `/with/<name>` for an argument at fault,
   * `/with` for a missing one, `/use` when the template itself is defective.
   */
  path: string;
  hint?: string;
}

export interface TemplateExpansion {
  /** The expanded body, absent when any problem was found. */
  value?: Record<string, unknown>;
  problems: TemplateProblem[];
}

/** `${name}` where name is a plain identifier. Dotted and prefixed placeholders are not ours. */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const WHOLE_PLACEHOLDER = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const escapePointer = (segment: string): string => segment.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * The declared parameters of a template, normalised to the map form.
 * Returns a problem instead when `params` is in neither legal form.
 */
export function templateParams(
  template: Record<string, unknown>
): { params: Record<string, TemplateParamSpec> } | { problem: TemplateProblem } {
  const params = template.params;
  if (params === undefined) return { params: {} };
  if (Array.isArray(params)) {
    const out: Record<string, TemplateParamSpec> = {};
    for (const name of params) {
      if (typeof name !== "string") {
        return {
          problem: {
            code: "TEMPLATE_INVALID",
            message: `Template parameter names must be strings, not ${JSON.stringify(name)}.`,
            path: "/use",
          },
        };
      }
      out[name] = {};
    }
    return { params: out };
  }
  if (isPlainObject(params)) {
    const out: Record<string, TemplateParamSpec> = {};
    for (const [name, spec] of Object.entries(params)) {
      if (spec !== null && spec !== undefined && !isPlainObject(spec)) {
        return {
          problem: {
            code: "TEMPLATE_INVALID",
            message: `Template parameter '${name}' must be declared with an object, not ${JSON.stringify(spec)}.`,
            path: "/use",
          },
        };
      }
      out[name] = (spec ?? {}) as TemplateParamSpec;
    }
    return { params: out };
  }
  return {
    problem: {
      code: "TEMPLATE_INVALID",
      message: "Template 'params' must be a list of names or an object of parameter declarations.",
      path: "/use",
    },
  };
}

/** The part of a template that is expanded: everything but its own description. */
export function templateBody(template: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if ((TEMPLATE_META_KEYS as readonly string[]).includes(key)) continue;
    body[key] = value;
  }
  return body;
}

/**
 * Expand a template with the given arguments.
 *
 * - A string that is exactly `"${p}"` becomes the argument's JSON value, whatever its type.
 * - `${p}` inside a longer string is interpolated, and only a string, number, or boolean can
 *   be interpolated; anything else would print as `[object Object]`.
 * - `${a.b}` and `${a:b}` are left alone: connectors interpolate those at run time.
 * - A placeholder in an object key is refused rather than left in place unexpanded.
 * - A template whose body names a parameter it does not declare is defective, and so is one
 *   whose body is itself a template instance: templates do not nest.
 */
export function expandTemplate(
  template: Record<string, unknown>,
  args: Record<string, unknown> = {},
  name = String(template.template ?? "template")
): TemplateExpansion {
  const problems: TemplateProblem[] = [];
  const declared = templateParams(template);
  if ("problem" in declared) return { problems: [declared.problem] };
  const params = declared.params;
  const body = templateBody(template);

  if (typeof body.use === "string") {
    problems.push({
      code: "TEMPLATE_INVALID",
      message: `Template '${name}' is itself a template instance ('use': '${body.use}'); templates do not nest.`,
      path: "/use",
      hint: "Expand the inner template into the package's own definition.",
    });
  }

  for (const argName of Object.keys(args)) {
    if (params[argName] !== undefined) continue;
    problems.push({
      code: "TEMPLATE_PARAM_UNKNOWN",
      message: `Template '${name}' has no parameter '${argName}'.`,
      path: `/with/${escapePointer(argName)}`,
      hint: Object.keys(params).length > 0
        ? `Its parameters are: ${Object.keys(params).join(", ")}.`
        : "It takes no parameters.",
    });
  }

  const values: Record<string, unknown> = {};
  for (const [paramName, spec] of Object.entries(params)) {
    if (Object.prototype.hasOwnProperty.call(args, paramName)) {
      values[paramName] = args[paramName];
    } else if (Object.prototype.hasOwnProperty.call(spec, "default")) {
      values[paramName] = spec.default;
    } else {
      problems.push({
        code: "TEMPLATE_PARAM_MISSING",
        message: `Template '${name}' needs parameter '${paramName}'.`,
        path: "/with",
        hint: spec.description
          ? `Pass "${paramName}" in "with": ${spec.description}`
          : `Pass "${paramName}" in "with".`,
      });
    }
  }

  const substitute = (value: unknown, at: string): unknown => {
    if (typeof value === "string") {
      const whole = WHOLE_PLACEHOLDER.exec(value);
      if (whole) {
        const paramName = whole[1]!;
        if (params[paramName] === undefined) {
          undeclared(paramName, at);
          return value;
        }
        return structuredClone(values[paramName]);
      }
      return value.replace(PLACEHOLDER, (match, paramName: string) => {
        if (params[paramName] === undefined) {
          undeclared(paramName, at);
          return match;
        }
        if (!Object.prototype.hasOwnProperty.call(values, paramName)) return match;
        const argument = values[paramName];
        if (isScalar(argument)) return String(argument);
        problems.push({
          code: "TEMPLATE_PARAM_NOT_SCALAR",
          message:
            `Template '${name}' interpolates '${paramName}' into text at '${at}', ` +
            `so it must be a string, number, or boolean, not ${describe(argument)}.`,
          path: Object.prototype.hasOwnProperty.call(args, paramName)
            ? `/with/${escapePointer(paramName)}`
            : "/use",
        });
        return match;
      });
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => substitute(entry, `${at}/${index}`));
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (new RegExp(PLACEHOLDER.source).test(key)) {
          problems.push({
            code: "TEMPLATE_PARAM_IN_KEY",
            message: `Template '${name}' has a placeholder in the key '${key}' at '${at}'; only values are substituted.`,
            path: "/use",
            hint: "Name the key literally, or make the value the parameter.",
          });
        }
        out[key] = substitute(entry, `${at}/${escapePointer(key)}`);
      }
      return out;
    }
    return value;
  };

  const undeclared = (paramName: string, at: string): void => {
    problems.push({
      code: "TEMPLATE_PARAM_UNDECLARED",
      message: `Template '${name}' uses '\${${paramName}}' at '${at}' but does not declare it in 'params'.`,
      path: "/use",
      hint: "Declare the parameter in the template's 'params', or remove the placeholder.",
    });
  };

  const expanded = substitute(body, "") as Record<string, unknown>;
  return problems.length > 0 ? { problems } : { value: expanded, problems };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "nothing";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
