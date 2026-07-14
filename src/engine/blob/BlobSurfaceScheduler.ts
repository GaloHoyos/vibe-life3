import type { Disposable } from "@shared/types/lifecycle";
import type { BlobSurfaceResolution } from "./BlobSurfaceLod";

export type BlobSurfaceRequestId = string | number | symbol | object;

export interface BlobSurfaceRebuildRequest {
  id: BlobSurfaceRequestId;
  resolution: BlobSurfaceResolution | number;
  /** Smaller values run first; waiting requests gain priority every frame. */
  priority?: number;
  rebuild: () => void;
  onComplete?: (durationMs: number) => void;
}

export interface BlobSurfaceSchedulerOptions {
  budgetMs?: number;
  maxHighQualityPerFrame?: number;
  highQualityResolution?: number;
  slowRebuildMs?: number;
  fairnessBoostPerFrame?: number;
  /** Headroom applied to the rolling per-resolution duration estimate. */
  predictionSafetyFactor?: number;
  now?: () => number;
  onSlowRebuild?: (request: BlobSurfaceRebuildRequest, durationMs: number) => void;
}

export interface BlobSurfaceSchedulerStats {
  rebuilt: number;
  highQualityRebuilt: number;
  deferred: number;
  elapsedMs: number;
  slowRebuilds: number;
  overBudget: boolean;
}

const DEFAULT_BUDGET_MS = 2.5;

interface PendingRequest {
  request: BlobSurfaceRebuildRequest;
  sequence: number;
  ageFrames: number;
}

/**
 * Global cooperative budget for marching-cubes rebuilds. Polygonization is
 * synchronous, so a single job cannot be pre-empted; overruns are measured and
 * exposed while subsequent jobs remain queued for a later frame.
 */
export class BlobSurfaceScheduler implements Disposable {
  private readonly budgetMs: number;
  private readonly maxHighQualityPerFrame: number;
  private readonly highQualityResolution: number;
  private readonly slowRebuildMs: number;
  private readonly fairnessBoostPerFrame: number;
  private readonly predictionSafetyFactor: number;
  private readonly now: () => number;
  private readonly onSlowRebuild?: BlobSurfaceSchedulerOptions["onSlowRebuild"];
  private readonly pending = new Map<BlobSurfaceRequestId, PendingRequest>();
  private readonly durationEstimateByResolution = new Map<number, number>();
  private nextSequence = 0;
  private disposed = false;

