import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runScenario } from "../src/index.js";

/**
 * The approval flow, through the path the console uses.
 *
 * The console runs a scenario against the real engine with a named actor, so this is
 * the same code the designer sees. The point of the flow is not that it works: it is
 * that the refusal is a refusal, and that a refused call changes nothing.
 */

const model = readFileSync(new URL("../../cli/test/fixtures/studio/approval.kerangka.json", import.meta.url), "utf8");

const draft = { id: "request-1", employeeId: "employee-1", title: "Synthetic leave", days: 2, status: "draft" };
const employee = { id: "employee-1", roles: ["employee"] };
const manager = { id: "manager-1", roles: ["manager"] };
const now = "2026-10-16T09:00:00Z";

describe("the approval flow in the console's sandbox", () => {
  it("lets an employee submit and a manager approve, and the record says so", () => {
    const submitted = runScenario(model, "Request", "submit", draft, employee, now);
    expect(submitted.ok).toBe(true);
    expect(submitted.record?.status).toBe("submitted");

    const approved = runScenario(model, "Request", "approve", submitted.record!, manager, now);
    expect(approved.ok).toBe(true);
    expect(approved.record?.status).toBe("approved");
    expect(approved.effects.some((effect) => (effect as { type?: string }).type === "persist")).toBe(true);
  });

  it("refuses an employee who tries to approve, and changes nothing", () => {
    const submitted = runScenario(model, "Request", "submit", draft, employee, now);
    const denied = runScenario(model, "Request", "approve", submitted.record!, employee, now);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("PERMISSION_DENIED");
    // The refused call did not move the record.
    expect(denied.record ?? submitted.record?.status).toBe("submitted");
  });

  it("refuses an anonymous caller", () => {
    const denied = runScenario(model, "Request", "submit", draft, { id: "nobody", roles: [] }, now);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a manager who approves their own request", () => {
    const submitted = runScenario(model, "Request", "submit", draft, employee, now);
    const denied = runScenario(
      model,
      "Request",
      "approve",
      submitted.record!,
      { id: "employee-1", roles: ["employee", "manager"] },
      now,
    );
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("GUARD_FAILED");
  });

  it("refuses an approval of a request that was never submitted", () => {
    const denied = runScenario(model, "Request", "approve", draft, manager, now);
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("reports a model that does not compile instead of pretending it ran", () => {
    const result = runScenario("{ not a model", "Request", "submit", draft, employee, now);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("STUDIO_SCENARIO_COMPILE");
  });
});
