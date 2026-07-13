export type BlobSurfaceResolution = 40 | 32 | 24;
export type BlobSurfaceLodBand = "near" | "medium" | "far" | "dormant";

export interface BlobSurfaceLodInput {
  /** Distance from the nearest relevant view in metres. */
  distance: number;
  /** Whether the surface intersects the main camera view. */
  mainViewVisible: boolean;
  /** Portal-camera visibility keeps an otherwise hidden blob awake. */
  portalViewVisible?: boolean;
  /** Monotonic time in seconds. */
  now: number;
  /** Damage, scripting and teleports bypass wake/LOD hysteresis. */
  forceWake?: boolean;
}

export interface BlobSurfaceLodDecision {
  band: BlobSurfaceLodBand;
  resolution: BlobSurfaceResolution | null;
  updateHz: number;
  rebuildDue: boolean;
  /** Dormant blobs retain simulation state but do not repolygonize. */
  dormant: boolean;
  visibleInAnyView: boolean;
}

export interface BlobSurfaceLodOptions {
  distanceHysteresis?: number;
  lodHysteresisSeconds?: number;
  hiddenSleepSeconds?: number;
  nearDistance?: number;
  mediumDistance?: number;
  farDistance?: number;
  nearResolution?: BlobSurfaceResolution;
  mediumResolution?: BlobSurfaceResolution;
  farResolution?: BlobSurfaceResolution;
  nearUpdateHz?: number;
  mediumUpdateHz?: number;
  farUpdateHz?: number;
}

const DEFAULT_LOD: Record<Exclude<BlobSurfaceLodBand, "dormant">, {
  resolution: BlobSurfaceResolution;
  updateHz: number;
}> = {
  near: { resolution: 40, updateHz: 30 },
  medium: { resolution: 32, updateHz: 15 },
  far: { resolution: 24, updateHz: 5 },
};

/** Stateful 40/32/24 LOD policy shared by main and portal camera passes. */
export class BlobSurfaceLodController {
  private readonly distanceHysteresis: number;
  private readonly lodHysteresisSeconds: number;
  private readonly hiddenSleepSeconds: number;
  private readonly nearDistance: number;
  private readonly mediumDistance: number;
  private readonly farDistance: number;
  private readonly settings: Record<Exclude<BlobSurfaceLodBand, "dormant">, {
    resolution: BlobSurfaceResolution;
    updateHz: number;
  }>;
  private band: BlobSurfaceLodBand | null = null;
  private candidateBand: BlobSurfaceLodBand | null = null;
  private candidateSince = 0;
  private hiddenSince: number | null = null;
  private lastRebuildAt = -Infinity;

  constructor(options: BlobSurfaceLodOptions = {}) {
    this.distanceHysteresis = options.distanceHysteresis ?? 3;
    this.lodHysteresisSeconds = options.lodHysteresisSeconds ?? 0.5;
    this.hiddenSleepSeconds = options.hiddenSleepSeconds ?? 0.75;
    this.nearDistance = options.nearDistance ?? 18;
    this.mediumDistance = options.mediumDistance ?? 45;
    this.farDistance = options.farDistance ?? 90;
    this.settings = {
      near: {
        resolution: options.nearResolution ?? DEFAULT_LOD.near.resolution,
        updateHz: options.nearUpdateHz ?? DEFAULT_LOD.near.updateHz,
      },
      medium: {
        resolution: options.mediumResolution ?? DEFAULT_LOD.medium.resolution,
        updateHz: options.mediumUpdateHz ?? DEFAULT_LOD.medium.updateHz,
      },
      far: {
        resolution: options.farResolution ?? DEFAULT_LOD.far.resolution,
        updateHz: options.farUpdateHz ?? DEFAULT_LOD.far.updateHz,
      },
    };
    validateNonNegative(this.distanceHysteresis, "distanceHysteresis");
    validateNonNegative(this.lodHysteresisSeconds, "lodHysteresisSeconds");
    validateNonNegative(this.hiddenSleepSeconds, "hiddenSleepSeconds");
    validateNonNegative(this.nearDistance, "nearDistance");
    validateNonNegative(this.mediumDistance, "mediumDistance");
    validateNonNegative(this.farDistance, "farDistance");
    validatePositive(this.settings.near.updateHz, "nearUpdateHz");
    validatePositive(this.settings.medium.updateHz, "mediumUpdateHz");
    validatePositive(this.settings.far.updateHz, "farUpdateHz");
    if (
      this.nearDistance > this.mediumDistance ||
      this.mediumDistance > this.farDistance
    ) {
      throw new Error("BlobSurfaceLodController: distances must be ordered near <= medium <= far");
    }
  }

