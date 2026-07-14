export interface BlobV2SurfaceCadenceOptions {
  nearDistance?: number;
  mediumDistance?: number;
  nearHz?: number;
  mediumHz?: number;
  farHz?: number;
}

/** Fixed geometry quality; only the rebuild frequency changes with distance. */
export class BlobV2SurfaceCadence {
  private readonly nearDistance: number;
  private readonly mediumDistance: number;
  private readonly nearHz: number;
  private readonly mediumHz: number;
  private readonly farHz: number;

  constructor(options: BlobV2SurfaceCadenceOptions = {}) {
    this.nearDistance = nonNegative(
      options.nearDistance ?? 18,
      "nearDistance",
    );
    this.mediumDistance = nonNegative(
      options.mediumDistance ?? 45,
      "mediumDistance",
    );
    this.nearHz = positive(options.nearHz ?? 30, "nearHz");
    this.mediumHz = positive(options.mediumHz ?? 12, "mediumHz");
    this.farHz = positive(options.farHz ?? 4, "farHz");
    if (this.nearDistance > this.mediumDistance) {
      throw new Error(
        "BlobV2SurfaceCadence: nearDistance must be <= mediumDistance",
      );
    }
  }

  frequency(viewerDistance: number): number {
    nonNegative(viewerDistance, "viewerDistance");
    if (viewerDistance <= this.nearDistance) return this.nearHz;
    if (viewerDistance <= this.mediumDistance) return this.mediumHz;
    return this.farHz;
  }

  isDue(now: number, lastCompletedAt: number, viewerDistance: number): boolean {
    if (!Number.isFinite(now)) {
      throw new Error("BlobV2SurfaceCadence: now must be finite");
    }
    return now - lastCompletedAt >= 1 / this.frequency(viewerDistance);
  }
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BlobV2SurfaceCadence: ${name} must be finite and > 0`);
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobV2SurfaceCadence: ${name} must be finite and >= 0`);
  }
  return value;
}
