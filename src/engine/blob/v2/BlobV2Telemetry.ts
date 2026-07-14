export interface BlobV2TimingSnapshot {
  readonly samples: number;
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

export interface BlobV2ResourceSnapshot {
  readonly surfaces: number;
  readonly pendingVisualJobs: number;
  readonly estimatedCpuBytes: number;
  readonly estimatedGpuBytes: number;
}

export interface BlobV2TelemetrySnapshot {
  readonly simulation: BlobV2TimingSnapshot;
  readonly meshing: BlobV2TimingSnapshot;
  readonly presentation: BlobV2TimingSnapshot;
  readonly visualJobWait: BlobV2TimingSnapshot;
  readonly resources: BlobV2ResourceSnapshot;
}

const DEFAULT_WINDOW = 1_800;

/** Bounded runtime telemetry; it owns no gameplay state and allocates only on snapshot. */
export class BlobV2Telemetry {
  private readonly simulation: TimingWindow;
  private readonly meshing: TimingWindow;
  private readonly presentation: TimingWindow;
  private readonly visualWait: TimingWindow;
  private surfaces = 0;
  private pendingVisualJobs = 0;
  private estimatedCpuBytes = 0;
  private estimatedGpuBytes = 0;

  constructor(windowSize = DEFAULT_WINDOW) {
    this.simulation = new TimingWindow(windowSize);
    this.meshing = new TimingWindow(windowSize);
    this.presentation = new TimingWindow(windowSize);
    this.visualWait = new TimingWindow(windowSize);
  }

  recordSimulation(durationMs: number): void {
    this.simulation.push(durationMs);
  }

  recordMeshing(durationMs: number, waitMs = 0): void {
    this.meshing.push(durationMs);
    this.visualWait.push(waitMs);
  }

  recordPresentation(durationMs: number): void {
    this.presentation.push(durationMs);
  }

  setVisualResources(
    surfaces: number,
    pendingVisualJobs: number,
    estimatedCpuBytes = 0,
    estimatedGpuBytes = 0,
  ): void {
    this.surfaces = count(surfaces, "surfaces");
    this.pendingVisualJobs = count(pendingVisualJobs, "pendingVisualJobs");
    this.estimatedCpuBytes = count(estimatedCpuBytes, "estimatedCpuBytes");
    this.estimatedGpuBytes = count(estimatedGpuBytes, "estimatedGpuBytes");
  }

  snapshot(): BlobV2TelemetrySnapshot {
    return Object.freeze({
      simulation: this.simulation.snapshot(),
      meshing: this.meshing.snapshot(),
      presentation: this.presentation.snapshot(),
      visualJobWait: this.visualWait.snapshot(),
      resources: Object.freeze({
        surfaces: this.surfaces,
        pendingVisualJobs: this.pendingVisualJobs,
        estimatedCpuBytes: this.estimatedCpuBytes,
        estimatedGpuBytes: this.estimatedGpuBytes,
      }),
    });
  }

  reset(): void {
    this.simulation.reset();
    this.meshing.reset();
    this.presentation.reset();
    this.visualWait.reset();
    this.setVisualResources(0, 0, 0, 0);
  }
}

class TimingWindow {
  private readonly values: Float64Array;
  private cursor = 0;
  private size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Blob telemetry window size must be a positive integer");
    }
    this.values = new Float64Array(capacity);
  }

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Blob telemetry timings must be finite and non-negative");
    }
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.size = Math.min(this.values.length, this.size + 1);
  }

  snapshot(): BlobV2TimingSnapshot {
    if (this.size === 0) return EMPTY_TIMING;
    const ordered = Array.from(this.values.subarray(0, this.size)).sort((a, b) => a - b);
    const total = ordered.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1);
    return Object.freeze({
      samples: ordered.length,
      averageMs: total / ordered.length,
      p95Ms: ordered[p95Index] ?? 0,
      maximumMs: ordered.at(-1) ?? 0,
    });
  }

  reset(): void {
    this.values.fill(0);
    this.cursor = 0;
    this.size = 0;
  }
}

const EMPTY_TIMING: BlobV2TimingSnapshot = Object.freeze({
  samples: 0,
  averageMs: 0,
  p95Ms: 0,
  maximumMs: 0,
});

function count(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Blob telemetry ${label} must be finite and non-negative`);
  }
  return value;
}
