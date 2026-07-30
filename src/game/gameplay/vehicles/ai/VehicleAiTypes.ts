import {
  vehicleTopSpeed,
  type VehiclePresetDefinition,
  type VehiclePresetId,
} from '@game/config/vehicles.config';
import type {
  VehicleAiBehavior,
  VehicleNavAreaDefinition,
  VehicleNavLaneDefinition,
  VehicleNavMarkerDefinition,
  WaterVolumeDefinition,
} from '@game/levels/LevelDefinition';

export type VehicleNavPoint = readonly [number, number, number];

export interface VehicleNavigationProfile {
  id: VehiclePresetId | (string & {});
  surface: 'ground' | 'water' | 'rail';
  halfWidth: number;
  halfLength: number;
  clearanceHeight: number;
  minTurnRadius: number;
  reverseAllowed: boolean;
  maxSlopeRadians: number;
  maxSpeed: number;
  maxAcceleration: number;
  maxBraking: number;
  maxSteeringAngle: number;
  wheelbase: number;
  cellSize: number;
}

export interface VehicleBakeObstacle {
  id: string;
  min: VehicleNavPoint;
  max: VehicleNavPoint;
}

export interface VehicleSurfaceSample {
  position: VehicleNavPoint;
  normal: VehicleNavPoint;
  surface: 'ground' | 'water';
  /** Altura libre medida desde la superficie; Infinity se serializa como null. */
  clearance?: number | null;
  blocked?: boolean;
}

export interface VehicleBakeGeometry {
  revision?: string;
  obstacles: readonly VehicleBakeObstacle[];
  surfaceSamples?: readonly VehicleSurfaceSample[];
}

export interface VehicleNavigationBakeOptions {
  cellSize?: number;
  maxSampleDistance?: number;
  endpointConnectionDistance?: number;
  maxVerticalConnection?: number;
}

export interface VehicleNavigationBakeInput {
  geometry: VehicleBakeGeometry;
  waterVolumes: readonly WaterVolumeDefinition[];
  areas: readonly VehicleNavAreaDefinition[];
  lanes: readonly VehicleNavLaneDefinition[];
  markers: readonly VehicleNavMarkerDefinition[];
  profiles: readonly VehicleNavigationProfile[];
  options?: VehicleNavigationBakeOptions;
}

export interface VehicleNavCell {
  key: string;
  ix: number;
  iz: number;
  position: VehicleNavPoint;
  areaId: string;
  surface: 'ground' | 'water';
  cost: number;
  speedLimit: number | null;
  flags: readonly ('noCombat' | 'noReverse' | 'parking' | 'shore')[];
  tags: readonly string[];
}

export interface VehicleNavGrid {
  profileId: string;
  cellSize: number;
  origin: readonly [number, number];
  cells: readonly VehicleNavCell[];
}

export interface VehicleLaneNode {
  id: string;
  position: VehicleNavPoint;
  laneId: string;
  pointIndex: number;
}

export interface VehicleLaneEdge {
  id: string;
  from: string;
  to: string;
  laneId: string | null;
  length: number;
  travelCost: number;
  speedLimit: number;
  priority: number;
  width: number;
  tags: readonly string[];
  reservable: boolean;
}

export interface VehicleLaneGraphData {
  nodes: readonly VehicleLaneNode[];
  edges: readonly VehicleLaneEdge[];
}

export interface VehicleNavigationBake {
  schemaVersion: 1;
  hash: string;
  grids: readonly VehicleNavGrid[];
  laneGraph: VehicleLaneGraphData;
  markers: readonly VehicleNavMarkerDefinition[];
}

export interface VehiclePose2D {
  position: VehicleNavPoint;
  /** Radianes; cero mira hacia +Z. */
  heading: number;
}

export type VehicleDriveDirection = 'forward' | 'reverse';

export interface VehicleHybridPathPoint {
  position: VehicleNavPoint;
  heading: number;
  direction: VehicleDriveDirection;
  speedLimit: number | null;
}

export interface VehicleHybridPath {
  points: readonly VehicleHybridPathPoint[];
  cost: number;
  expandedStates: number;
  reachedGoal: boolean;
}

export interface VehicleDrivingPathPoint {
  position: VehicleNavPoint;
  speedLimit?: number;
  direction?: VehicleDriveDirection;
}

export interface VehicleDrivingPath {
  points: readonly VehicleDrivingPathPoint[];
  loop?: boolean;
}

export interface VehicleObstacleObservation {
  id: string;
  position: VehicleNavPoint;
  velocity: VehicleNavPoint;
  radius: number;
  blocking?: boolean;
}

export interface VehicleShapeCastObservation {
  distance: number;
  closingSpeed: number;
  lateralOffset: number;
  radius?: number;
}

export interface VehicleFollowerInput {
  delta: number;
  pose: VehiclePose2D;
  speed: number;
  path: VehicleDrivingPath;
  obstacles?: readonly VehicleObstacleObservation[];
  shapeCasts?: readonly VehicleShapeCastObservation[];
  /** Tope externo (convoy, ceder el paso) por encima del límite del path. */
  speedLimit?: number;
}

