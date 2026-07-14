export type BlobV2IslandId = string | number;

export interface BlobV2Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type BlobV2IslandKind = "main" | "fragment" | "scripted";

export type BlobV2FragmentVisualState =
  | "detaching"
  | "ballistic"
  | "returning"
  | "reattaching"
  | "withering";

/** A render cell already assigned to an authoritative topology island. */
export interface BlobV2RenderCellSnapshot {
  readonly id: string | number;
  /** Interpolated world-space position for the current render frame. */
  readonly position: BlobV2Vector3Like;
  readonly radius: number;
  readonly scale?: number;
  /** World-space contact normal used to flatten the field near surfaces. */
  readonly contactNormal?: BlobV2Vector3Like;
  /** Normalized contact compression in the [0, 1] range. */
  readonly contactAmount?: number;
}

/** The same wound record is intended to feed rendering, hit tests and damage. */
export interface BlobV2RenderWoundSnapshot {
  readonly id: string | number;
  readonly position: BlobV2Vector3Like;
  readonly radius: number;
  /** Multiplier for the negative field source. Defaults to one. */
  readonly strength?: number;
  /** False keeps a weakened depression visible without cutting skin pixels. */
  readonly opensSkin?: boolean;
}

export interface BlobV2RenderIslandSnapshot {
  readonly id: BlobV2IslandId;
  /** Changes whenever an ID is deliberately reused for a different island. */
  readonly generation: number;
  readonly kind: BlobV2IslandKind;
  /**
   * Monotonic topology/geometry version. Wound changes should increment it so
   * the presenter can bypass its normal update cadence without guessing.
   */
  readonly geometryRevision?: number;
  readonly cells: readonly BlobV2RenderCellSnapshot[];
  readonly wounds?: readonly BlobV2RenderWoundSnapshot[];
  readonly fragmentState?: BlobV2FragmentVisualState;
  readonly flowDirection?: BlobV2Vector3Like;
  readonly witherProgress?: number;
}

export type BlobV2CoreVisualState =
  | "covered"
  | "breached"
  | "exposed"
  | "redistributing";

export interface BlobV2RenderCoreSnapshot {
  readonly position: BlobV2Vector3Like;
  readonly radius: number;
  readonly visible?: boolean;
  readonly exposure?: number;
  readonly state?: BlobV2CoreVisualState;
}

export interface BlobV2RenderShedDropletSnapshot {
  readonly id: string | number;
  readonly position: BlobV2Vector3Like;
  readonly velocity: BlobV2Vector3Like;
  readonly radius: number;
  readonly witherProgress: number;
}

/**
 * Immutable input boundary for Blob V2 presentation. The presenter never
 * clusters cells and never writes back into this data.
 */
export interface BlobV2OrganismRenderSnapshot {
  readonly sequence: number;
  readonly mainIslandId: BlobV2IslandId;
  readonly islands: readonly BlobV2RenderIslandSnapshot[];
  readonly core: BlobV2RenderCoreSnapshot;
  readonly shedDroplets?: readonly BlobV2RenderShedDropletSnapshot[];
}

export interface BlobV2RenderView {
  /** Monotonic render time in seconds. */
  readonly now: number;
  /** Distance from the nearest active main or portal camera. */
  readonly viewerDistance: number;
  readonly mainViewVisible?: boolean;
  readonly portalViewVisible?: boolean;
  /** Damage, teleports and scripting can request an immediate rebuild. */
  readonly forceWake?: boolean;
}
