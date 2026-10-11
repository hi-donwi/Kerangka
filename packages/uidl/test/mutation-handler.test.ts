import { describe, expect, it, vi } from "vitest";
import { DataError, isDataError } from "../src/errors.js";
import { createKerangkaMutationHandler } from "../src/mutation-handler.js";
import type { DataAdapter } from "../src/types.js";

function mockAdapter(): DataAdapter {
  return {
    query: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue({ record: { id: "INV-1" }, meta: { version: 1 } }),
    update: vi.fn().mockResolvedValue({ record: { id: "INV-1", status: "sent" }, meta: { version: 2 } }),
    remove: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue({ record: { id: "INV-1", status: "paid" }, meta: { version: 3 } }),
    report: vi.fn(),
  } as unknown as DataAdapter;
}

describe("createKerangkaMutationHandler", () => {
  it("creates through the adapter", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    const result = await handler({ operation: "create", collection: "Invoice", payload: { number: "1" } });
    expect(adapter.create).toHaveBeenCalledWith({ collection: "Invoice", data: { number: "1" } });
    expect(result).toEqual({ record: { id: "INV-1" }, meta: { version: 1 } });
  });

  it("updates with the id and version the document supplied", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    await handler({ operation: "update", collection: "Invoice", id: "INV-1", payload: { status: "sent" }, version: 4 });
    expect(adapter.update).toHaveBeenCalledWith({
      collection: "Invoice",
      id: "INV-1",
      data: { status: "sent" },
      version: 4,
    });
  });

  it("deletes and returns the id", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    const result = await handler({ operation: "delete", collection: "Invoice", id: "INV-1" });
    expect(adapter.remove).toHaveBeenCalledWith("Invoice", "INV-1");
    expect(result).toEqual({ id: "INV-1" });
  });

  it("runs a transition by name", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    await handler({ operation: "transition", collection: "Invoice", id: "INV-1", transition: "pay" });
    expect(adapter.transition).toHaveBeenCalledWith({
      collection: "Invoice",
      id: "INV-1",
      transition: "pay",
      data: undefined,
      version: undefined,
    });
  });

  it("rejects update/delete/transition without an id", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    for (const operation of ["update", "delete", "transition"] as const) {
      const error = await Promise.resolve(handler({ operation, collection: "Invoice", transition: "pay" })).catch(
        (e: unknown) => e,
      );
      expect(isDataError(error)).toBe(true);
      expect((error as DataError).code).toBe("validation");
    }
  });

  it("rejects a transition without a transition name", async () => {
    const adapter = mockAdapter();
    const handler = createKerangkaMutationHandler({ adapter });
    const error = await Promise.resolve(handler({ operation: "transition", collection: "Invoice", id: "INV-1" })).catch(
      (e: unknown) => e,
    );
    expect(isDataError(error)).toBe(true);
    expect((error as DataError).code).toBe("validation");
  });
});
