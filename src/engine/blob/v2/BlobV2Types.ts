export const BLOB_V2_FIXED_STEP_SECONDS = 1 / 30;
export const BLOB_V2_INITIAL_BIOMASS = 192;
export const BLOB_V2_MAX_BIOMASS = 250;
export const BLOB_V2_MAX_FRAGMENTS = 6;
/** Combat islands below this biomass cannot sustain autonomous life. */
export const BLOB_V2_MIN_FRAGMENT_BIOMASS = 4;
export const BLOB_V2_COHESION_THRESHOLD = 36;
export const BLOB_V2_COHESION_DECAY_PER_SECOND = 12;
export const BLOB_V2_COHESION_DECAY_DELAY_SECONDS = 0.75;
export const BLOB_V2_FRAGMENT_RETURN_SECONDS = 10;
export const BLOB_V2_FRAGMENT_WITHER_SECONDS = 1.5;
export const BLOB_V2_SHED_WITHER_SECONDS = 1.5;
export const BLOB_V2_FRAGMENT_REATTACH_SECONDS = 0.6;
export const BLOB_V2_REDISTRIBUTION_DELAY_SECONDS = 3;
export const BLOB_V2_REDISTRIBUTION_SECONDS = 2;

export type BlobCellId = number;
export type BlobIslandId = number;
export type BlobWoundId = number;
export type BlobFragmentId = number;
export type BlobShedDropletId = number;

export interface BlobVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlobQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Rigid portal transform, defined as p' = rotation * p + translation. */
export interface BlobIslandTransform {
  readonly rotation: BlobQuaternion;
  readonly translation: BlobVector3;
}

export type BlobOrganismState =
  | "Spawn"
  | "Idle"
  | "Search"
  | "Hunt"
  | "Envelop"
  | "Digest";

export type BlobTraversalState =
  | "Ground"
  | "Climb"
  | "Squeeze"
  | "Leap"
  | "PortalTraverse";

export type BlobOverrideState =
  | "None"
  | "ScriptedPose"
  | "Frozen"
  | "Dying"
  | "Dead";

export type BlobCoreState =
  | "Covered"
  | "Breached"
  | "Exposed"
  | "Redistributing"
  | "Dying"
  | "Dead";

export type BlobFragmentState =
  | "Detaching"
  | "Ballistic"
  | "Returning"
  | "Reattaching"
  | "Attached"
  | "Withering"
  | "Dead";

export type BlobWoundState =
  | "Stressed"
  | "Breached"
  | "Exposed"
  | "Reattaching"
  | "Redistributing"
  | "Closed";

export type BlobIslandKind = "main" | "combat-fragment" | "scripted";
export type BlobCellMembership = "attached" | "combat-fragment";

export interface BlobCellSnapshot {
  readonly id: BlobCellId;
  readonly islandId: BlobIslandId;
  readonly membership: BlobCellMembership;
  readonly isCore: boolean;
}

export interface BlobIslandSnapshot {
  readonly id: BlobIslandId;
  readonly generation: number;
  readonly kind: BlobIslandKind;
  readonly fragmentId: BlobFragmentId | null;
  readonly biomass: number;
  readonly mergeRequested: boolean;
}

export interface BlobBiomassSnapshot {
  readonly initial: number;
  readonly maximum: number;
  readonly total: number;
  readonly attached: number;
  readonly fragments: number;
  readonly created: number;
  readonly lost: number;
}

export interface BlobWoundSnapshot {
  readonly id: BlobWoundId;
  readonly point: BlobVector3;
  readonly normal: BlobVector3;
  readonly radius: number;
  readonly state: BlobWoundState;
  readonly cohesionEnergy: number;
  readonly cohesionThreshold: number;
  readonly repairDeficit: number;
  readonly detachedBiomass: number;
  readonly fragmentId: BlobFragmentId | null;
  readonly createdAt: number;
  readonly lastImpactAt: number;
  readonly openedAt: number | null;
  readonly reattachProgress: number;
  readonly sourceWoundId: BlobWoundId | null;
}

export interface BlobCoreSnapshot {
  readonly state: BlobCoreState;
  readonly health: number;
  readonly maximumHealth: number;
  readonly damageMultiplier: number;
  readonly position: BlobVector3;
  readonly radius: number;
}

