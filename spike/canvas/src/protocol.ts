/**
 * The measurement protocol, shared by both candidates.
 *
 * The numbers are only comparable if both candidates are measured the same way, so the
 * protocol lives here rather than in either implementation. The rule is "from the
 * initiating event to the frame after the change is committed", measured inside the
 * page. Measuring from outside would add the automation channel's own latency to every
 * sample and hide the difference that matters.
 */

export interface Sample {
  kind: string;
  duration: number;
}

export interface SampleSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export class Metrics {
  private open = 0;
  private kind = "";
  readonly samples: Sample[] = [];

  begin(kind: string): void {
    if (this.open) return;
    this.kind = kind;
    this.open = performance.now();
  }

  /**
   * Start a sample at a moment the candidate did not choose.
   *
   * A click is one interaction from the pointer going down to the selection being
   * painted, and different libraries report that at different points. Anchoring on the
   * event that actually began the interaction is what makes the two comparable.
   */
  beginAt(kind: string, timestamp: number): void {
    if (this.open) return;
    this.kind = kind;
    this.open = timestamp;
  }

  /** The open sample turned into a different kind of interaction. */
  rekind(kind: string): void {
    if (!this.open) return;
    this.kind = kind;
  }

  end(): void {
    if (!this.open) return;
    const duration = performance.now() - this.open;
    this.open = 0;
    this.samples.push({ kind: this.kind, duration });
  }

  reset(): void {
    this.samples.length = 0;
    this.open = 0;
  }

  summary(): Record<string, SampleSummary> {
    const byKind = new Map<string, number[]>();
    for (const sample of this.samples) {
      const list = byKind.get(sample.kind) ?? [];
      list.push(sample.duration);
      byKind.set(sample.kind, list);
    }
    const result: Record<string, SampleSummary> = {};
    for (const [kind, values] of byKind) {
      values.sort((a, b) => a - b);
      result[kind] = {
        count: values.length,
        p50: quantile(values, 0.5),
        p95: quantile(values, 0.95),
        max: values[values.length - 1] ?? 0,
      };
    }
    return result;
  }
}

export function quantile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Number(sorted[position]?.toFixed(3) ?? 0);
}

/**
 * The imperative surface the driver uses, whatever the candidate is built from.
 *
 * A candidate that cannot do something says so here rather than failing silently: an
 * absent capability is a decision input, not a crash.
 */
export interface SpikeDriver {
  implementation: string;
  /** Switch the mounted graph, so legality can be tested on both shapes. */
  useGraph(kind: "workflow" | "containment"): void;
  nodePosition(id: string): { x: number; y: number } | null;
  /** Try to connect two nodes; the candidate applies its own legality rules. */
  attemptConnect(from: string, to: string): { accepted: boolean; edges: number; reason?: string };
  focusNode(id: string): boolean;
  moveFocused(dx: number, dy: number): boolean;
  /** Start and finish an interaction sample. The driver owns the timing. */
  beginInteraction(kind: string): void;
  endInteraction(kind: string): Promise<void>;
  facts(): {
    nodes: number;
    edges: number;
    renderedNodes: number;
    renderedEdges: number;
    tabbableNodes: number;
    connectionHandles: number;
    mountMs: number;
  };
  metrics(): Record<string, SampleSummary>;
  resetMetrics(): void;
  ready(): boolean;
  /** Implementation detail that explains a surprising result, when there is one. */
  probe(): Record<string, unknown>;
}

declare global {
  interface Window {
    __spike?: SpikeDriver;
    /** The page's own timestamp for the most recent input event. */
    __lastInputAt?: number;
  }
}

export function publish(driver: SpikeDriver): void {
  window.__spike = driver;
}

/**
 * The one place an interaction is timed.
 *
 * Timing inside each candidate would compare two different event APIs: one library
 * reports a drag on press, the other reports it on release, and a click is a drag to
 * one of them. The driver therefore marks the start, performs the gesture, and marks
 * the end, and the interval is measured to the frame after the change is committed.
 *
 * The interval is measured from the page's own record of the last input event rather
 * than from the driver's wall clock. The driver and the browser talk over a channel
 * with a latency of its own, and a gesture made of several moves spends most of its
 * time in that channel. Measuring from the last event removes the channel from the
 * comparison, and the frame pacing sampled during the gesture covers the work in
 * between.
 */
export class InteractionTimer {
  private started = 0;
  readonly samples: Sample[] = [];

  begin(_kind: string): void {
    this.started = performance.now();
  }

  async end(kind: string): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const last = typeof window.__lastInputAt === "number" ? window.__lastInputAt : this.started;
    this.samples.push({ kind, duration: performance.now() - last });
  }

  reset(): void {
    this.samples.length = 0;
  }

  summary(): Record<string, SampleSummary> {
    const byKind = new Map<string, number[]>();
    for (const sample of this.samples) {
      const list = byKind.get(sample.kind) ?? [];
      list.push(sample.duration);
      byKind.set(sample.kind, list);
    }
    const result: Record<string, SampleSummary> = {};
    for (const [kind, values] of byKind) {
      values.sort((a, b) => a - b);
      result[kind] = {
        count: values.length,
        p50: quantile(values, 0.5),
        p95: quantile(values, 0.95),
        max: values[values.length - 1] ?? 0,
      };
    }
    return result;
  }
}
