/**
 * The Kerangka model meta-schema, and an offline validator for it.
 *
 * ## Why this exists
 *
 * The compiler validated *names*: a field type that does not resolve, an entity that is not
 * declared, a function that does not exist. That is the semantic layer, and it works. What it
 * did not do was check that the document was *structurally* a model at all, and the result
 * was that a malformed document failed in one of three unhelpful ways:
 *
 * - An unknown key was ignored. A typo'd `fieds` dropped every field on the entity and
 *   compilation succeeded, which is the worst outcome available: a model that means something
 *   other than what was written, with no error.
 * - A malformed container was ignored. An entity that was the string `"Customer"` vanished
 *   from the compiled model.
 * - A field with no `type` reached the semantic layer and threw a raw `TypeError` — a stack
 *   trace in a user's face instead of a diagnostic with a pointer.
 *
 * So this is the L0 layer: does this document have the shape of a Kerangka model. It runs
 * before anything else touches the document, and a document that fails it is never compiled.
 *
 * ## No dependencies, on purpose
 *
 * There is no `ajv` here and no network fetch, and there will not be one. The compiler has to
 * run in a build that has not installed anything, on a machine that may be offline, and a
 * validator that cannot run is a validator nobody runs. So the checks are written out, and the
 * JSON Schema is published *alongside* them rather than being what executes.
 *
 * That creates the obvious risk: the schema and the validator are two descriptions of the same
 * shape and can drift. `meta-schema.test.ts` runs both over the same corpus of documents and
 * asserts they agree, which is the only thing keeping them honest.
 */

import { pointer, suggestion } from "./diagnostics.js";
import type { CompilerDiagnostic } from "./types.js";

export const MODEL_SCHEMA_URI = "https://kerangka.dev/schema/v0.1/model.schema.json";

/**
 * The keys a model document may declare at its root.
 *
 * Every one of these is real and read by the compiler. Anything else is a typo, and a typo
 * here is silent: the key is carried into the output and read by nothing.
 */
export const ROOT_KEYS = [
  "kerangka",
  "app",
  "$schema",
  "meta",
  "roles",
  "lint",
  "multitenancy",
  "packages",
  "types",
  "contexts",
  "traits",
  "entities",
  "queries",
  "events",
  "policies",
  "decisions",
  "defs",
  "schedules",
  "extensions",
  "views",
  "navigation",
  "examples"
] as const;

/** Root keys whose value must be a map of declarations. */
const MAP_KEYS = [
  "traits",
  "entities",
  "queries",
  "events",
  "policies",
  "decisions",
  "schedules",
  "extensions",
  "views"
] as const;

/** Root keys whose value must be an array. */
const LIST_KEYS = ["contexts", "roles", "navigation", "examples"] as const;

/** The keys an entity may declare. */
export const ENTITY_KEYS = [
  "actions",
  "embedded",
  "exclude",
  "fields",
  "invariants",
  "key",
  "permissions",
  "readFilter",
  "rules",
  "traits",
  "uses",
  "workflow"
] as const;

/** The keys a field may declare. */
export const FIELD_KEYS = [
  "compute",
  "default",
  "description",
  "element",
  "max",
  "min",
  "precision",
  "renamedFrom",
  "required",
  "scale",
  "target",
  "type",
  "unique",
  "values"
] as const;

/** The keys an entity's `workflow` may declare. */
export const WORKFLOW_KEYS = [
  "field",
  "states",
  "initial",
  "terminal",
  "final",
  "transitions",
  "tasks"
] as const;

/** The keys one transition may declare. */
export const TRANSITION_KEYS = [
  "from",
  "to",
  "roles",
  "when",
  "then",
  "emit",
  "after",
  "timer"
] as const;

/** The keys one action may declare. `do` is the declared name for the statement list. */
export const ACTION_KEYS = ["roles", "input", "when", "run", "emit", "do", "then"] as const;

/** The keys one rule may declare. */
export const RULE_KEYS = ["id", "field", "message", "check", "versions", "effectiveDate"] as const;

/**
 * The keys one invariant may declare.
 *
 * `InvariantDefinition` is three fields, all of them load-bearing: the compiler copies
 * whatever is present, so an invariant with no `assert` never fails and one with no `message`
 * fails with nothing to tell the user.
 */
export const INVARIANT_KEYS = ["id", "message", "assert"] as const;

/** The keys one period of a versioned rule may declare. */
export const VERSION_KEYS = ["validFrom", "validTo", "check", "message"] as const;