export interface BlobFragmentSnapshot {
  readonly id: BlobFragmentId;
  readonly islandId: BlobIslandId;
  readonly generation: number;
  readonly woundId: BlobWoundId;
  readonly state: BlobFragmentState;
  readonly biomass: number;
  readonly cellIds: readonly BlobCellId[];
  readonly position: BlobVector3;
  readonly velocity: BlobVector3;
  readonly detachedAt: number;
  readonly stateStartedAt: number;
  readonly age: number;
  readonly reattachProgress: number;
  readonly witherProgress: number;
  readonly damageRemainder: number;
  readonly needsPath: boolean;
}

/** Lost biomass rendered briefly as ballistic liquid; never autonomous or reattachable. */
export interface BlobShedDropletSnapshot {
  readonly id: BlobShedDropletId;
  readonly biomass: number;
  readonly position: BlobVector3;
  readonly velocity: BlobVector3;
  readonly radius: number;
  readonly createdAt: number;
  readonly age: number;
  readonly witherProgress: number;
}

export interface BlobParticleSnapshot {
  readonly cellId: BlobCellId;
  readonly islandId: BlobIslandId;
  readonly position: BlobVector3;
  readonly previousPosition: BlobVector3;
  readonly renderPosition: BlobVector3;
  readonly velocity: BlobVector3;
  readonly radius: number;
  /** World-space surface normal reported by the authoritative contact sweep. */
  readonly contactNormal?: BlobVector3;
  /** Normalized compression caused by the contact during the last fixed step. */
  readonly contactAmount?: number;
}

export interface BlobScriptedSplitSnapshot {
  readonly active: boolean;
  readonly mergeRequested: boolean;
  readonly islandIds: readonly BlobIslandId[];
}

export interface BlobOrganismSnapshot {
  readonly version: number;
  readonly simulationTime: number;
  readonly interpolationAlpha: number;
  readonly organismState: BlobOrganismState;
  readonly traversalState: BlobTraversalState;
  readonly overrideState: BlobOverrideState;
  readonly biomass: BlobBiomassSnapshot;
  readonly core: BlobCoreSnapshot;
  readonly cells: readonly BlobCellSnapshot[];
  readonly islands: readonly BlobIslandSnapshot[];
  readonly wounds: readonly BlobWoundSnapshot[];
  readonly fragments: readonly BlobFragmentSnapshot[];
  readonly shedDroplets: readonly BlobShedDropletSnapshot[];
  readonly particles: readonly BlobParticleSnapshot[];
  readonly scriptedSplit: BlobScriptedSplitSnapshot;
}

export interface BlobCoverageSector {
  readonly id: string;
  readonly center: BlobVector3;
  readonly normal?: BlobVector3;
  readonly availableBiomass: number;
}

export interface BlobFragmentObservation {
  readonly position?: BlobVector3;
  readonly velocity?: BlobVector3;
  readonly grounded?: boolean;
  readonly lineOfSightToOwner?: boolean;
  readonly pathVelocity?: BlobVector3;
}

export interface BlobParticleContactResult {
  readonly position: BlobVector3;
  readonly velocity?: BlobVector3;
  readonly grounded?: boolean;
  readonly normal?: BlobVector3;
}

export type BlobParticleContactResolver = (
  cellId: BlobCellId,
  from: BlobVector3,
  desiredPosition: BlobVector3,
  radius: number,
) => BlobParticleContactResult | BlobVector3 | void;

export type BlobFragmentMotionResolver = (
  fragmentId: BlobFragmentId,
  islandId: BlobIslandId,
  from: BlobVector3,
  desiredPosition: BlobVector3,
  velocity: BlobVector3,
  radius: number,
) => BlobParticleContactResult | BlobVector3 | void;

export interface BlobStepInput {
  readonly desiredVelocity?: BlobVector3;
  readonly gravity?: number;
  readonly contactResolver?: BlobParticleContactResolver;
  readonly fragmentObservations?: Readonly<Record<number, BlobFragmentObservation>>;
  readonly fragmentMotionResolver?: BlobFragmentMotionResolver;
  /** World-space pose targets. Combat-fragment cells deliberately ignore them. */
  readonly particleTargets?: Readonly<Record<number, BlobVector3>>;
  /** Pull gain in 1/s, clamped to a stable range. Defaults to 10. */
  readonly particleTargetStrength?: number;
}

