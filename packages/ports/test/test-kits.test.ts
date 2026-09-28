import { describe } from "vitest";
import { MemoryBus, MemoryStore } from "../src/index.js";
import { createBusTestKit, createStoreTestKit } from "../src/test-kits/index.js";

describe("In-Memory Adapters Certification via Test Kits", () => {
  createStoreTestKit("MemoryStore", () => new MemoryStore());
  createBusTestKit("MemoryBus", () => new MemoryBus());
});
