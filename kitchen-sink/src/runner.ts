import { checkRequest, LIMITS, type ExecutionReply, type ExecutionRequest } from "./execution";

export async function runInWorker(
  request: ExecutionRequest,
  createWorker: () => Worker,
  signal?: AbortSignal,
): Promise<ExecutionReply> {
  const reason = checkRequest(request);
  if (reason) return { kind: "fallback", reason };
  if (signal?.aborted) return { kind: "fallback", reason: "CANCELLED: Run cancelled." };
  const start = performance.now();
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    return { kind: "fallback", reason: "WORKER_UNAVAILABLE: Isolated execution is unavailable." };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reply: ExecutionReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      resolve(reply);
    };
    const cancel = () => finish({ kind: "fallback", reason: "CANCELLED: Run cancelled." });
    const timeout: ExecutionReply = { kind: "fallback", reason: "TIME_LIMIT: Worker exceeded 1000 ms and was terminated." };
    const timer = setTimeout(() => finish(timeout), Math.max(0, LIMITS.wallClockMs - (performance.now() - start)));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ExecutionReply>) => {
      finish(performance.now() - start >= LIMITS.wallClockMs ? timeout : event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ kind: "fallback", reason: "WORKER_FAILED: Isolated execution failed; inspect the source." });
    };
    worker.onmessageerror = () => finish({ kind: "fallback", reason: "WORKER_FAILED: Invalid worker reply." });
    try {
      worker.postMessage(request);
    } catch {
      finish({ kind: "fallback", reason: "WORKER_FAILED: Inputs could not be sent to the worker." });
    }
  });
}
