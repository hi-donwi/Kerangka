import { describe } from "vitest";
import { MemoryScheduler, MemoryStore, StoreScheduler } from "../src/index.js";
import { createSchedulerTestKit } from "../src/test-kits/index.js";

describe("Scheduler Adapters Certification", () => {
  createSchedulerTestKit("MemoryScheduler", () => new MemoryScheduler());

  createSchedulerTestKit("StoreScheduler", () => {
    const memoryStore = new MemoryStore();
    return new StoreScheduler(memoryStore);
  });
});
