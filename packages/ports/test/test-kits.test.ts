import { describe } from "vitest";
import {
  createBusTestKit,
  createStoreTestKit,
  MemoryBus,
  MemoryStore,
} from "../src/index.js";

describe("In-Memory Adapters Certification via Test Kits", () => {
  createStoreTestKit("MemoryStore", () => new MemoryStore());
  createBusTestKit("MemoryBus", () => new MemoryBus());
});
