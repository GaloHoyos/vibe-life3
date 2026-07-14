import type {
  BlobOrganismState,
  BlobOverrideState,
  BlobTraversalState,
} from "@engine/blob/v2/BlobV2Types";

export interface BlobBehaviorSnapshot {
  readonly organismState: BlobOrganismState;
  readonly traversalState: BlobTraversalState;
  readonly overrideState: BlobOverrideState;
}

export interface BlobBehaviorControllerOptions {
  organismState?: BlobOrganismState;
  traversalState?: BlobTraversalState;
  overrideState?: BlobOverrideState;
  onChanged?: () => void;
}

/**
 * Small authority for the three orthogonal Blob state machines. Gameplay
 * adapters request transitions here; particle/topology code only reads the
 * resulting immutable state and never invents behavior from geometry.
 */
export class BlobBehaviorController {
  private organism: BlobOrganismState;
  private traversal: BlobTraversalState;
  private override: BlobOverrideState;
  private readonly onChanged?: () => void;

  constructor(options: BlobBehaviorControllerOptions = {}) {
    this.organism = options.organismState ?? "Idle";
    this.traversal = options.traversalState ?? "Ground";
    this.override = options.overrideState ?? "None";
    this.onChanged = options.onChanged;
  }

  get organismState(): BlobOrganismState {
    return this.organism;
  }

  get traversalState(): BlobTraversalState {
    return this.traversal;
  }

  get overrideState(): BlobOverrideState {
    return this.override;
  }

  get simulationEnabled(): boolean {
    return this.override !== "Frozen" && this.override !== "Dead";
  }

  get scriptedPoseActive(): boolean {
    return this.override === "ScriptedPose";
  }

  setOrganismState(state: BlobOrganismState): boolean {
    if (this.organism === state || this.override === "Dead") return false;
    this.organism = state;
    this.onChanged?.();
    return true;
  }

  setTraversalState(state: BlobTraversalState): boolean {
    if (this.traversal === state || this.override === "Dead") return false;
    this.traversal = state;
    this.onChanged?.();
    return true;
  }

  setOverrideState(state: BlobOverrideState): boolean {
    if (this.override === state || this.override === "Dead") return false;
    this.override = state;
    this.onChanged?.();
    return true;
  }

  snapshot(): BlobBehaviorSnapshot {
    return Object.freeze({
      organismState: this.organism,
      traversalState: this.traversal,
      overrideState: this.override,
    });
  }
}