type Diagnostic = Omit<CompilerDiagnostic, "severity">;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class StructuralValidator {
  readonly diagnostics: Diagnostic[] = [];

  error(code: string, message: string, path: string, hint?: string): void {
    const duplicate = this.diagnostics.some(
      (d) => d.code === code && d.path === path && d.message === message
    );
    if (duplicate) return;
    this.diagnostics.push({ code, message, path, ...(hint ? { hint } : {}) });
  }

  /**
   * Check a map of string values, e.g. `packages` mapping a path to a package name.
   *
   * A separate check because `packages` is a map of strings, and putting it in `MAP_KEYS`
   * made every package in every generated workspace an error.
   */
  private checkStringMap(doc: Record<string, unknown>, key: string): void {
    const value = doc[key];
    if (value === undefined) return;
    if (!isPlainObject(value)) {
      this.error(
        "SCHEMA_INVALID",
        `'${key}' must be an object, not ${describe(value)}.`,
        pointer(key),
        `Write "${key}": { "name": "value" }.`
      );
      return;
    }
    for (const [name, entry] of Object.entries(value)) {
      if (typeof entry !== "string") {
        this.error(
          "SCHEMA_INVALID",
          `'${key}.${name}' must be a string, not ${describe(entry)}.`,
          pointer(key, name),
          `Each entry under '${key}' maps a name to a string.`
        );
      }
    }
  }

  /**
   * Check a map of declarations: every entry must be an object, unless the map is one whose
   * entries may be written as a string.
   *
   * The field shorthand is the exception, and it is handled in `validateFields` rather than
   * here, because it applies to the values under `entities.<name>.fields` and not to the
   * entity itself. Getting that wrong in the other direction let `{"Thing": "Thing"}` pass,
   * and the entity then vanished from the model without a word.
   */
  private checkMap(
    doc: Record<string, unknown>,
    key: string,
    allowShorthand = false,
    path: string = pointer(key)
  ): void {
    const value = doc[key];
    if (value === undefined) return;
    if (!isPlainObject(value)) {
      this.error(
        "SCHEMA_INVALID",
        `'${key}' must be an object of declarations, not ${describe(value)}.`,
        path,
        `Write "${key}": { "name": ... }, not "${key}": ${JSON.stringify(value)?.slice(0, 40)}.`
      );
      return;
    }
    for (const [name, declaration] of Object.entries(value)) {
      if (declaration === null || declaration === undefined) continue;
      // `types: { Money: "decimal(12,2)" }` is the same shorthand a field uses, and
      // rejecting it made a value type unusable in its short form.
      if (allowShorthand && typeof declaration === "string") continue;
      if (!isPlainObject(declaration)) {
        this.error(
          "SCHEMA_INVALID",
          `'${key}.${name}' must be an object, not ${describe(declaration)}.`,
          `${path}/${name}`,
          `Each entry under '${key}' declares something. A ${describe(declaration)} declares nothing.`
        );
      }
    }
  }

  private checkList(doc: Record<string, unknown>, key: string): void {
    const value = doc[key];
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.error(
        "SCHEMA_INVALID",
        `'${key}' must be an array, not ${describe(value)}.`,
        pointer(key),
        `Write "${key}": [ ... ], not "${key}": ${JSON.stringify(value)?.slice(0, 40)}.`
      );
    }
  }

  private unknownKeys(
    value: Record<string, unknown>,
    known: readonly string[],
    path: (key: string) => string,
    label: string
  ): void {
    for (const key of Object.keys(value)) {
      if ((known as readonly string[]).includes(key)) continue;
      this.error(
        "UNKNOWN_KEY",
        `Unknown ${label} '${key}'.`,
        path(key),
        suggestion(
          key,
          known,
          label === "entity key" ? "entity keys" : label === "field key" ? "field keys" : `${label}s`
        )
      );
    }
  }

  validate(doc: unknown): Diagnostic[] {
    if (!isPlainObject(doc)) {
      this.error("SCHEMA_INVALID", "Document root must be an object.", "", "A model is a JSON object.");
      return this.diagnostics;
    }

    this.unknownKeys(doc, ROOT_KEYS, pointer, "root key");

    if (doc.kerangka !== undefined && typeof doc.kerangka !== "string") {
      this.error(
        "SCHEMA_INVALID",
        `'kerangka' must be a version string, not ${describe(doc.kerangka)}.`,
        pointer("kerangka"),
        'Write "kerangka": "0.1".'
      );
    }
    if (doc.app !== undefined && typeof doc.app !== "string") {
      this.error(
        "SCHEMA_INVALID",
        `'app' must be a string, not ${describe(doc.app)}.`,
        pointer("app"),
        'Write "app": "invoicing".'
      );
    }

    for (const key of MAP_KEYS) this.checkMap(doc, key);
    this.checkMap(doc, "types", true);
    this.checkStringMap(doc, "packages");
    // `defs` holds named expressions written as strings — `isOverdue: "..."` — so it is a
    // string map like `packages`, not a map of declarations.
    this.checkStringMap(doc, "defs");
    for (const key of LIST_KEYS) this.checkList(doc, key);

    // Settings objects, checked as objects rather than as maps of declarations. Their
    // entries are strings, and treating them as declarations flagged every `meta.title` in
    // every example on the first attempt.
    for (const key of ["meta", "lint", "multitenancy"]) {
      const value = doc[key];
      if (value !== undefined && !isPlainObject(value)) {
        this.error(
          "SCHEMA_INVALID",
          `'${key}' must be an object, not ${describe(value)}.`,
          pointer(key),
          `Write "${key}": { ... }.`
        );
      }
    }
    if (isPlainObject(doc.multitenancy) && doc.multitenancy.strategy !== undefined) {
      const strategies = ["discriminator", "schema", "database"];
      if (!strategies.includes(doc.multitenancy.strategy as string)) {
        this.error(
          "SCHEMA_INVALID",
          `'multitenancy.strategy' must be one of ${strategies.join(", ")}.`,
          pointer("multitenancy", "strategy"),
          suggestion(String(doc.multitenancy.strategy), strategies, "strategies")
        );
      }
    }

    this.validateEntities(doc.entities);
    return this.diagnostics;
  }

  private validateEntities(entities: unknown): void {
    if (!isPlainObject(entities)) return;
    for (const [name, entity] of Object.entries(entities)) {
      if (!isPlainObject(entity)) continue; // already reported by checkMap
      const at = (key: string) => pointer("entities", name, key);
      this.unknownKeys(entity, ENTITY_KEYS, at, "entity key");

      const fields = entity.fields;
      if (fields !== undefined && !isPlainObject(fields)) {
        // Reached when `fields` is a list or a string. The entity's fields then disappear
        // from the compiled model without a word, which is the same silent loss as a typo'd
        // key and deserves the same treatment.
        this.error(
          "SCHEMA_INVALID",
          `'entities.${name}.fields' must be an object of field declarations, not ${describe(fields)}.`,
          at("fields"),
          `Write "fields": { "name": "string" }, not ${JSON.stringify(fields)?.slice(0, 40)}.`
        );
        return;
      }
      this.validateFields(fields, at("fields"), name);
      this.validateWorkflow(entity.workflow, at, name);
      this.validateActions(entity.actions, at, name);
      this.validateRules(entity.rules, at, name);
      this.validateInvariants(entity.invariants, at, name);
      this.validatePermissions(entity.permissions, at);
    }
  }

  /**
   * Check an entity's `rules`: the form each rule is written in, and each period of a
   * versioned one.
   *
   * A rule written as a bare expression compiled to an empty rule. Probed rather than assumed:
   * `rules: ["amount > 0"]` compiles, and the IR comes back as `rules: [{}]` — no id, no
   * check, no message. A rule that can never fire, out of a document the compiler called
   * valid, with no error anywhere. The string form *is* honoured on a trait, which is what
   * makes it easy to write here by accident.
   */
  private validateRules(
    rules: unknown,
    entityAt: (key: string) => string,
    entityName: string
  ): void {
    if (rules === undefined) return;
    const listPath = entityAt("rules");
    if (!Array.isArray(rules)) {
      this.error(
        "SCHEMA_INVALID",
        `'rules' must be an array of rule declarations, not ${describe(rules)}.`,
        listPath,
        `Write "rules": [ { "id": ..., "message": ..., "check": ... } ].`
      );
      return;
    }

    rules.forEach((rule, index) => {
      const at = (key: string) => `${listPath}/${index}${key ? `/${key}` : ""}`;
      if (!isPlainObject(rule)) {
        this.error(
          "SCHEMA_INVALID",
          `Rule ${index} of '${entityName}' must be an object, not ${describe(rule)}.`,
          `${listPath}/${index}`,
          `Each rule declares "id", "message" and "check". A bare expression here compiles to an empty rule that never fires.`
        );
        return;
      }

      this.unknownKeys(rule, RULE_KEYS, at, "rule key");

      // All three are load-bearing, and the IR keeps whatever is present. A rule with no `id`
      // cannot be named in a diagnostic; one with no `check` never fires; one with no `message`
      // fails with nothing to tell the user.
      if (rule.id === undefined) {
        this.error(
          "MISSING_RULE_ID",
          `Rule ${index} of '${entityName}' has no 'id'.`,
          at(""),
          `Every rule is named, for example "id": "amount-positive".`
        );
      } else if (typeof rule.id !== "string") {
        this.error(
          "SCHEMA_INVALID",
          `Rule ${index} of '${entityName}' has a non-string 'id'.`,
          at("id"),
          `Write "id": "amount-positive".`
        );
      }

      if (rule.message === undefined) {
        this.error(
          "MISSING_RULE_MESSAGE",
          `Rule ${index} of '${entityName}' has no 'message'.`,
          at(""),
          `Every rule says what it means, for example "message": "Amount must be positive".`
        );
      }

      if (rule.check === undefined) {
        this.error(
          "MISSING_RULE_CHECK",
          `Rule ${index} of '${entityName}' has no 'check'.`,
          at(""),
          `Every rule has a check, for example "check": "amount > 0".`
        );
      }

      this.checkString(rule, "field", at);
      this.checkString(rule, "effectiveDate", at);

      // `versions` being a list, and being non-empty, is already the compiler's business
      // (EFFECTIVE_VERSIONS_MALFORMED, EFFECTIVE_VERSIONS_EMPTY). Reporting it twice would
      // mean one fault with two codes, so this layer leaves the list's shape alone.
      if (rule.versions === undefined) return;
      if (!Array.isArray(rule.versions)) return; // the compiler already said so

      rule.versions.forEach((version, v) => {
        const vpath = `${at("versions")}/${v}`;
        if (!isPlainObject(version)) {
          this.error(
            "SCHEMA_INVALID",
            `Period ${v} of rule ${index} of '${entityName}' must be an object, not ${describe(version)}.`,
            vpath,
            `Each period declares "validFrom" and a "check".`
          );
          return;
        }
        this.unknownKeys(version, VERSION_KEYS, (key) => `${vpath}/${key}`, "version key");
        this.checkString(version, "validTo", (key) => `${vpath}/${key}`);
        // A period with no check is a date range during which the rule does not apply, which
        // reads in the model as coverage and behaves as a hole. `validFrom` is left alone: a
        // bad date is the verifier's business, and duplicating date parsing here would be the
        // two-places-to-keep-in-step problem ADR-0038 warns about.
        if (version.check === undefined) {
          this.error(
            "MISSING_VERSION_CHECK",
            `Period ${v} of rule ${index} of '${entityName}' has no 'check'.`,
            `${vpath}/check`,
            `Each period carries the check that was valid then, for example "check": "amount > 0".`
          );
        }
      });
    });
  }

  /**
   * Check an entity's `invariants`: the form each one is written in, and the two it cannot do
   * without.
   *
   * This is `validateRules` a second time, and it exists because the same silent loss was
   * waiting here. Probed rather than assumed: `invariants: ["amount > 0"]` compiles, and the
   * IR comes back as `invariants: [{}]` — no id, no message, no assert. The compiler reads
   * `inv.assert`, which on a string is `undefined`, so it copied `undefined` into all three
   * fields. An invariant that can never fail and can never be reported, out of a document the
   * compiler called valid.
   *
   * The string form *is* honoured on a trait, where the compiler gives it an id and a
   * message. That the two disagree is precisely why the form has to be stated on an entity
   * rather than inferred from the trait's behaviour.
   */
  private validateInvariants(
    invariants: unknown,
    entityAt: (key: string) => string,
    entityName: string
  ): void {
    if (invariants === undefined) return;
    const listPath = entityAt("invariants");
    if (!Array.isArray(invariants)) {
      this.error(
        "SCHEMA_INVALID",
        `'invariants' must be an array of invariant declarations, not ${describe(invariants)}.`,
        listPath,
        `Write "invariants": [ { "id": ..., "message": ..., "assert": ... } ].`
      );
      return;
    }

    invariants.forEach((invariant, index) => {
      const at = (key: string) => `${listPath}/${index}${key ? `/${key}` : ""}`;
      if (!isPlainObject(invariant)) {
        this.error(
          "SCHEMA_INVALID",
          `Invariant ${index} of '${entityName}' must be an object, not ${describe(invariant)}.`,
          `${listPath}/${index}`,
          `Each invariant declares "id", "message" and "assert". A bare expression here compiles to an empty invariant that never fails.`
        );
        return;
      }

      this.unknownKeys(invariant, INVARIANT_KEYS, at, "invariant key");

      if (invariant.id === undefined) {
        this.error(
          "MISSING_INVARIANT_ID",
          `Invariant ${index} of '${entityName}' has no 'id'.`,
          at(""),
          `Every invariant is named, for example "id": "amount-positive".`
        );
      } else if (typeof invariant.id !== "string") {
        this.error(
          "SCHEMA_INVALID",
          `Invariant ${index} of '${entityName}' has a non-string 'id'.`,
          at("id"),
          `Write "id": "amount-positive".`
        );
      }

      if (invariant.message === undefined) {
        this.error(
          "MISSING_INVARIANT_MESSAGE",
          `Invariant ${index} of '${entityName}' has no 'message'.`,
          at(""),
          `Every invariant says what it means, for example "message": "Amount must be positive".`
        );
      }

      if (invariant.assert === undefined) {
        this.error(
          "MISSING_INVARIANT_ASSERT",
          `Invariant ${index} of '${entityName}' has no 'assert'.`,
          at(""),
          `Every invariant has an assertion, for example "assert": "amount > 0".`
        );
      } else if (typeof invariant.assert !== "string" && !isPlainObject(invariant.assert)) {
        // An expression, so the two legal forms are the string and an already-parsed object.
        // What it *means* is the expression compiler's business; this only knows the forms.
        this.error(
          "SCHEMA_INVALID",
          `'assert' must be an expression, not ${describe(invariant.assert)}.`,
          at("assert"),
          `Write "assert": "amount > 0", or a parsed expression object.`
        );
      }
    });
  }

  /**
   * Check an entity's `permissions`: an operation map, and the two forms one operation's value
   * may be written in.
   *
   * The verifier walks a value two ways — an array of role names, or an object of role to
   * condition — and `examples/invoicing.kerangka.json` uses both in the same map: `read` is a
   * list, `update` is `{ admin: true, billing: "status == 'draft'" }`. Anything else matched
   * neither branch and was skipped, so the operation read as declared while granting nothing.
   * And `permissions: "admin"` was not an object at all, which skipped the whole block: the
   * roles in it then counted as having no permissions, the opposite of what the document said.
   *
   * A permission that grants nothing is a security-shaped hole, so this closes both.
   */
  private validatePermissions(
    permissions: unknown,
    entityAt: (key: string) => string
  ): void {
    if (permissions === undefined) return;
    const base = entityAt("permissions");
    if (!isPlainObject(permissions)) {
      this.error(
        "SCHEMA_INVALID",
        `'permissions' must be an object of operations, not ${describe(permissions)}.`,
        base,
        `Write "permissions": { "read": [ "admin" ] }, not "permissions": ${JSON.stringify(permissions)?.slice(0, 40)}.`
      );
      return;
    }

    for (const [operation, value] of Object.entries(permissions)) {
      const path = `${base}/${operation}`;

      if (Array.isArray(value)) {
        value.forEach((role, index) => {
          if (typeof role === "string") return;
          this.error(
            "SCHEMA_INVALID",
            `'${operation}[${index}]' must be a string, not ${describe(role)}.`,
            `${path}/${index}`,
            `Each entry in '${operation}' is one role name.`
          );
        });
        continue;
      }

      if (isPlainObject(value)) {
        for (const [role, condition] of Object.entries(value)) {
          // `true` grants unconditionally; a string is an expression the verifier evaluates.
          // A number is a permission that reads as present and grants nothing.
          if (condition === true || typeof condition === "string") continue;
          this.error(
            "SCHEMA_INVALID",
            `'${operation}/${role}' must be true, false, or an expression, not ${describe(condition)}.`,
            `${path}/${role}`,
            `Write "${operation}": { "${role}": true }, or "${operation}": { "${role}": "status == 'draft'" }.`
          );
        }
        continue;
      }

      this.error(
        "SCHEMA_INVALID",
        `'${operation}' must be an array of role names or an object of roles, not ${describe(value)}.`,
        path,
        `Write "${operation}": [ "admin" ], or "${operation}": { "admin": true }.`
      );
    }
  }

  /**
   * Check an entity's `actions`: the form each action is written in, and each one's keys.
   *
   * An action written as a string compiled to an empty action. `actionDef.when` on the string
   * `"send"` is `undefined` rather than an error, so the result was an action that existed in
   * the API and did nothing when called — the same silent loss as an entity written as a
   * string, one level down.
   */
  private validateActions(
    actions: unknown,
    entityAt: (key: string) => string,
    entityName: string
  ): void {
    if (actions === undefined) return;
    const at = (key: string) => `${entityAt("actions")}/${key}`;
    this.checkMap({ actions }, "actions", false, entityAt("actions"));

    if (!isPlainObject(actions)) return; // already reported by checkMap

    for (const [name, action] of Object.entries(actions)) {
      if (!isPlainObject(action)) continue; // already reported by checkMap
      const aat = (key: string) => `${at(name)}${key ? `/${key}` : ""}`;
      this.unknownKeys(action, ACTION_KEYS, aat, "action key");
      this.checkStringList(action.roles, "roles", aat("roles"), "role names");
      this.checkEmitList(action, aat);

      // `input` is a map of parameters in exactly the shape a field map is, so it gets the
      // same treatment — including the missing-`type` diagnostic, which is what stops an input
      // parameter reaching `normalizeField` with nothing to parse.
      if (action.input !== undefined) {
        if (!isPlainObject(action.input)) {
          this.error(
            "SCHEMA_INVALID",
            `'input' must be an object of parameters, not ${describe(action.input)}.`,
            aat("input"),
            `Write "input": { "name": "string" }.`
          );
        } else {
          this.validateFields(action.input, aat("input"), `${entityName}.${name}`);
        }
      }

      if (
        action.when !== undefined &&
        typeof action.when !== "string" &&
        !isPlainObject(action.when)
      ) {
        this.error(
          "SCHEMA_INVALID",
          `'when' must be an expression, not ${describe(action.when)}.`,
          aat("when"),
          `Write "when": "total > 0", or a parsed expression object.`
        );
      }

      // The compiler guards `run` with `typeof run === "object"`, so a string `run` is dropped
      // whole and the action quietly stops assigning anything.
      if (action.run !== undefined && !isPlainObject(action.run)) {
        this.error(
          "SCHEMA_INVALID",
          `'run' must be an object of assignments, not ${describe(action.run)}.`,
          aat("run"),
          `Write "run": { "field": "expression" }.`
        );
      }

      // `do` and `then` are the same list under two names, and both are read.
      for (const key of ["do", "then"] as const) {
        const statements = action[key];
        if (statements === undefined) continue;
        if (!Array.isArray(statements)) {
          this.error(
            "SCHEMA_INVALID",
            `'${key}' must be an array of statements, not ${describe(statements)}.`,
            aat(key),
            `Write "${key}": [ ... ], or omit it.`
          );
        }
      }
    }
  }

  /** Whether a field is written in a form this compiler understands. */
  private isFieldForm(value: unknown): value is string | Record<string, unknown> {
    if (typeof value === "string") return true; // the shorthand
    return isPlainObject(value);
  }

  private validateFields(fields: unknown, path: string, entityName: string): void {
    if (fields === undefined) return;
    if (!isPlainObject(fields)) return; // already reported by checkMap

    for (const [fieldName, field] of Object.entries(fields)) {
      if (!this.isFieldForm(field)) continue; // already reported by checkMap
      if (typeof field === "string") {
        // The shorthand carries its own diagnostics from `normalizeField`, which knows how
        // to parse `decimal(12,2) >= 0 = 0` and say which part it did not understand. This
        // layer only has to know the form is legal, not what it means.
        continue;
      }
      const definition = field;
      const at = (key: string) => `${path}/${fieldName}${key ? `/${key}` : ""}`;
      this.unknownKeys(definition, FIELD_KEYS, at, "field key");

      // The one that used to throw. A field with no `type` reached the semantic layer as
      // `undefined` and produced `Cannot read properties of undefined (reading 'length')` —
      // a stack trace instead of a diagnostic naming the field that has no type.
      if (definition.type === undefined) {
        this.error(
          "MISSING_FIELD_TYPE",
          `Field '${entityName}.${fieldName}' has no 'type'.`,
          at(""),
          `Every field declares a type, for example "type": "string".`
        );
        continue;
      }
      if (typeof definition.type !== "string") {
        this.error(
          "SCHEMA_INVALID",
          `Field '${entityName}.${fieldName}' has a non-string type.`,
          at("type"),
          `Write "type": "string", not ${JSON.stringify(definition.type)?.slice(0, 40)}.`
        );
      }
    }
  }

  /** Check a value that must be a string, such as `workflow.field`. */
  private checkString(holder: Record<string, unknown>, key: string, at: (key: string) => string): void {
    const value = holder[key];
    if (value === undefined) return;
    if (typeof value !== "string") {
      this.error(
        "SCHEMA_INVALID",
        `'${key}' must be a string, not ${describe(value)}.`,
        at(key),
        `Write "${key}": "name", not "${key}": ${JSON.stringify(value)?.slice(0, 40)}.`
      );
    }
  }

  /**
   * Check a value that must be a list of names: `states`, `terminal`, or a transition's `roles`.
   *
   * A non-string entry is the silent half again. The engine compares these entries against a
   * state or a role name one at a time, so `["draft", 7]` compiles clean and the transition
   * that names the second entry matches nothing anywhere.
   */
  private checkStringList(
    value: unknown,
    key: string,
    path: string,
    noun: string
  ): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      this.error(
        "SCHEMA_INVALID",
        `'${key}' must be an array of ${noun}, not ${describe(value)}.`,
        path,
        `Write "${key}": [ "name" ], not "${key}": ${JSON.stringify(value)?.slice(0, 40)}.`
      );
      return;
    }
    value.forEach((entry, index) => {
      if (typeof entry === "string") return;
      this.error(
        "SCHEMA_INVALID",
        `'${key}[${index}]' must be a string, not ${describe(entry)}.`,
        `${path}/${index}`,
        `Each entry in '${key}' is one ${noun.replace(/s$/, "")}.`
      );
    });
  }

  /**
   * Check an `emit` list: a list of event names, or of declarations naming one.
   *
   * The verifier and the AsyncAPI projector both read this off the raw document, so it is
   * legal input and this layer must not report it as an unknown key. It was missing from
   * `ActionDefinition` and `WorkflowTransition` entirely, which made every model using the
   * shorthand look like it had a typo.
   */
  private checkEmitList(holder: Record<string, unknown>, at: (key: string) => string): void {
    const emit = holder.emit;
    if (emit === undefined) return;
    if (!Array.isArray(emit)) {
      this.error(
        "SCHEMA_INVALID",
        `'emit' must be an array of event names or declarations, not ${describe(emit)}.`,
        at("emit"),
        `Write "emit": [ "InvoiceSent" ], or "emit": [ { "event": "InvoiceSent" } ].`
      );
      return;
    }
    emit.forEach((entry, index) => {
      if (typeof entry === "string" || isPlainObject(entry)) return;
      this.error(
        "SCHEMA_INVALID",
        `'emit[${index}]' must be an event name or a declaration object, not ${describe(entry)}.`,
        `${at("emit")}/${index}`,
        `Each entry in 'emit' names one event.`
      );
    });
  }

  /**
   * Check an entity's `workflow`: its own keys, the form of its states, and its transitions.
   *
   * `workflow` was the largest thing below an entity that nothing checked. A misspelled
   * `transisions` meant the transition map the author wrote was read by nobody: no state ever
   * changed, the model compiled clean, and there was no error to say so.
   */
  private validateWorkflow(
    workflow: unknown,
    entityAt: (key: string) => string,
    entityName: string
  ): void {
    if (workflow === undefined) return;
    if (!isPlainObject(workflow)) {
      this.error(
        "SCHEMA_INVALID",
        `'workflow' must be an object, not ${describe(workflow)}.`,
        entityAt("workflow"),
        `Write "workflow": { "transitions": { ... } }, not "workflow": ${JSON.stringify(workflow)?.slice(0, 40)}.`
      );
      return;
    }

    const at = (key: string) => `${entityAt("workflow")}/${key}`;
    this.unknownKeys(workflow, WORKFLOW_KEYS, at, "workflow key");
    this.checkString(workflow, "field", at);
    this.checkString(workflow, "initial", at);
    this.checkStringList(workflow.states, "states", at("states"), "state names");
    this.checkStringList(workflow.terminal, "terminal", at("terminal"), "state names");
    this.checkStringList(workflow.final, "final", at("final"), "state names");
    if (workflow.tasks !== undefined && !isPlainObject(workflow.tasks)) {
      this.error(
        "SCHEMA_INVALID",
        `'tasks' must be an object of task declarations, not ${describe(workflow.tasks)}.`,
        at("tasks"),
        `Write "tasks": { "name": { ... } }.`
      );
    }
    this.checkMap(workflow, "transitions", false, at("transitions"));
    this.validateTransitions(workflow.transitions, (name, key) => `${at("transitions")}/${name}${key ? `/${key}` : ""}`, entityName);
  }

  /** Check each transition's keys and the two it cannot do without. */
  private validateTransitions(
    transitions: unknown,
    at: (name: string, key?: string) => string,
    entityName: string
  ): void {
    if (!isPlainObject(transitions)) return; // already reported by checkMap

    for (const [name, transition] of Object.entries(transitions)) {
      if (!isPlainObject(transition)) continue; // already reported by checkMap
      this.unknownKeys(transition, TRANSITION_KEYS, (key) => at(name, key), "transition key");

      // Both are required, and neither has a sensible default: a transition that says where it
      // comes from but not where it goes has no next state, and the engine reads `to` to move.
      if (transition.from === undefined) {
        this.error(
          "MISSING_TRANSITION_FROM",
          `Transition '${entityName}.${name}' has no 'from'.`,
          at(name),
          `Every transition says which state it leaves, for example "from": "draft".`
        );
      } else if (!isStateOrStateList(transition.from)) {
        this.error(
          "SCHEMA_INVALID",
          `'from' must be a state name or an array of state names, not ${describe(transition.from)}.`,
          at(name, "from"),
          `Write "from": "draft", or "from": [ "draft", "sent" ].`
        );
      }

      if (transition.to === undefined) {
        this.error(
          "MISSING_TRANSITION_TO",
          `Transition '${entityName}.${name}' has no 'to'.`,
          at(name),
          `Every transition says which state it reaches, for example "to": "sent".`
        );
      } else if (typeof transition.to !== "string") {
        this.error(
          "SCHEMA_INVALID",
          `Transition '${entityName}.${name}' has a non-string 'to'.`,
          at(name, "to"),
          `Write "to": "sent", not ${JSON.stringify(transition.to)?.slice(0, 40)}.`
        );
      }

      this.checkStringList(transition.roles, "roles", at(name, "roles"), "role names");

      // A timed transition: `after` is a duration, and `timer` is a duration or an object
      // naming one. These are honoured by the engine (ADR-0015) and were missing from
      // `WorkflowTransition` for a while, which is how a legal timed transition ended up
      // looking like a typo to this layer. Declaring them is the fix that stops it recurring.
      if (transition.after !== undefined) this.checkString(transition, "after", (key) => at(name, key));
      if (transition.timer !== undefined && typeof transition.timer !== "string" && !isPlainObject(transition.timer)) {
        this.error(
          "SCHEMA_INVALID",
          `'timer' must be a duration or an object, not ${describe(transition.timer)}.`,
          at(name, "timer"),
          `Write "timer": "PT1H", or "timer": { "after": "PT1H" } / { "at": "sendAt" }.`
        );
      }

      // `when` is an expression, so it is either the string form or a parsed expression object.
      // What it *means* is the semantic layer's business; this only knows the two legal forms.
      if (transition.when !== undefined && typeof transition.when !== "string" && !isPlainObject(transition.when)) {
        this.error(
          "SCHEMA_INVALID",
          `'when' must be an expression, not ${describe(transition.when)}.`,
          at(name, "when"),
          `Write "when": "total > 0", or a parsed expression object.`
        );
      }

      this.checkEmitList(transition, (key) => at(name, key));

      if (transition.then !== undefined && !Array.isArray(transition.then)) {
        this.error(
          "SCHEMA_INVALID",
          `'then' must be an array of statements, not ${describe(transition.then)}.`,
          at(name, "then"),
          `Write "then": [ ... ], or omit it.`
        );
      }
    }
  }
}

