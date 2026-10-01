/**
 * The model meta-schema, and the two descriptions of it that can drift apart.
 *
 * There are two: the checks in `meta-schema.ts`, which is what the compiler runs, and the
 * JSON Schema it publishes, which is what an editor or any existing validator uses. Nothing
 * forces them to agree, so these tests do. Everything here is about the pair rather than
 * about either one alone.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/index.js";
import { CompilerError } from "../src/types.js";
import {
  validateModelStructure,
  modelSchema,
  ROOT_KEYS,
  ENTITY_KEYS,
  FIELD_KEYS,
  WORKFLOW_KEYS,
  TRANSITION_KEYS,
  ACTION_KEYS,
  RULE_KEYS,
  VERSION_KEYS,
  MODEL_SCHEMA_URI
} from "../src/meta-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

/** The keys of an interface, read from `types.ts` rather than from a list kept beside it. */
function interfaceKeys(interfaceName: string): string[] {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/types.ts"), "utf-8");
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found in types.ts`).toBeGreaterThan(-1);

  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  return [...new Set([...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1] as string))].sort();
}

const codes = (doc: unknown): string[] => validateModelStructure(doc).map((d) => d.code);
const messages = (doc: unknown): string[] => validateModelStructure(doc).map((d) => d.message);

/** Wrap a document in the smallest thing that compiles, so only the mutation is at fault. */
const minimal = () => ({
  kerangka: "0.1",
  app: "probe",
  entities: { Thing: { fields: { name: "string" } } }
});

describe("the model meta-schema", () => {
  describe("the key lists are derived from the types, not remembered", () => {
    it("knows every key EntityDefinition declares", () => {
      // The list was written from memory first and said `computed` where the language says
      // `compute`, which made every computed field in every shipped example an error. This
      // is the test that stops that recurring: the interface is the authority.
      const declared = interfaceKeys("EntityDefinition");
      const known = ENTITY_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `ENTITY_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key FieldDefinition declares", () => {
      const declared = interfaceKeys("FieldDefinition");
      const known = FIELD_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `FIELD_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key WorkflowDefinition declares", () => {
      // This list was first written by reading the interface, and the interface was wrong:
      // `after` and `timer` on a transition and `final` on the workflow are all read by the
      // engine and the verifier, and none of them was declared. So the interface declared
      // them, and this test is what keeps the two in step from now on.
      const declared = interfaceKeys("WorkflowDefinition");
      const known = WORKFLOW_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `WORKFLOW_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key WorkflowTransition declares", () => {
      const declared = interfaceKeys("WorkflowTransition");
      const known = TRANSITION_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `TRANSITION_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key ActionDefinition declares", () => {
      const declared = interfaceKeys("ActionDefinition");
      const known = ACTION_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `ACTION_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("lists no action key the language does not honour", () => {
      const honoured = new Set(interfaceKeys("ActionDefinition"));
      const extras = (ACTION_KEYS as readonly string[]).filter((k) => !honoured.has(k));
      expect(extras, `ACTION_KEYS has keys nothing reads: ${extras.join(", ")}`).toEqual([]);
    });

    it("knows every key RuleDefinition declares", () => {
      const declared = interfaceKeys("RuleDefinition");
      const known = RULE_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `RULE_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("knows every key RuleVersion declares", () => {
      const declared = interfaceKeys("RuleVersion");
      const known = VERSION_KEYS as readonly string[];
      const missing = declared.filter((key) => !known.includes(key));
      expect(missing, `VERSION_KEYS is missing: ${missing.join(", ")}`).toEqual([]);
    });

    it("lists no rule or version key the language does not honour", () => {
      const ruleExtras = (RULE_KEYS as readonly string[]).filter(
        (k) => !new Set(interfaceKeys("RuleDefinition")).has(k)
      );
      expect(ruleExtras, `RULE_KEYS has keys nothing reads: ${ruleExtras.join(", ")}`).toEqual([]);
      const versionExtras = (VERSION_KEYS as readonly string[]).filter(
        (k) => !new Set(interfaceKeys("RuleVersion")).has(k)
      );
      expect(
        versionExtras,
        `VERSION_KEYS has keys nothing reads: ${versionExtras.join(", ")}`
      ).toEqual([]);
    });

    it("declares every key the compiler reads off a workflow or a transition", () => {
      // The direction that caught `emit`. Deriving a key list from `types.ts` assumes the
      // interface is complete, and it was not: `final`, `after`, `timer` and `emit` were all
      // read by the compiler, the engine or the verifier while declared nowhere. Every one of
      // them would have been reported as a typo in a legal model. The list below is where such
      // a key gets added — if one turns up, add it to the interface first, then to the list.
      const readButUndeclared: Array<{ key: string; where: string; interfaces: string[] }> = [
        { key: "final", where: "verify/verifier.ts", interfaces: ["WorkflowDefinition"] },
        { key: "after", where: "engine-ts/engine.ts", interfaces: ["WorkflowTransition"] },
        { key: "timer", where: "engine-ts/engine.ts", interfaces: ["WorkflowTransition"] },
        { key: "emit", where: "verify/verifier.ts, projections/asyncapi.ts", interfaces: ["WorkflowTransition"] }
      ];

      for (const { key, where, interfaces } of readButUndeclared) {
        for (const interfaceName of interfaces) {
          expect(
            interfaceKeys(interfaceName),
            `'${key}' is read in ${where} but not declared on ${interfaceName}`
          ).toContain(key);
        }
      }
    });

    it("lists no workflow or transition key the language does not honour", () => {
      // The direction that changes behaviour. A padded transition list accepts `"condition"` and
      // drops it, so a transition that never fires looks identical to one that does.
      const honoured = (interfaceName: string) => new Set(interfaceKeys(interfaceName));
      const workflowExtras = (WORKFLOW_KEYS as readonly string[]).filter(
        (k) => !honoured("WorkflowDefinition").has(k)
      );
      expect(
        workflowExtras,
        `WORKFLOW_KEYS has keys nothing reads: ${workflowExtras.join(", ")}`
      ).toEqual([]);
      const transitionExtras = (TRANSITION_KEYS as readonly string[]).filter(
        (k) => !honoured("WorkflowTransition").has(k)
      );
      expect(
        transitionExtras,
        `TRANSITION_KEYS has keys nothing reads: ${transitionExtras.join(", ")}`
      ).toEqual([]);
    });

    it("lists no key the compiler does not honour", () => {
      // The other direction, and it is the one that changes behaviour. The vocabulary is
      // closed — `toJsonSchemaField` reads one key at a time — so a key that is neither
      // declared nor read does nothing whatever. A padded list accepts `"indexed": true` on a
      // field and drops it, which is the exact defect this layer exists to report.
      const honoured = (interfaceName: string, mapper: string) => {
        const declared = new Set(interfaceKeys(interfaceName));
        const source = fs.readFileSync(path.resolve(__dirname, mapper), "utf-8");
        const read = new Set([...source.matchAll(/field\.([a-zA-Z]+)/g)].map((m) => m[1] as string));
        // `js` comes from a `field.js` string in a code example; not a field key.
        read.delete("js");
        return new Set([...declared, ...read]);
      };

      const entityHonoured = honoured("EntityDefinition", "../src/types.ts");
      const entityExtras = (ENTITY_KEYS as readonly string[]).filter((k) => !entityHonoured.has(k));
      expect(
        entityExtras,
        `ENTITY_KEYS has keys nothing reads: ${entityExtras.join(", ")}`
      ).toEqual([]);

      const fieldHonoured = honoured("FieldDefinition", "../src/projections/json-schema-field.ts");
      const fieldExtras = (FIELD_KEYS as readonly string[]).filter((k) => !fieldHonoured.has(k));
      expect(
        fieldExtras,
        `FIELD_KEYS has keys nothing reads: ${fieldExtras.join(", ")}`
      ).toEqual([]);
    });

    it("reports a field key the language does not honour, rather than dropping it", () => {
      // What the trimmed list buys. `indexed` reads nothing anywhere in the compiler, so
      // writing it used to succeed and do nothing — the silent half of a typo.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: "string", indexed: true } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("UNKNOWN_KEY");
      const reported = diagnostics.find((d) => d.path?.endsWith("/indexed"));
      expect(reported?.message).toMatch(/'indexed'/);
    });
  });

  describe("an entity's workflow is checked for shape, not only for its key list", () => {
    const withWorkflow = (workflow: unknown) => ({
      ...minimal(),
      entities: { Thing: { fields: { state: "string" }, workflow } }
    });

    it("accepts a workflow written the way the language writes one", () => {
      const doc = withWorkflow({
        field: "state",
        states: ["draft", "sent", "paid"],
        initial: "draft",
        terminal: ["paid"],
        transitions: {
          send: { from: "draft", to: "sent", roles: ["admin"], when: "total > 0", then: [] },
          settle: { from: ["sent", "draft"], to: "paid" }
        },
        tasks: { chase: { assignTo: "admin" } }
      });
      expect(codes(doc)).toEqual([]);
    });

    it("accepts a timed transition, which the engine honours", () => {
      // The regression this guards is not hypothetical. `after` and `timer` are read by the
      // engine (ADR-0015) and were missing from `WorkflowTransition`, so a strict check built
      // from the interface alone reported every timed transition as a typo — refusing a legal
      // model to catch an illegal one. The engine is the authority; the interface now says so.
      const doc = withWorkflow({
        states: ["draft", "sent"],
        transitions: {
          lapse: { from: "draft", to: "sent", after: "P7D" },
          remind: { from: "draft", to: "sent", timer: { after: "P1D" } },
          fire: { from: "draft", to: "sent", timer: { at: "sendAt" } },
          plain: { from: "draft", to: "sent", timer: "PT1H" }
        }
      });
      expect(codes(doc)).toEqual([]);
    });

    it("accepts `final` as the alias the workflow verifier reads", () => {
      // `verifyWorkflows` reads `workflow.terminal || workflow.final` off the raw document, so
      // `final` is honoured input. Rejecting it would break every model that used the alias.
      const doc = withWorkflow({ states: ["draft", "paid"], final: ["paid"], transitions: {} });
      expect(codes(doc)).toEqual([]);
    });

    it("accepts an `emit` list, which the verifier and AsyncAPI projector read", () => {
      // Same class of trap as `after` and `timer`, and worse: `emit` was read off the *raw*
      // document by three separate consumers — the event verifier, the AsyncAPI projector and
      // the engine — while appearing in no interface at all. A structural check built from the
      // interfaces alone therefore reported every event shorthand as a typo. The test below
      // records the rule so the next key that is read but undeclared fails here instead.
      const doc = withWorkflow({
        transitions: {
          send: { from: "draft", to: "sent", emit: ["InvoiceSent"] },
          settle: { from: "sent", to: "paid", emit: [{ event: "InvoicePaid", data: { total: "total" } }] }
        }
      });
      expect(codes(doc)).toEqual([]);
    });

    it("rejects an emit list holding something that is not an event", () => {
      const doc = withWorkflow({ transitions: { send: { from: "d", to: "s", emit: [7] } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/emit\[0\]/);
    });

    it("rejects an emit list that is not a list", () => {
      const doc = withWorkflow({ transitions: { send: { from: "d", to: "s", emit: "InvoiceSent" } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'emit' must be an array/);
    });

    it("rejects a timer that is neither a duration nor a trigger object", () => {
      const doc = withWorkflow({ transitions: { lapse: { from: "draft", to: "sent", timer: 7 } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'timer' must be a duration/);
    });

    it("rejects tasks declared as something other than a map", () => {
      const doc = withWorkflow({ transitions: {}, tasks: [] });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'tasks' must be an object/);
    });

    it("rejects a `when` that is neither an expression string nor an expression object", () => {
      const doc = withWorkflow({ transitions: { send: { from: "draft", to: "sent", when: 7 } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'when' must be an expression/);
    });

    it("rejects a workflow that is not an object, instead of dropping it", () => {
      const doc = withWorkflow("draft");
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const reported = validateModelStructure(doc).find(
        (d) => d.path === "/entities/Thing/workflow"
      );
      expect(reported?.message).toMatch(/must be an object/);
    });

    it("reports an unknown workflow key, and says what it might have been", () => {
      // The same defect as a typo'd `fieds`, one level down: the transition map the author
      // wrote under a misspelled key was read by nothing, and compilation succeeded.
      const doc = withWorkflow({ transisions: { send: { from: "draft", to: "sent" } } });
      const diagnostic = validateModelStructure(doc).find(
        (d) => d.code === "UNKNOWN_KEY" && d.path === "/entities/Thing/workflow/transisions"
      );
      expect(diagnostic?.message).toMatch(/'transisions'/);
      expect(diagnostic?.hint).toBe("Did you mean 'transitions'?");
    });

    it("rejects transitions that are not a map of declarations", () => {
      const doc = withWorkflow({ states: ["draft"], transitions: [] });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'transitions' must be an object/);
    });

    it("rejects a transition that is not an object, instead of dropping it", () => {
      const doc = withWorkflow({ transitions: { send: "send" } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const reported = validateModelStructure(doc).find(
        (d) => d.path === "/entities/Thing/workflow/transitions/send"
      );
      expect(reported?.message).toMatch(/must be an object, not a string/);
    });

    it("reports an unknown transition key", () => {
      const doc = withWorkflow({ transitions: { send: { from: "draft", too: "sent" } } });
      const diagnostic = validateModelStructure(doc).find(
        (d) => d.code === "UNKNOWN_KEY" && d.path === "/entities/Thing/workflow/transitions/send/too"
      );
      // `too` for `to` is the near miss that would otherwise drop the transition's target.
      expect(diagnostic?.hint).toBe("Did you mean 'to'?");
    });

    it("requires a transition to say where it goes and where it comes from", () => {
      // Both are required by `WorkflowTransition`, and a transition missing `to` has no
      // meaning: the engine reads `to` to decide the next state and finds nothing there.
      const doc = withWorkflow({ transitions: { send: { roles: ["admin"] } } });
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_TRANSITION_FROM");
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_TRANSITION_TO");
      const reported = diagnostics.find((d) => d.code === "MISSING_TRANSITION_FROM");
      expect(reported?.path).toBe("/entities/Thing/workflow/transitions/send");
      expect(reported?.message).toMatch(/Thing\.send/);
    });

    it("rejects a non-string target, which would reach the engine as undefined", () => {
      const doc = withWorkflow({ transitions: { send: { from: "draft", to: 42 } } });
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("SCHEMA_INVALID");
      expect(
        diagnostics.find((d) => d.path === "/entities/Thing/workflow/transitions/send/to")?.message
      ).toMatch(/non-string/);
    });

    it("rejects a source that is neither a state nor a list of states", () => {
      const doc = withWorkflow({ transitions: { send: { from: { state: "draft" }, to: "sent" } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'from'/);
    });

    it("accepts a source written as a list of states", () => {
      const doc = withWorkflow({ transitions: { settle: { from: ["draft", "sent"], to: "paid" } } });
      expect(codes(doc)).toEqual([]);
    });

    it("rejects states declared as something other than a list", () => {
      const doc = withWorkflow({ states: "draft", transitions: {} });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'states' must be an array of state names/);
    });

    it("rejects a state list holding something that is not a state name", () => {
      const doc = withWorkflow({ states: ["draft", 7], transitions: {} });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/states\[1\]/);
    });

    it("rejects roles declared as a single string rather than a list", () => {
      const doc = withWorkflow({ transitions: { send: { from: "draft", to: "sent", roles: "admin" } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'roles' must be an array/);
    });

    it("rejects then declared as something other than a list of statements", () => {
      const doc = withWorkflow({ transitions: { send: { from: "draft", to: "sent", then: {} } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'then' must be an array/);
    });

    it("rejects a non-string field, which is the field the state lives in", () => {
      const doc = withWorkflow({ field: 7, transitions: {} });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'field' must be a string/);
    });

    it("refuses to compile a document whose workflow is structurally wrong", () => {
      // The layer is only worth anything if the compiler honours it: the check has to run
      // before the workflow is read, the same way a parse error is treated.
      const doc = withWorkflow({ transisions: {} });
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CompilerError);
      const diagnostics = (thrown as CompilerError).diagnostics ?? [];
      expect(diagnostics.map((d) => d.code)).toContain("UNKNOWN_KEY");
    });
  });

  describe("an entity's actions are checked for shape, not only for their key list", () => {
    const withActions = (actions: unknown) => ({
      ...minimal(),
      entities: { Thing: { fields: { name: "string" }, actions } }
    });

    it("accepts actions written the way the language writes them", () => {
      const doc = withActions({
        rename: {
          roles: ["admin"],
          input: { to: "string", count: { type: "int" } },
          when: "name != ''",
          run: { name: "to" },
          emit: ["ThingRenamed"],
          do: [{ set: { name: "to" } }]
        },
        // `then` is the accepted spelling of the same statement list.
        touch: { then: [{ set: { name: "name" } }] }
      });
      expect(codes(doc)).toEqual([]);
    });

    it("rejects an action written as a string, which compiled to an empty action", () => {
      // `actionDef.when` on the string "send" is `undefined` rather than an error, so the
      // action compiled to an object with nothing in it: present in the API, inert at run
      // time, and no error anywhere. The same silent loss as an entity written as a string.
      const doc = withActions({ send: "send" });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const reported = validateModelStructure(doc).find(
        (d) => d.path === "/entities/Thing/actions/send"
      );
      expect(reported?.message).toMatch(/must be an object, not a string/);
    });

    it("rejects actions declared as a list", () => {
      const doc = withActions(["send"]);
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'actions' must be an object/);
    });

    it("reports an unknown action key", () => {
      const doc = withActions({ send: { role: ["admin"] } });
      const diagnostic = validateModelStructure(doc).find(
        (d) => d.code === "UNKNOWN_KEY" && d.path === "/entities/Thing/actions/send/role"
      );
      expect(diagnostic?.hint).toBe("Did you mean 'roles'?");
    });

    it("knows both `do` and `then` as the statement list", () => {
      // `do` is the declared name from PLAN.md 5.6 and `then` is accepted, so a model using
      // either must compile. Reporting the other as a typo would break half the examples.
      expect(codes(withActions({ a: { do: [] } }))).toEqual([]);
      expect(codes(withActions({ a: { then: [] } }))).toEqual([]);
    });

    it("rejects a run block that is not a map of assignments", () => {
      // `typeof run === "object"` is the compiler's guard, so a string `run` is dropped whole.
      const doc = withActions({ send: { run: "name" } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'run' must be an object/);
    });

    it("rejects a statement list that is not a list", () => {
      const doc = withActions({ send: { do: { set: { name: "x" } } } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'do' must be an array/);
    });

    it("rejects roles declared as a single string rather than a list", () => {
      const doc = withActions({ send: { roles: "admin" } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'roles' must be an array/);
    });

    it("rejects input declared as something other than a map of parameters", () => {
      const doc = withActions({ send: { input: ["to"] } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'input' must be an object/);
    });

    it("rejects an input parameter with no type, naming the action as well as the entity", () => {
      const doc = withActions({ send: { input: { to: { required: true } } } });
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_FIELD_TYPE");
      const reported = diagnostics.find((d) => d.code === "MISSING_FIELD_TYPE");
      expect(reported?.path).toBe("/entities/Thing/actions/send/input/to");
      expect(reported?.message).toMatch(/Thing\.send\.to/);
    });

    it("rejects a `when` that is neither an expression string nor an expression object", () => {
      const doc = withActions({ send: { when: 7 } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'when' must be an expression/);
    });

    it("refuses to compile a document whose actions are structurally wrong", () => {
      const doc = withActions({ send: "send" });
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CompilerError);
    });

    it("still compiles a sound action", () => {
      const doc = withActions({ rename: { input: { to: "string" }, do: [{ set: { name: "to" } }] } });
      expect(() => compile(JSON.stringify(doc))).not.toThrow();
    });
  });

  describe("an entity's rules are checked for shape", () => {
    const withRules = (rules: unknown) => ({
      ...minimal(),
      entities: { Thing: { fields: { amount: "decimal(12,2)" }, rules } }
    });

    it("accepts a rule written the way the language writes one", () => {
      const doc = withRules([
        {
          id: "positive",
          field: "amount",
          message: "Amount must be positive",
          check: "amount > 0",
          effectiveDate: "ctx.now",
          versions: [
            { validFrom: "2026-01-01", check: "amount > 0" },
            { validFrom: "2026-06-01", validTo: "2026-12-31", check: "amount > 10", message: "Higher floor" }
          ]
        }
      ]);
      expect(codes(doc)).toEqual([]);
    });

    it("rejects a rule written as a bare expression, which compiled to an empty rule", () => {
      // Probed, not assumed: `rules: ["amount > 0"]` compiles, and the IR comes back as
      // `rules: [{}]` — no id, no check, no message. A rule that can never fire and can never
      // be reported, out of a document the compiler called valid. The string form *is*
      // supported on a trait, which is why this is easy to write by accident.
      const doc = withRules(["amount > 0"]);
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const reported = validateModelStructure(doc).find(
        (d) => d.path === "/entities/Thing/rules/0"
      );
      expect(reported?.message).toMatch(/must be an object, not a string/);
      expect(reported?.hint).toMatch(/id.*message.*check|"check"/s);
    });

    it("rejects rules declared as something other than a list", () => {
      const doc = withRules({ positive: { check: "amount > 0" } });
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'rules' must be an array/);
    });

    it("requires a rule to say what it is, what it says, and what it checks", () => {
      // `id` and `check` are both load-bearing: the IR keeps whatever is there, so a rule with
      // no id is unnameable in a diagnostic and a rule with no check never fires.
      const doc = withRules([{ field: "amount" }]);
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_RULE_ID");
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_RULE_CHECK");
      const reported = diagnostics.find((d) => d.code === "MISSING_RULE_ID");
      expect(reported?.path).toBe("/entities/Thing/rules/0");
      expect(reported?.message).toMatch(/Thing/);
    });

    it("rejects a rule with no message, which fails with nothing to tell the user", () => {
      const doc = withRules([{ id: "positive", check: "amount > 0" }]);
      expect(codes(doc)).toContain("MISSING_RULE_MESSAGE");
    });

    it("reports an unknown rule key", () => {
      const doc = withRules([{ id: "r", message: "m", check: "amount > 0", when: "amount > 0" }]);
      const diagnostic = validateModelStructure(doc).find(
        (d) => d.code === "UNKNOWN_KEY" && d.path === "/entities/Thing/rules/0/when"
      );
      expect(diagnostic?.hint).toMatch(/Valid rule keys|Did you mean/);
    });

    it("rejects a non-string field on a rule", () => {
      const doc = withRules([{ id: "r", message: "m", check: "amount > 0", field: 7 }]);
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/'field' must be a string/);
    });

    it("requires each period of a versioned rule to carry a check", () => {
      // A period with no check is a date range during which the rule does not apply, which
      // reads in the model as coverage and behaves as a hole.
      const doc = withRules([
        { id: "r", message: "m", check: "amount > 0", versions: [{ validFrom: "2026-01-01" }] }
      ]);
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_VERSION_CHECK");
      expect(
        diagnostics.find((d) => d.code === "MISSING_VERSION_CHECK")?.path
      ).toBe("/entities/Thing/rules/0/versions/0/check");
    });

    it("rejects a period that is not an object", () => {
      const doc = withRules([
        { id: "r", message: "m", check: "amount > 0", versions: ["2026-01-01"] }
      ]);
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(
        validateModelStructure(doc).find((d) => d.path?.endsWith("/versions/0"))?.message
      ).toMatch(/must be an object, not a string/);
    });

    it("reports an unknown key on a period", () => {
      const doc = withRules([
        {
          id: "r",
          message: "m",
          check: "amount > 0",
          versions: [{ validFrom: "2026-01-01", check: "amount > 0", validuntil: "2026-12-31" }]
        }
      ]);
      const diagnostic = validateModelStructure(doc).find(
        (d) => d.code === "UNKNOWN_KEY" && d.path?.includes("/versions/0/validuntil")
      );
      // The near miss that would otherwise leave a period open-ended. `validuntil` is far
      // enough from `validTo` that the fuzzy match declines, so the hint lists the keys — which
      // is the part that still tells the author what to write.
      expect(diagnostic?.hint).toMatch(/validTo/);
    });

    it("refuses to compile a document whose rules are structurally wrong", () => {
      const doc = withRules(["amount > 0"]);
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CompilerError);
    });

    it("still compiles a sound rule", () => {
      const doc = withRules([{ id: "positive", message: "Must be positive", check: "amount > 0" }]);
      expect(() => compile(JSON.stringify(doc))).not.toThrow();
    });
  });

  describe("it does not reject Kerangka's own examples", () => {
    // The first version of this file flagged every entity in every example, because it
    // checked that a field's value was an object and the field shorthand writes it as a
    // string. A meta-schema that rejects the shipped models is not a meta-schema.
    for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith(".json"))) {
      it(`accepts ${file}`, () => {
        const source = fs.readFileSync(path.join(examplesDir, file), "utf-8");
        const doc = JSON.parse(source);
        const diagnostics = validateModelStructure(doc);
        expect(
          diagnostics.map((d) => `${d.code} ${d.path}: ${d.message}`)
        ).toEqual([]);
      });
    }
  });

  describe("a malformed document is a diagnostic, not a crash or a silent success", () => {
    /**
     * Each of these passed through the compiler untouched before. A typo'd key dropped every
     * field on the entity and compiled clean, which is the worst outcome available: a model
     * that means something other than what was written, with no error to say so.
     */
    it("rejects an unknown root key, and says what it might have been", () => {
      const doc = { ...minimal(), totallyUnknownKey: { a: 1 } };
      expect(codes(doc)).toContain("UNKNOWN_KEY");
      const diagnostic = validateModelStructure(doc).find((d) => d.code === "UNKNOWN_KEY");
      expect(diagnostic?.path).toBe("/totallyUnknownKey");
      expect(diagnostic?.hint).toMatch(/Did you mean|Valid root keys/);
    });

    it("suggests the right key for a near miss", () => {
      // `fieds` is the typo this whole layer exists for, and the suggestion is the part that
      // saves the author's afternoon.
      const doc = { ...minimal(), entities: { Thing: { fieds: { name: "string" } } } };
      const diagnostic = validateModelStructure(doc).find((d) => d.code === "UNKNOWN_KEY");
      expect(diagnostic?.hint).toBe("Did you mean 'fields'?");
    });

    it("rejects an entity that is not an object, instead of dropping it", () => {
      const doc = { ...minimal(), entities: { Thing: "Thing" } };
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      const diagnostic = validateModelStructure(doc).find((d) => d.path === "/entities/Thing");
      expect(diagnostic?.message).toMatch(/must be an object, not a string/);
    });

    it("rejects a field with no type, which used to throw a TypeError", () => {
      // Before this layer, a field declared `{ "required": true }` reached the semantic
      // validator as `undefined` and produced `Cannot read properties of undefined (reading
      // 'length')` — a stack trace in a user's face instead of a diagnostic with a pointer.
      const doc = { ...minimal(), entities: { Thing: { fields: { nickname: { required: true } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_FIELD_TYPE");
      const diagnostic = diagnostics.find((d) => d.code === "MISSING_FIELD_TYPE");
      expect(diagnostic?.path).toBe("/entities/Thing/fields/nickname");
      expect(diagnostic?.message).toMatch(/Thing\.nickname/);
    });

    it("rejects fields declared as a list", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: [] } } };
      expect(codes(doc)).toContain("SCHEMA_INVALID");
      expect(messages(doc).join()).toMatch(/fields' must be an object of field declarations/);
    });

    it("rejects a non-string type rather than passing it to the resolver", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: 42 } } } } };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("SCHEMA_INVALID");
      expect(diagnostics.find((d) => d.path?.endsWith("/type"))?.message).toMatch(/non-string type/);
    });

    it("leaves an unresolvable type to the semantic validator", () => {
      // `"type": "NotAType"` is well-formed and does not resolve. It is not this layer's
      // job, and duplicating the resolver here would mean two places to keep in step.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { type: "NotAType" } } } } };
      expect(codes(doc)).toEqual([]);
      // And it is still caught, by the layer that owns it.
      expect(() => compile(JSON.stringify(doc))).toThrow(CompilerError);
    });

    it("rejects a root key that should be a list but is a scalar", () => {
      const doc = { ...minimal(), roles: "admin" };
      const diagnostics = validateModelStructure(doc);
      expect(diagnostics.map((d) => d.code)).toContain("SCHEMA_INVALID");
      const reported = diagnostics.find((d) => d.path === "/roles");
      expect(reported?.message).toMatch(/'roles' must be an array/);
    });
  });

  describe("the compiler runs it before anything else touches the document", () => {
    it("reports a structural error as a diagnostic with a pointer, not a TypeError", () => {
      const doc = { ...minimal(), entities: { Thing: { fields: { nickname: { required: true } } } } };
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CompilerError);
      const diagnostics = (thrown as CompilerError).diagnostics ?? [];
      expect(diagnostics.map((d) => d.code)).toContain("MISSING_FIELD_TYPE");
      const reported = diagnostics.find((d) => d.code === "MISSING_FIELD_TYPE");
      expect(reported?.path).toBe("/entities/Thing/fields/nickname");
    });

    it("collects every structural error rather than stopping at the first", () => {
      // One error per run is a worse experience than a list, and a structural layer that
      // bails early makes the author fix-and-rerun once per mistake.
      const doc = {
        ...minimal(),
        bogusRoot: 1,
        entities: { Thing: { fieds: {}, fields: { a: { required: true } } } }
      };
      let thrown: unknown;
      try {
        compile(JSON.stringify(doc));
      } catch (err) {
        thrown = err;
      }
      const diagnostics: Array<{ code: string }> = (thrown as CompilerError).diagnostics ?? [];
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    });

    it("still compiles a sound document", () => {
      expect(compile(JSON.stringify(minimal())).app).toBe("probe");
    });
  });

  describe("the published schema and the checks describe the same shape", () => {
    const schema = modelSchema() as {
      required: string[];
      properties: Record<string, unknown>;
      $id: string;
    };

    it("is a 2020-12 document with a stable id", () => {
      expect((schema as Record<string, unknown>).$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema"
      );
      expect(schema.$id).toBe(MODEL_SCHEMA_URI);
    });

    it("requires the same root keys the checks do", () => {
      // `app` is checked by the compiler's own MISSING_APP_NAME, and `kerangka` here; the
      // schema has to agree or an editor will accept a document the compiler refuses.
      expect(schema.required).toEqual(expect.arrayContaining(["kerangka", "app"]));
    });

    it("names every root key the checks know", () => {
      // Not `additionalProperties: false` — see below — but a key the schema is silent about
      // is a key an editor will grey out or mis-complete.
      for (const key of ROOT_KEYS) {
        expect(schema.properties, `the schema is silent about '${key}'`).toHaveProperty(key);
      }
    });

    it("permits unknown root keys, and says why in the schema itself", () => {
      // The checks report an unknown key as a diagnostic. A validator that *rejected* one
      // would be wrong the moment the language gains a key, and the language gains them
      // faster than schemas get updated. So the schema is permissive and the compiler is
      // strict: a human reads the diagnostic, a tool is not blocked by a stale schema.
      expect((schema as Record<string, unknown>).additionalProperties).toBe(true);
    });

    it("agrees with the checks about a field needing a type", () => {
      const entity = schema.properties.entities as {
        additionalProperties: { properties: { fields: { additionalProperties: { required: string[] } } } }
      };
      expect(entity.additionalProperties.properties.fields.additionalProperties.required).toEqual([
        "type"
      ]);
      // And the checks agree: both reject a field with no type.
      const doc = { ...minimal(), entities: { Thing: { fields: { n: { required: true } } } } };
      expect(codes(doc)).toContain("MISSING_FIELD_TYPE");
    });
  });
});

describe("the published schema file", () => {
  const schemaPath = path.resolve(__dirname, "../schemas/kerangka.model.schema.json");

  it("exists, so an editor has something to point $schema at", () => {
    // The schema is only useful if it is reachable. `modelSchema()` is what the tests
    // check; this is what a human's editor reads, and the two drifting is the whole risk.
    expect(fs.existsSync(schemaPath), `${schemaPath} is missing`).toBe(true);
  });

  it("is the same document the compiler validates against", () => {
    const published = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    expect(published).toEqual(modelSchema());
  });
});
