import { Box3, Vector3 } from "three";

export interface BlobV2StableDomainOptions {
  quantum?: number;
  shrinkHysteresis?: number;
  minimumAxisSize?: number;
}

const EPSILON = 1e-9;

/**
 * A world-grid-aligned AABB with independent axes. Growth is immediate;
 * shrinking needs explicit slack so breathing cells do not crawl the lattice.
 */
export class BlobV2StableDomain {
  readonly bounds = new Box3();
  readonly center = new Vector3();
  readonly size = new Vector3();

  private readonly requestedMinimum = new Vector3();
  private readonly requestedMaximum = new Vector3();
  private readonly quantum: number;
  private readonly shrinkHysteresis: number;
  private readonly minimumAxisSize: number;
  private initialized = false;

  constructor(options: BlobV2StableDomainOptions = {}) {
    this.quantum = positive(options.quantum ?? 0.25, "quantum");
    this.shrinkHysteresis = nonNegative(
      options.shrinkHysteresis ?? 0.25,
      "shrinkHysteresis",
    );
    this.minimumAxisSize = positive(
      options.minimumAxisSize ?? 0.75,
      "minimumAxisSize",
    );
  }

  stabilize(requested: Box3): Box3 {
    if (requested.isEmpty()) {
      throw new Error("BlobV2StableDomain: requested bounds cannot be empty");
    }
    const minimum = this.requestedMinimum.set(
      quantizeDown(requested.min.x, this.quantum),
      quantizeDown(requested.min.y, this.quantum),
      quantizeDown(requested.min.z, this.quantum),
    );
    const maximum = this.requestedMaximum.set(
      quantizeUp(requested.max.x, this.quantum),
      quantizeUp(requested.max.y, this.quantum),
      quantizeUp(requested.max.z, this.quantum),
    );
    ensureMinimumAxis(minimum, maximum, this.minimumAxisSize, this.quantum);

    if (!this.initialized) {
      this.bounds.set(minimum, maximum);
      this.initialized = true;
    } else {
      stabilizeMinimumAxis(
        this.bounds.min,
        minimum,
        this.shrinkHysteresis,
      );
      stabilizeMaximumAxis(
        this.bounds.max,
        maximum,
        this.shrinkHysteresis,
      );
    }

    this.bounds.getCenter(this.center);
    this.bounds.getSize(this.size);
    return this.bounds;
  }

  reset(): void {
    this.bounds.makeEmpty();
    this.center.set(0, 0, 0);
    this.size.set(0, 0, 0);
    this.initialized = false;
  }
}

function stabilizeMinimumAxis(
  current: Vector3,
  requested: Vector3,
  hysteresis: number,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    if (requested[axis] < current[axis]) {
      current[axis] = requested[axis];
    } else if (requested[axis] - current[axis] >= hysteresis - EPSILON) {
      current[axis] = requested[axis];
    }
  }
}

function stabilizeMaximumAxis(
  current: Vector3,
  requested: Vector3,
  hysteresis: number,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    if (requested[axis] > current[axis]) {
      current[axis] = requested[axis];
    } else if (current[axis] - requested[axis] >= hysteresis - EPSILON) {
      current[axis] = requested[axis];
    }
  }
}

function ensureMinimumAxis(
  minimum: Vector3,
  maximum: Vector3,
  minimumSize: number,
  quantum: number,
): void {
  for (const axis of ["x", "y", "z"] as const) {
    const missing = minimumSize - (maximum[axis] - minimum[axis]);
    if (missing <= EPSILON) continue;
    const half = Math.ceil(missing / (2 * quantum) - EPSILON) * quantum;
    minimum[axis] -= half;
    maximum[axis] += half;
  }
}

function quantizeDown(value: number, quantum: number): number {
  return Math.floor(value / quantum + EPSILON) * quantum;
}

function quantizeUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum - EPSILON) * quantum;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BlobV2StableDomain: ${name} must be finite and > 0`);
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobV2StableDomain: ${name} must be finite and >= 0`);
  }
  return value;
}
