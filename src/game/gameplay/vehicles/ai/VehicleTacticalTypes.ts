export type VehicleTacticalPoint = readonly [number, number, number];

export const VEHICLE_OBJECTIVE_SOURCES = [
  'overwatch',
  'extraction',
  'authored',
  'autonomous',
] as const;
export type VehicleObjectiveSource = (typeof VEHICLE_OBJECTIVE_SOURCES)[number];

export const VEHICLE_OBJECTIVE_KINDS = [
  'hold',
  'move',
  'patrol',
  'escort',
  'transport',
  'intercept',
  'flank',
  'retreat',
  'land',
  'extract',
] as const;
export type VehicleObjectiveKind = (typeof VEHICLE_OBJECTIVE_KINDS)[number];

export type VehicleObjectiveTarget =
  | { readonly type: 'none' }
  | {
      readonly type: 'position';
      readonly position: VehicleTacticalPoint;
      readonly heading?: number;
    }
  | {
      readonly type: 'entity';
      readonly entityId: string;
      readonly lastKnownPosition?: VehicleTacticalPoint;
    }
  | {
      readonly type: 'route';
      readonly points: readonly VehicleTacticalPoint[];
      readonly loop: boolean;
    }
  | {
      readonly type: 'area';
      readonly center: VehicleTacticalPoint;
      readonly radius: number;
    };

export const VEHICLE_OBJECTIVE_FAILURE_REASONS = [
  'unreachable',
  'vehicleDisabled',
  'noDriver',
  'targetLost',
  'blocked',
  'unsafe',
  'noSafeLanding',
  'resourceUnavailable',
  'crewRejected',
  'timedOut',
] as const;
export type VehicleObjectiveFailureReason =
  (typeof VEHICLE_OBJECTIVE_FAILURE_REASONS)[number];

export interface VehicleObjectiveFailure {
  readonly reason: VehicleObjectiveFailureReason;
  readonly atSeconds: number;
  readonly recoverable: boolean;
  readonly detail?: string;
}

export type VehicleObjectiveStatus =
  | 'queued'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface VehicleObjective {
  readonly id: string;
  readonly revision: number;
  readonly source: VehicleObjectiveSource;
  readonly kind: VehicleObjectiveKind;
  readonly target: VehicleObjectiveTarget;
  readonly status: VehicleObjectiveStatus;
  readonly issuedAtSeconds: number;
  readonly updatedAtSeconds: number;
  readonly failure?: VehicleObjectiveFailure;
}

export interface VehicleObjectiveRequest {
  readonly id: string;
  readonly revision: number;
  readonly source: VehicleObjectiveSource;
  readonly kind: VehicleObjectiveKind;
  readonly target: VehicleObjectiveTarget;
  readonly issuedAtSeconds: number;
}

export interface VehicleObjectiveTransition {
  readonly previousActive: VehicleObjective | null;
  readonly active: VehicleObjective | null;
  readonly outcome: VehicleObjective | null;
  readonly changed: boolean;
}

export const VEHICLE_TACTIC_IDS = [
  'follow',
  'intercept',
  'attackRun',
  'suppress',
  'reposition',
  'deploy',
  'search',
  'recover',
  'replaceDriver',
  'switchVehicle',
  'continueOnFoot',
  'requestExtraction',
  'abandon',
] as const;
export type VehicleTacticId = (typeof VEHICLE_TACTIC_IDS)[number];

export type VehicleTargetMobility = 'foot' | 'vehicle' | 'unknown';

export interface VehicleCapabilitySet {
  readonly canDrive: boolean;
  readonly canReverse: boolean;
  readonly canRecover: boolean;
  readonly driverAvailable: boolean;
  readonly replacementDriverIds: readonly string[];
  readonly deployableActorIds: readonly string[];
  readonly canContinueOnFoot: boolean;
  readonly canAbandon: boolean;
  readonly weapon: {
    readonly operational: boolean;
    readonly operatorAvailable: boolean;
    readonly traverseAvailable: boolean;
    readonly range: number;
  };
  readonly alternativeVehicleIds: readonly string[];
  readonly extractionAvailable: boolean;
  readonly isTransport: boolean;
  readonly cargoActorIds: readonly string[];
}

export interface VehicleTacticalThreat {
  readonly id: string;
  readonly mobility: VehicleTargetMobility;
  readonly visible: boolean;
  readonly memoryAgeSeconds: number;
  readonly distance: number;
  readonly reachableByVehicle: boolean | null;
  readonly lineOfSight: boolean;
  readonly withinWeaponRange: boolean;
  readonly position?: VehicleTacticalPoint;
}

export interface VehicleTacticalAnchor {
  readonly key: string;
  readonly position: VehicleTacticalPoint;
}

export interface VehicleTacticalSituation {
  readonly nowSeconds: number;
  readonly objective: VehicleObjective | null;
  readonly capabilities: VehicleCapabilitySet;
  readonly objectiveDistance: number | null;
  readonly objectiveReachable: boolean | null;
  readonly routeAvailable: boolean;
  readonly blockedSeconds: number;
  readonly noProgressSeconds: number;
  readonly healthFraction: number;
  readonly overturned: boolean;
  readonly visibleToPlayer: boolean;
  readonly underFire: boolean;
  readonly safeToDismount: boolean;
  readonly deploymentPositionAvailable: boolean;
  readonly extractionRequested: boolean;
  readonly threat: VehicleTacticalThreat | null;
  readonly preferredAnchor?: VehicleTacticalAnchor;
  /** Región, obstáculo o corredor que hace equivalentes dos intentos fallidos. */
  readonly memoryContext?: string;
}

export interface VehicleTacticalDoctrine {
  readonly id: 'combine' | 'resistance' | 'transport';
  readonly utility: Readonly<Record<VehicleTacticId, number>>;
  readonly riskTolerance: number;
  readonly ramEnemyVehicles: boolean;
  readonly deployAgainstFootTargets: boolean;
  readonly preserveCargo: boolean;
}

export interface VehicleTacticCandidate {
  readonly tactic: VehicleTacticId;
  readonly baseUtility: number;
  readonly situationUtility: number;
  readonly failurePenalty: number;
  readonly coolingDown: boolean;
  readonly utility: number;
}

export interface VehicleTacticalDecision {
  readonly tactic: VehicleTacticId;
  readonly utility: number;
  readonly changed: boolean;
  readonly committedUntilSeconds: number;
  readonly anchor: VehicleTacticalAnchor | null;
  readonly anchorUntilSeconds: number;
  readonly candidates: readonly VehicleTacticCandidate[];
}

export type VehicleTacticFailureReason =
  | VehicleObjectiveFailureReason
  | 'noProgress'
  | 'rejected';

export interface VehicleTacticMemoryScope {
  readonly objectiveId: string;
  readonly objectiveRevision: number;
  readonly context: string;
}

export interface VehicleTacticAttempt {
  readonly scope: VehicleTacticMemoryScope;
  readonly tactic: VehicleTacticId;
  readonly reason: VehicleTacticFailureReason;
  readonly atSeconds: number;
}
