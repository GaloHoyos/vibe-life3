import { Vector3 } from "three";

export interface BlobSurfaceDomainOptions {
  /** Discrete domain-size step, in world metres. */
  sizeQuantum?: number;
  /** Extra room required before a domain is allowed to shrink. */
  shrinkHysteresis?: number;
  /** Schmitt-trigger width around a sampling-cell boundary. */
  centerHysteresisCells?: number;
}

const DEFAULT_SIZE_QUANTUM = 0.25;
const DEFAULT_SHRINK_HYSTERESIS = 0.125;
const DEFAULT_CENTER_HYSTERESIS_CELLS = 0.15;
const EPSILON = 1e-9;

/**
 * Smallest cubic domain that leaves `guardCells` empty sampling cells between
 * the field support and every face. MarchingCubes skips its outer layers and
 * samples neighboring cells for normals, so callers should use at least 2;
 * dynamic Blob surfaces use 3 to absorb center-grid snapping as well.
 */
export function blobDomainSizeWithCellGuard(
  fieldSupportRadius: number,
  resolution: number,
  guardCells: number,
): number {
  positiveOrThrow(fieldSupportRadius, "fieldSupportRadius");
  positiveOrThrow(resolution, "resolution");
  nonNegativeOrThrow(guardCells, "guardCells");
  const availableFraction = 0.5 - guardCells / resolution;
  if (availableFraction <= 0) {
    throw new Error("BlobSurfaceDomain: guardCells must be less than half the resolution");
  }
  return fieldSupportRadius / availableFraction;
}

/**
 * Keeps the marching-cubes lattice stable while particles breathe and move.
 * Domain growth is immediate (so geometry cannot be clipped), while shrinking
 * and center movement use hysteresis to avoid alternating between two grids.
 */
export class BlobSurfaceDomain {
  readonly center = new Vector3();

  private readonly sizeQuantum: number;
  private readonly shrinkHysteresis: number;
  private readonly centerHysteresisCells: number;
  private currentSize = 0;
  private centerInitialized = false;

  constructor(options: BlobSurfaceDomainOptions = {}) {
    this.sizeQuantum = positiveOrThrow(
      options.sizeQuantum ?? DEFAULT_SIZE_QUANTUM,
      "sizeQuantum",
    );
    this.shrinkHysteresis = nonNegativeOrThrow(
      options.shrinkHysteresis ?? DEFAULT_SHRINK_HYSTERESIS,
      "shrinkHysteresis",
    );
    this.centerHysteresisCells = nonNegativeOrThrow(
      options.centerHysteresisCells ?? DEFAULT_CENTER_HYSTERESIS_CELLS,
      "centerHysteresisCells",
    );
  }

  get size(): number {
    return this.currentSize;
  }

  /** Returns a conservative, quantized domain size. */
  stabilizeSize(requestedSize: number): number {
    positiveOrThrow(requestedSize, "requestedSize");
    const target = quantizeUp(requestedSize, this.sizeQuantum);

    if (this.currentSize === 0 || target > this.currentSize) {
      this.currentSize = target;
      return this.currentSize;
    }

    // Re-entering a smaller bucket is deliberately harder than leaving it.
    // Adding the hysteresis back before quantizing guarantees the new domain
    // still contains the requested extent.
    if (
      target < this.currentSize &&
      requestedSize <=
        this.currentSize - this.sizeQuantum - this.shrinkHysteresis + EPSILON
    ) {
      this.currentSize = Math.min(
        this.currentSize,
        quantizeUp(requestedSize + this.shrinkHysteresis, this.sizeQuantum),
      );
    }
    return this.currentSize;
  }

  /**
   * Stabilizes the world-space lattice origin. The returned vector is owned by
   * this object and remains valid until the next call.
   */
  stabilizeCenter(centerWorld: Vector3, resolution: number): Vector3 {
    if (this.currentSize <= 0) {
      throw new Error("BlobSurfaceDomain: stabilizeSize() must run first");
    }
    positiveOrThrow(resolution, "resolution");
    const cell = this.currentSize / resolution;

    if (!this.centerInitialized) {
      this.center.set(
        Math.round(centerWorld.x / cell) * cell,
        Math.round(centerWorld.y / cell) * cell,
        Math.round(centerWorld.z / cell) * cell,
      );
      this.centerInitialized = true;
      return this.center;
    }

    this.center.x = stabilizeAxis(
      this.center.x,
      centerWorld.x,
      cell,
      this.centerHysteresisCells,
    );
    this.center.y = stabilizeAxis(
      this.center.y,
      centerWorld.y,
      cell,
      this.centerHysteresisCells,
    );
    this.center.z = stabilizeAxis(
      this.center.z,
      centerWorld.z,
      cell,
      this.centerHysteresisCells,
    );
    return this.center;
  }

  reset(): void {
    this.currentSize = 0;
    this.centerInitialized = false;
    this.center.set(0, 0, 0);
  }
}

function stabilizeAxis(
  current: number,
  requested: number,
  cell: number,
  hysteresisCells: number,
): number {
  const delta = requested - current;
  const threshold = cell * (0.5 + hysteresisCells);
  if (Math.abs(delta) <= threshold) {
    return current;
  }
  const steps = Math.floor((Math.abs(delta) - threshold) / cell) + 1;
  return current + Math.sign(delta) * steps * cell;
}

function quantizeUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum - EPSILON) * quantum;
}

function positiveOrThrow(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BlobSurfaceDomain: ${name} must be finite and > 0`);
  }
  return value;
}

function nonNegativeOrThrow(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobSurfaceDomain: ${name} must be finite and >= 0`);
  }
  return value;
}
