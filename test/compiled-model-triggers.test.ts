import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "@kerangka/engine-ts";

/**
 * The compiler must not drop what the engine reads.
 *
 * `compileWorkflow` and the action branch of `compileDocument` each build the IR from an
 * allowlist of keys rather than by copying, so a key the language honours is dropped
 * unless somebody remembers to add it. `emit`, `after` and `timer` were all dropped, and
 * every production consumer runs `new Engine(kir)` — so a timed transition never fired and
 * the `emit` shorthand never emitted, through the only way anyone obtains an IR.
 *
 * The engine's own tests could not see it, because they build their IR by hand. Each one
 * passes a literal object that already contains `after`, so the compiler's allowlist is
 * never exercised. This file closes that gap from the other end: it starts from a document,
 * which is the only shape a user's model ever takes.
 *
 * It lives at the repository root because it crosses a package boundary on purpose. The
 * engine is IR-only by design (ADR-0005) and depends on nothing but `@kerangka/k1`, so
 * importing the compiler into `engine-ts` would be a dependency the package does not have.
 */
const ticketDoc = (transition: Record<string, unknown>) => ({
  kerangka: "0.1",
  app: "timer-test",
  entities: {
    Ticket: {
      fields: { id: "string!", status: "enum(open, in_progress, resolved) = open" },
      workflow: {
        field: "status",
        states: ["open", "in_progress", "resolved"],
        initial: "open",
        terminal: ["resolved"],
        transitions: {
          start: { from: "open", to: "in_progress" },
          autoResolve: transition
        }
      }
    }
  }
});

/** The document `engine-timers.test.ts` builds by hand, expressed as a document. */
const afterTransition = { from: "in_progress", to: "resolved", after: "P3D" };

describe("a compiled model keeps what the engine reads", () => {
  it("carries a transition's `after` into the IR", () => {
    const ir = compile(JSON.stringify(ticketDoc(afterTransition)));
    expect(ir.entities.Ticket.workflow?.transitions.autoResolve.after).toBe("P3D");
  });

  it("carries a transition's `timer`, in both forms", () => {
    // `timer` is either a duration or an object naming the delay or the moment to fire at.
    const duration = compile(
      JSON.stringify(ticketDoc({ from: "in_progress", to: "resolved", timer: "PT1H" }))
    );
    expect(duration.entities.Ticket.workflow?.transitions.autoResolve.timer).toBe("PT1H");

    const trigger = compile(
      JSON.stringify(ticketDoc({ from: "in_progress", to: "resolved", timer: { at: "dueAt" } }))
    );
    expect(trigger.entities.Ticket.workflow?.transitions.autoResolve.timer).toEqual({ at: "dueAt" });
  });

  it("carries a transition's `emit` into the IR", () => {
    const ir = compile(
      JSON.stringify(ticketDoc({ from: "in_progress", to: "resolved", emit: ["TicketResolved"] }))
    );
    expect(ir.entities.Ticket.workflow?.transitions.autoResolve.emit).toEqual(["TicketResolved"]);
  });

  it("carries an action's `emit` into the IR", () => {
    const ir = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "timer-test",
        entities: {
          Ticket: {
            fields: { id: "string!", status: "string = open" },
            actions: {
              close: {
                emit: ["TicketClosed"],
                do: [{ set: { status: "closed" } }]
              }
            }
          }
        }
      })
    );
    expect(ir.entities.Ticket.actions?.close?.emit).toEqual(["TicketClosed"]);
  });

  it("schedules the timer effect a timed transition declares", () => {
    // The end-to-end proof, and the reason the other three matter. The engine reads `after`
    // off the IR to arm a timer; with the key dropped, entering the state armed nothing and
    // the transition silently never fired. This is the assertion the suite was missing.
    const ir = compile(JSON.stringify(ticketDoc(afterTransition)));
    const engine = new Engine(ir);

    const plan = engine.plan(
      "Ticket",
      "start",
      { id: "tick-1", status: "open" },
      {},
      undefined,
      { now: "2026-09-28T10:00:00.000Z" }
    );

    expect(plan.ok).toBe(true);
    const timer = plan.effects?.find((effect) => effect.type === "timer");
    expect(timer, "a timed transition must arm a timer through a compiled model").toBeDefined();
    expect(timer).toMatchObject({
      action: "Ticket.autoResolve",
      target: "tick-1",
      at: "2026-10-01T10:00:00.000Z"
    });
  });

  it("emits the event an action declares", () => {
    // The other end of the same drop. `engine.ts` reads `action.emit` for the shorthand, so
    // with the key gone the action reported success and emitted nothing.
    const ir = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "timer-test",
        entities: {
          Ticket: {
            fields: { id: "string!", status: "string = open" },
            actions: { close: { emit: ["TicketClosed"], do: [{ set: { status: "closed" } }] } }
          }
        }
      })
    );
    const engine = new Engine(ir);

    const result = engine.run("Ticket", "close", { id: "t-1" }, {}, undefined, {
      now: "2026-09-28T10:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    const emitted = (result as { events?: Array<{ type?: string }> }).events ?? [];
    expect(emitted.map((event) => event.type)).toContain("TicketClosed");
  });
});