export interface VehicleControlCommand {
  throttle: number;
  brake: number;
  steering: number;
  reverse: boolean;
  handbrake: boolean;
  targetSpeed: number;
  targetPoint: VehicleNavPoint | null;
  timeToCollision: number | null;
}

export interface VehicleLaneRoute {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  points: readonly VehicleNavPoint[];
  cost: number;
}

export interface VehicleAiTarget {
  id: string;
  position: VehicleNavPoint;
  velocity?: VehicleNavPoint;
  heading?: number;
  /** LOS confirmada ahora mismo. Sin esto la posición es un último-visto. */
  visible?: boolean;
  /** Segundos desde la última vez que se lo vio. */
  memoryAge?: number;
}

/**
 * Estado runtime, ortogonal al `behavior` autorado: el comportamiento es la
 * misión y el estado es lo que el vehículo está haciendo ahora, que puede
 * apartarse de la misión y después retomarla.
 */
export type VehicleAiState =
  | 'idle'
  | 'driving'
  | 'engaging'
  | 'pursuing'
  | 'searching'
  | 'evading'
  | 'recovering'
  | 'stopped';

export interface VehicleBrainContext {
  pose: VehiclePose2D;
  speed: number;
  distanceToPlayer: number;
  visibleToPlayer: boolean;
  hasPlayerOccupant: boolean;
  healthFraction: number;
  driverAvailable: boolean;
  replacementDriverAvailable?: boolean;
  passengersOnboard?: boolean;
  blocked: boolean;
  /** Id de quien bloquea el paso, para decidir si vale la pena tocar bocina. */
  blockedBy?: string | null;
  overturned: boolean;
  route?: VehicleDrivingPath;
  authoredGoal?: VehicleNavPoint;
  patrolPoints?: readonly VehicleNavPoint[];
  escortTarget?: VehicleAiTarget;
  threat?: VehicleAiTarget;
  retreatPoint?: VehicleNavPoint;
  passingBay?: VehicleNavMarkerDefinition;
  recoveryMarker?: VehicleNavMarkerDefinition;
  obstacles?: readonly VehicleObstacleObservation[];
  shapeCasts?: readonly VehicleShapeCastObservation[];
  /** Alcance del arma montada; 0 si el vehículo va desarmado. */
  weaponRange?: number;
  /** La torreta se quedó sin recorrido: conviene reposicionar el casco. */
  turretAtTraverseLimit?: boolean;
  /** Tope de velocidad impuesto por convoy o por ceder el paso. */
  externalSpeedLimit?: number;
}

/** Señales no-motrices que el conductor puede accionar. */
export interface VehicleAiSignals {
  horn: boolean;
  /** `null` deja las luces como estén. */
  headlights: boolean | null;
}

export type VehicleRecoveryAction =
  | 'none'
  | 'brake'
  | 'replan'
  | 'reverse'
  | 'rock'
  | 'passingBay'
  | 'selfRight'
  | 'waitForSafeRecovery';

export type VehicleCrewAiAction =
  | 'none'
  | 'replaceDriver'
  | 'requestBoarding'
  | 'requestDisembark';

export interface VehicleBrainDecision {
  tickInterval: number;
  behavior: VehicleAiBehavior;
  state: VehicleAiState;
  goal: VehicleNavPoint | null;
  requestPlan: boolean;
  control: VehicleControlCommand;
  recovery: VehicleRecoveryAction;
  crewAction: VehicleCrewAiAction;
  signals: VehicleAiSignals;
}

export function navigationProfileFromPreset(
  preset: VehiclePresetDefinition,
): VehicleNavigationProfile {
  const navigation = preset.navigation;
  const maxSpeed = vehicleTopSpeed(preset);
  let maxAcceleration: number;
  let maxBraking: number;
  let maxSteeringAngle: number;
  switch (preset.motor.kind) {
    case 'raycast':
      maxAcceleration = preset.motor.engineForce / preset.body.mass;
      maxBraking = preset.motor.brakeForce / Math.max(1, preset.body.mass * 0.08);
      maxSteeringAngle = preset.motor.maxSteeringAngle;
      break;
    case 'hover':
      maxAcceleration = preset.motor.thrustForce / preset.body.mass;
      maxBraking = maxAcceleration * 1.25;
      maxSteeringAngle = 0.58;
      break;
    case 'onRails':
      maxAcceleration = preset.motor.acceleration;
      maxBraking = preset.motor.braking;
      maxSteeringAngle = 0;
      break;
  }
  return {
    id: preset.id,
    ...navigation,
    maxSlopeRadians: navigation.surface === 'water' ? 0.3 : 0.58,
    maxSpeed,
    maxAcceleration,
    maxBraking,
    maxSteeringAngle,
    wheelbase: Math.max(1, navigation.halfLength * 1.55),
    cellSize: Math.max(0.75, navigation.halfWidth * 0.75),
  };
}