export interface BlobStepResult {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedTime: number;
}

export interface BlobDamageImpact {
  readonly point: BlobVector3;
  /** Direction in which the projectile/impulse travels, toward the organism. */
  readonly direction: BlobVector3;
  readonly normal?: BlobVector3;
  readonly damage: number;
  readonly cohesionEnergy?: number;
  readonly impulse?: BlobVector3;
  readonly explosive?: boolean;
  readonly fragmentId?: BlobFragmentId;
  /** Deterministic adapter/test override. Runtime weapons normally omit it. */
  readonly detachBiomass?: number;
}

export type BlobDamageTarget = "none" | "skin" | "core" | "fragment";

export interface BlobDamageResult {
  readonly target: BlobDamageTarget;
  readonly woundId: BlobWoundId | null;
  readonly fragmentId: BlobFragmentId | null;
  readonly openedBreach: boolean;
  readonly coreDamage: number;
  readonly biomassLost: number;
}

export interface BlobConsumptionResult {
  readonly requested: number;
  readonly accepted: number;
  readonly repaired: number;
  readonly restored: number;
  readonly growth: number;
  readonly coreHealing: number;
}

export interface BlobCommandResult {
  readonly ok: boolean;
  readonly reason?: "busy" | "invalid" | "not-split" | "unknown-island";
  readonly islandIds: readonly BlobIslandId[];
}

export interface BlobOrganismControllerOptions {
  readonly center?: BlobVector3;
  readonly initialBiomass?: number;
  readonly maximumBiomass?: number;
  readonly seed?: number;
  readonly particleRadius?: number;
  readonly coreHealth?: number;
  readonly coreRadius?: number;
  readonly fragmentReturnSpeed?: number;
  readonly fragmentReattachDistance?: number;
  readonly coverageSectors?: readonly BlobCoverageSector[];
}

export type BlobOrganismEvent =
  | { readonly type: "fragmentDetached"; readonly fragmentId: BlobFragmentId; readonly woundId: BlobWoundId; readonly biomass: number }
  | { readonly type: "fragmentReattached"; readonly fragmentId: BlobFragmentId; readonly woundId: BlobWoundId; readonly biomass: number }
  | { readonly type: "fragmentWithered"; readonly fragmentId: BlobFragmentId; readonly woundId: BlobWoundId; readonly biomassLost: number }
  | { readonly type: "fragmentDestroyed"; readonly fragmentId: BlobFragmentId; readonly woundId: BlobWoundId; readonly biomassLost: number }
  | { readonly type: "shedDropletSpawned"; readonly dropletId: BlobShedDropletId; readonly biomass: number }
  | { readonly type: "shedDropletWithered"; readonly dropletId: BlobShedDropletId; readonly biomass: number }
  | { readonly type: "fragmentPathRequested"; readonly fragmentId: BlobFragmentId }
  | { readonly type: "coreExposed"; readonly woundId: BlobWoundId }
  | { readonly type: "coreCovered" }
  | { readonly type: "breachRelocated"; readonly woundId: BlobWoundId; readonly newWoundId: BlobWoundId; readonly sectorId: string }
  | { readonly type: "preyEnveloped"; readonly preyId: string }
  | { readonly type: "preyConsumed"; readonly preyId: string; readonly biomass: number }
  | { readonly type: "biomassChanged"; readonly total: number; readonly attached: number; readonly fragments: number; readonly reason: "consumed" | "fragment-damage" | "fragment-wither" | "overflow-shed" }
  | { readonly type: "split"; readonly islandIds: readonly BlobIslandId[] }
  | { readonly type: "mergeRequested"; readonly islandIds: readonly BlobIslandId[] }
  | { readonly type: "merged" }
  | { readonly type: "error"; readonly command: "SplitBlob" | "MergeBlob"; readonly reason: string };

export function finiteVector(value: BlobVector3, label: string): BlobVector3 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    throw new RangeError(`${label} must contain finite coordinates`);
  }
  return value;
}

export function freezeVector(value: BlobVector3): BlobVector3 {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

export function freezeItems<T extends object>(items: readonly T[]): readonly Readonly<T>[] {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}