/** Whether a transition's `from` is written in one of the two forms the language accepts. */
function isStateOrStateList(value: unknown): boolean {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * Check that a document has the shape of a Kerangka model.
 *
 * Returns diagnostics, empty when the document is structurally sound. Semantic problems —
 * a type that does not resolve, an entity that is not declared — are not this layer's
 * business and are left to the validator that already does them.
 */
export function validateModelStructure(doc: unknown): Diagnostic[] {
  return new StructuralValidator().validate(doc);
}

/**
 * The model document as a JSON Schema 2020-12 document.
 *
 * Published for editors and for anything that already has a validator, and kept in step with
 * `validateModelStructure` by a test that runs both over the same corpus. It is not what
 * executes: the compiler runs the checks above, because it cannot assume a validator is
 * installed and it needs messages a user can act on.
 */
export function modelSchema(): Record<string, unknown> {
  const mapOfObjects = { type: "object", additionalProperties: { type: "object" } } as const;

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: MODEL_SCHEMA_URI,
    title: "Kerangka model",
    description:
      "A Kerangka model document. Structural only: this says whether the document has the " +
      "shape of a model, not whether its names resolve. The compiler checks the rest.",
    type: "object",
    required: ["kerangka", "app"],
    properties: {
      $schema: { type: "string", format: "uri" },
      kerangka: { type: "string", description: "The model language version." },
      app: { type: "string", description: "The application's name." },
      meta: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          timezone: { type: "string" }
        },
        additionalProperties: true
      },
      roles: { type: "array", items: { type: "string" } },
      multitenancy: {
        type: "object",
        required: ["strategy"],
        properties: {
          strategy: { enum: ["discriminator", "schema", "database"] },
          field: { type: "string" },
          header: { type: "string" },
          claim: { type: "string" }
        },
        additionalProperties: false
      },
      contexts: { type: "array", items: { type: "string" } },
      types: mapOfObjects,
      packages: { type: "object", additionalProperties: { type: "string" } },
      traits: mapOfObjects,
      entities: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            fields: {
              type: "object",
              additionalProperties: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string" },
                  required: { type: "boolean" },
                  default: {},
                  unique: { type: "boolean" },
                  indexed: { type: "boolean" },
                  label: { type: "string" },
                  description: { type: "string" },
                  computed: { type: "boolean" },
                  ref: { type: "string" },
                  items: { type: "object" },
                  enum: { type: "array" }
                },
                additionalProperties: true
              }
            },
            rules: { type: "array" },
            invariants: { type: "array" },
            workflow: { type: "object" },
            permissions: { type: "object" },
            extends: { type: "string" }
          },
          additionalProperties: true
        }
      },
      queries: mapOfObjects,
      events: mapOfObjects,
      policies: mapOfObjects,
      decisions: mapOfObjects,
      schedules: mapOfObjects,
      extensions: mapOfObjects,
      views: mapOfObjects,
      navigation: { type: "array" },
      examples: { type: "array" },
      lint: { type: "object", additionalProperties: true },
      defs: { type: "object", additionalProperties: { type: "string" } }
    },
    // Deliberately not `additionalProperties: false`. An editor flagging an unrecognised key
    // is useful, but a *validator* that rejects one is wrong the moment the language gains
    // one, and the language gains them faster than schemas get updated. The compiler reports
    // unknown keys as a diagnostic, which is where a human reads them.
    additionalProperties: true
  };
}
