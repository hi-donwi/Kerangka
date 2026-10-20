import { readFileSync } from "node:fs";
import { compile } from "@kerangka/compiler";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../samples/manifest.json";
import { executeSample, LIMITS, type ExecutionRequest } from "../kitchen-sink/src/execution";
import { runInWorker } from "../kitchen-sink/src/runner";
import type { ManifestEntry } from "../kitchen-sink/src/types";

const entries = manifest as ManifestEntry[];
const compiled = new Map(entries.map((entry) => [
  entry.id, compile(readFileSync(new URL(`../${entry.modelPath}`, import.meta.url), "utf8")),
]));
const request = (): ExecutionRequest => ({
  kir: structuredClone(compiled.get("approval")),
  sample: structuredClone(entries[0]),
  inputName: "submit-draft",
});

afterEach(() => vi.useRealTimers());

describe("bounded kitchen-sink execution", () => {
  for (const sample of entries) {
    for (const input of sample.inputs) {
      it(`executes ${sample.id}/${input.name} against the manifest expectation`, () => {
        expect(input.run).toMatch(/^[A-Za-z][\w]*\.[A-Za-z][\w]*$/);
        const before = JSON.stringify(sample);
        const result = executeSample({ kir: compiled.get(sample.id), sample, inputName: input.name });
        expect(result).toMatchObject({ kind: "result", matched: true, truncated: false });
        expect(JSON.stringify(sample)).toBe(before);
      });
    }
  }

  it("returns the real record and detects an expected-record mismatch", () => {
    const req = request();
    req.sample.expected.outcomes[0].record = { status: "rejected" };
    const result = executeSample(req);
    expect(result).toMatchObject({ kind: "result", status: "ok", matched: false });
    if (result.kind === "result") {
      expect(JSON.parse(result.output).record.status).toBe("submitted");
    }
  });

  it("does not treat an unknown operation as an expected denial", () => {
    const req = request();
    req.sample.inputs[0].run = "Expense.missing";
    req.sample.expected.outcomes[0].status = "denied";
    expect(executeSample(req)).toMatchObject({ kind: "fallback", reason: expect.stringContaining("UNKNOWN_OPERATION") });
  });

  it("checks the specific expected denial code", () => {
    const req = request();
    req.inputName = "approve-as-employee";
    req.sample.expected.outcomes[2].error = "GUARD_FAILED";
    expect(executeSample(req)).toMatchObject({ kind: "result", status: "denied", matched: false });
  });

  it("refuses preview-only samples and missing compiled models", () => {
    const req = request();
    req.sample.allowedModes = ["preview"];
    expect(executeSample(req)).toMatchObject({ kind: "fallback", reason: expect.stringContaining("RUN_NOT_ALLOWED") });
    expect(executeSample({ ...request(), kir: undefined })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("MODEL_UNAVAILABLE"),
    });
  });

  it("rejects oversize UTF-8 input before creating a worker", async () => {
    const req = request();
    req.sample.inputs[0].record.description = "\u00e9".repeat(LIMITS.inputBytes);
    const createWorker = vi.fn();
    expect(await runInWorker(req, createWorker)).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("INPUT_LIMIT"),
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("refuses oversize models, too many entities, nodes, and excessive nesting", () => {
    expect(executeSample({ ...request(), kir: { text: "x".repeat(LIMITS.modelBytes) } })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("MODEL_LIMIT"),
    });
    const entities = Object.fromEntries(Array.from({ length: LIMITS.entities + 1 }, (_, i) => [`E${i}`, {}]));
    expect(executeSample({ ...request(), kir: { entities } })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("ENTITY_LIMIT"),
    });
    const actions = Object.fromEntries(Array.from({ length: LIMITS.operations + 1 }, (_, i) => [`a${i}`, {}]));
    expect(executeSample({ ...request(), kir: { entities: { Expense: { actions } } } })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("OPERATION_LIMIT"),
    });
    expect(executeSample({ ...request(), kir: Array(LIMITS.nodes + 1).fill(0) })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("WORK_LIMIT"),
    });
    let deep: unknown = 0;
    for (let i = 0; i <= LIMITS.depth; i++) deep = { child: deep };
    expect(executeSample({ ...request(), kir: deep })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("DEPTH_LIMIT"),
    });
  });

  it("rejects undeclared inputs and missing expectations", () => {
    expect(executeSample({ ...request(), inputName: "missing" })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("INVALID_TARGET"),
    });
    const req = request();
    req.sample.expected.outcomes = [];
    expect(executeSample(req)).toMatchObject({ kind: "fallback", reason: expect.stringContaining("EXPECTATION_MISSING") });
  });

  it("truncates output without hiding the expectation comparison", () => {
    const req = request();
    req.sample.inputs[0].record.description = "x".repeat(LIMITS.outputBytes);
    const result = executeSample(req);
    expect(result).toMatchObject({ kind: "result", matched: true, truncated: true });
    if (result.kind === "result") expect(new TextEncoder().encode(result.output).length).toBeLessThanOrEqual(LIMITS.outputBytes);
  });
});

describe("worker lifetime", () => {
  const worker = () => ({
    postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null,
  } as unknown as Worker);

  it("terminates an unresponsive worker at the deadline", async () => {
    vi.useFakeTimers();
    const instance = worker();
    const result = runInWorker(request(), () => instance);
    await vi.advanceTimersByTimeAsync(LIMITS.wallClockMs);
    expect(await result).toMatchObject({ kind: "fallback", reason: expect.stringContaining("TIME_LIMIT") });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("terminates on completion and clears the deadline", async () => {
    vi.useFakeTimers();
    const instance = worker();
    const reply = executeSample(request());
    const result = runInWorker(request(), () => instance);
    instance.onmessage?.call(instance, { data: reply } as MessageEvent);
    expect(await result).toEqual(reply);
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes worker construction in the deadline", async () => {
    vi.useFakeTimers();
    const instance = worker();
    const result = runInWorker(request(), () => {
      vi.advanceTimersByTime(600);
      return instance;
    });
    await vi.advanceTimersByTimeAsync(LIMITS.wallClockMs - 600);
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(await result).toMatchObject({ kind: "fallback", reason: expect.stringContaining("TIME_LIMIT") });
  });

  it("cancels and cleans up when reset or navigation aborts the run", async () => {
    const controller = new AbortController();
    const instance = worker();
    const result = runInWorker(request(), () => instance, controller.signal);
    controller.abort();
    expect(await result).toMatchObject({ kind: "fallback", reason: expect.stringContaining("CANCELLED") });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("shows a fallback when workers are unavailable or fail", async () => {
    expect(await runInWorker(request(), () => { throw new Error("unavailable"); })).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("WORKER_UNAVAILABLE"),
    });
    const instance = worker();
    const result = runInWorker(request(), () => instance);
    instance.onerror?.call(instance, { preventDefault: vi.fn() } as unknown as ErrorEvent);
    expect(await result).toMatchObject({ kind: "fallback", reason: expect.stringContaining("WORKER_FAILED") });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("does not start work for an already cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn();
    expect(await runInWorker(request(), createWorker, controller.signal)).toMatchObject({
      kind: "fallback", reason: expect.stringContaining("CANCELLED"),
    });
    expect(createWorker).not.toHaveBeenCalled();
  });
});