  constructor(options: BlobSurfaceSchedulerOptions = {}) {
    // Reserve headroom for renderer/scheduler overhead and modest CPU
    // contention so the complete meshing slice stays below the 3.5 ms limit.
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    this.maxHighQualityPerFrame = options.maxHighQualityPerFrame ?? 1;
    this.highQualityResolution = options.highQualityResolution ?? 40;
    this.slowRebuildMs = options.slowRebuildMs ?? 8;
    this.fairnessBoostPerFrame = options.fairnessBoostPerFrame ?? 1;
    this.predictionSafetyFactor = options.predictionSafetyFactor ?? 1.2;
    this.now = options.now ?? (() => performance.now());
    this.onSlowRebuild = options.onSlowRebuild;
    validateNonNegative(this.budgetMs, "budgetMs");
    validateNonNegative(
      this.maxHighQualityPerFrame,
      "maxHighQualityPerFrame",
    );
    validateNonNegative(this.slowRebuildMs, "slowRebuildMs");
    validateNonNegative(this.fairnessBoostPerFrame, "fairnessBoostPerFrame");
    validateNonNegative(this.predictionSafetyFactor, "predictionSafetyFactor");
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Replaces an older pending request for the same surface. */
  request(request: BlobSurfaceRebuildRequest): void {
    if (this.disposed) return;
    const existing = this.pending.get(request.id);
    this.pending.set(request.id, {
      request,
      sequence: existing?.sequence ?? this.nextSequence++,
      ageFrames: existing?.ageFrames ?? 0,
    });
  }

  cancel(id: BlobSurfaceRequestId): void {
    this.pending.delete(id);
  }

  /** Processes one render frame and leaves excess work queued fairly. */
  runFrame(): BlobSurfaceSchedulerStats {
    if (this.disposed) {
      return emptyStats();
    }

    for (const entry of this.pending.values()) {
      entry.ageFrames += 1;
    }

    const frameStart = this.now();
    let rebuilt = 0;
    let highQualityRebuilt = 0;
    let slowRebuilds = 0;

    while (this.pending.size > 0) {
      const elapsedBeforeJob = Math.max(0, this.now() - frameStart);
      if (rebuilt > 0 && elapsedBeforeJob >= this.budgetMs) {
        break;
      }

      const next = this.selectNext(
        highQualityRebuilt,
        Math.max(0, this.budgetMs - elapsedBeforeJob),
        rebuilt > 0,
      );
      if (!next) break;
      this.pending.delete(next.request.id);

      const started = this.now();
      next.request.rebuild();
      const duration = Math.max(0, this.now() - started);
      this.recordDurationEstimate(next.request.resolution, duration);
      rebuilt += 1;
      if (this.isHighQuality(next.request)) {
        highQualityRebuilt += 1;
      }
      if (duration > this.slowRebuildMs) {
        slowRebuilds += 1;
        this.onSlowRebuild?.(next.request, duration);
      }
      next.request.onComplete?.(duration);
    }

    const elapsedMs = Math.max(0, this.now() - frameStart);
    return {
      rebuilt,
      highQualityRebuilt,
      deferred: this.pending.size,
      elapsedMs,
      slowRebuilds,
      overBudget: elapsedMs > this.budgetMs,
    };
  }

  clear(): void {
    this.pending.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  private selectNext(
    highQualityRebuilt: number,
    remainingBudgetMs: number,
    requireBudgetFit: boolean,
  ): PendingRequest | null {
    let best: PendingRequest | null = null;
    let bestPriority = Infinity;
    for (const entry of this.pending.values()) {
      if (
        this.isHighQuality(entry.request) &&
        highQualityRebuilt >= this.maxHighQualityPerFrame
      ) {
        continue;
      }
      const estimate = this.durationEstimateByResolution.get(
        entry.request.resolution,
      );
      if (
        requireBudgetFit &&
        estimate !== undefined &&
        estimate * this.predictionSafetyFactor > remainingBudgetMs
      ) {
        continue;
      }
      const effectivePriority =
        (entry.request.priority ?? 0) -
        entry.ageFrames * this.fairnessBoostPerFrame;
      if (
        effectivePriority < bestPriority ||
        (effectivePriority === bestPriority &&
          (best === null || entry.sequence < best.sequence))
      ) {
        best = entry;
        bestPriority = effectivePriority;
      }
    }
    return best;
  }

  private isHighQuality(request: BlobSurfaceRebuildRequest): boolean {
    return request.resolution >= this.highQualityResolution;
  }

  private recordDurationEstimate(resolution: number, durationMs: number): void {
    // A cold JIT/GC outlier must still make the next frame conservative, but
    // should converge quickly once the steady-state cost is observed.
    const sample = Math.min(durationMs, this.slowRebuildMs);
    const previous = this.durationEstimateByResolution.get(resolution);
    this.durationEstimateByResolution.set(
      resolution,
      previous === undefined ? sample : previous * 0.5 + sample * 0.5,
    );
  }
}

/** Default process-wide scheduler: 2.5 ms and at most one resolution-40 job. */
export const blobSurfaceScheduler = new BlobSurfaceScheduler();

function emptyStats(): BlobSurfaceSchedulerStats {
  return {
    rebuilt: 0,
    highQualityRebuilt: 0,
    deferred: 0,
    elapsedMs: 0,
    slowRebuilds: 0,
    overBudget: false,
  };
}

function validateNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobSurfaceScheduler: ${name} must be finite and >= 0`);
  }
}