  update(input: BlobSurfaceLodInput): BlobSurfaceLodDecision {
    validateNonNegative(input.distance, "distance");
    if (!Number.isFinite(input.now)) {
      throw new Error("BlobSurfaceLodController: now must be finite");
    }

    const visibleInAnyView =
      input.mainViewVisible || input.portalViewVisible === true;
    const wakeRequested = input.forceWake === true || input.portalViewVisible === true;
    if (visibleInAnyView || wakeRequested) {
      this.hiddenSince = null;
    } else if (this.hiddenSince === null) {
      this.hiddenSince = input.now;
    }

    const sleptByVisibility =
      this.hiddenSince !== null &&
      input.now - this.hiddenSince >= this.hiddenSleepSeconds;
    const desired = wakeRequested
      ? this.awakeBand(input.distance)
      : sleptByVisibility
        ? "dormant"
        : classifyWithDistanceHysteresis(
            input.distance,
            this.band,
            this.distanceHysteresis,
            this.nearDistance,
            this.mediumDistance,
            this.farDistance,
          );

    if (
      this.band === null ||
      wakeRequested ||
      (visibleInAnyView && this.band === "dormant")
    ) {
      this.band = desired;
      this.candidateBand = null;
    } else if (desired === "dormant" && sleptByVisibility) {
      // The 0.75 s visibility grace period is already temporal hysteresis.
      this.band = "dormant";
      this.candidateBand = null;
    } else if (desired !== this.band) {
      if (this.candidateBand !== desired) {
        this.candidateBand = desired;
        this.candidateSince = input.now;
      } else if (input.now - this.candidateSince >= this.lodHysteresisSeconds) {
        this.band = desired;
        this.candidateBand = null;
      }
    } else {
      this.candidateBand = null;
    }

    const band = this.band ?? "dormant";
    if (band === "dormant") {
      return {
        band,
        resolution: null,
        updateHz: 0,
        rebuildDue: false,
        dormant: true,
        visibleInAnyView,
      };
    }

    const settings = this.settings[band];
    return {
      band,
      resolution: settings.resolution,
      updateHz: settings.updateHz,
      rebuildDue:
        input.forceWake === true ||
        input.now - this.lastRebuildAt >= 1 / settings.updateHz,
      dormant: false,
      visibleInAnyView,
    };
  }

  /** Call only after the scheduler actually completed this surface. */
  markRebuilt(now: number): void {
    if (!Number.isFinite(now)) {
      throw new Error("BlobSurfaceLodController: now must be finite");
    }
    this.lastRebuildAt = now;
  }

  reset(): void {
    this.band = null;
    this.candidateBand = null;
    this.hiddenSince = null;
    this.lastRebuildAt = -Infinity;
  }

  private awakeBand(distance: number): Exclude<BlobSurfaceLodBand, "dormant"> {
    const band = rawBand(
      distance,
      this.nearDistance,
      this.mediumDistance,
      this.farDistance,
    );
    return band === "dormant" ? "far" : band;
  }
}

function classifyWithDistanceHysteresis(
  distance: number,
  current: BlobSurfaceLodBand | null,
  hysteresis: number,
  nearDistance: number,
  mediumDistance: number,
  farDistance: number,
): BlobSurfaceLodBand {
  switch (current) {
    case "near":
      return distance > nearDistance + hysteresis
        ? rawBand(distance, nearDistance, mediumDistance, farDistance)
        : "near";
    case "medium":
      if (distance < nearDistance - hysteresis) return "near";
      return distance > mediumDistance + hysteresis
        ? rawBand(distance, nearDistance, mediumDistance, farDistance)
        : "medium";
    case "far":
      if (distance < mediumDistance - hysteresis) {
        return rawBand(distance, nearDistance, mediumDistance, farDistance);
      }
      return distance > farDistance + hysteresis ? "dormant" : "far";
    case "dormant":
      return distance < farDistance - hysteresis
        ? rawBand(distance, nearDistance, mediumDistance, farDistance)
        : "dormant";
    default:
      return rawBand(distance, nearDistance, mediumDistance, farDistance);
  }
}

function rawBand(
  distance: number,
  nearDistance: number,
  mediumDistance: number,
  farDistance: number,
): BlobSurfaceLodBand {
  if (distance <= nearDistance) return "near";
  if (distance <= mediumDistance) return "medium";
  if (distance <= farDistance) return "far";
  return "dormant";
}

function validateNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobSurfaceLodController: ${name} must be finite and >= 0`);
  }
}

function validatePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BlobSurfaceLodController: ${name} must be finite and > 0`);
  }
}
