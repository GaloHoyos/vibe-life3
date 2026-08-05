import { WORLD_GRAVITY } from '@engine/physics/PhysicsWorld';
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
import type { VehicleTacticId } from './VehicleTacticalTypes';

export type VehicleNavPoint = readonly [number, number, number];

export interface VehicleNavigationProfile {
  id: VehiclePresetId | (string & {});
  /** `rail` y `air` nunca llegan al bake: no tienen grilla que recorrer. */
  surface: 'ground' | 'water' | 'rail' | 'air';
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
  /**
   * Puntos donde de verdad hay vehículos: spawns, carriles y marcadores. Sólo
   * sobreviven las islas que alcanzan alguno. Sin esto la cara superior de cada
   * edificio entra al grid como plataforma inalcanzable.
   */
  seeds?: readonly VehicleNavPoint[];
  options?: VehicleNavigationBakeOptions;
}

export type VehicleNavCellFlag = 'noCombat' | 'noReverse' | 'parking' | 'shore';

/** Anotaciones que comparten muchas celdas; la grilla las guarda en paleta. */
export interface VehicleNavAttributes {
  /** `''` cuando la celda salio de la geometria y ninguna area la anota. */
  areaId: string;
  cost: number;
  speedLimit: number | null;
  flags: readonly VehicleNavCellFlag[];
  tags: readonly string[];
}

/** Celda expandida: forma de trabajo del bake y de las consultas puntuales. */
export interface VehicleNavCell extends VehicleNavAttributes {
  ix: number;
  iz: number;
  position: VehicleNavPoint;
  surface: 'ground' | 'water';
  /**
   * Isla de conectividad. Dos celdas con distinto `componentId` no se alcanzan
   * manejando, aunque esten a metros: es el test barato de "¿me sirve el
   * vehiculo para llegar ahi?".
   */
  componentId: number;
}

/**
 * Columnas paralelas ordenadas por `(ix, iz)`. Un valle de 340 x 320 da del
 * orden de 70k celdas por perfil: como array de objetos son ~20 MB de structured
 * clone por nivel, que no entran ni en el postMessage del worker ni en
 * IndexedDB. En columnas son ~16 bytes por celda.
 */
export interface VehicleNavCells {
  readonly ix: Int32Array;
  readonly iz: Int32Array;
  /** Cota de la superficie; `x` y `z` salen de `origin`, `ix`/`iz` y `cellSize`. */
  readonly y: Float32Array;
  readonly attribute: Uint16Array;
  readonly component: Uint16Array;
}

export interface VehicleNavGrid {
  profileId: string;
  cellSize: number;
  origin: readonly [number, number];
  surface: 'ground' | 'water' | 'rail' | 'air';
  attributes: readonly VehicleNavAttributes[];
  cells: VehicleNavCells;
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
  schemaVersion: 2;
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
  id?: string;
  position?: VehicleNavPoint;
}

export interface VehicleRecoveryClearance {
  /** Free distance measured from the hull, in metres. */
  front: number;
  rear: number;
  left: number;
  right: number;
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
  mobility?: 'foot' | 'vehicle' | 'unknown';
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
  /** Invalidates asynchronous plans when an order, tactic, anchor or blocker changes. */
  planContextKey?: string;
  /** Signed planar velocity along local +Z. */
  speed: number;
  /** Unsigned XZ velocity, used for safe exits and progress checks. */
  planarSpeed?: number;
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
  /** Four-way physical probe used to choose a feasible recovery manoeuvre. */
  recoveryClearance?: VehicleRecoveryClearance;
  /** Alcance del arma montada; 0 si el vehículo va desarmado. */
  weaponRange?: number;
  /** La torreta se quedó sin recorrido: conviene reposicionar el casco. */
  turretAtTraverseLimit?: boolean;
  /** Tope de velocidad impuesto por convoy o por ceder el paso. */
  externalSpeedLimit?: number;
  /**
   * Si el blanco está en la misma isla del grid que el vehículo. `false` es
   * "hasta acá llego manejando": el interior de un edificio o el otro lado de
   * un barranco. Ausente = todavía no se sabe, se asume alcanzable.
   */
  threatReachableByVehicle?: boolean;
  /** Utility-selected action committed independently from the authored mission. */
  tactic?: VehicleTacticId;
  /** Stable combat pose retained while the tactical commitment is valid. */
  tacticalAnchor?: VehicleNavPoint;
  /** Physical exit check supplied by the runtime. */
  safeToDismount?: boolean;
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
  | 'forwardCounter'
  | 'reverseOpposite'
  | 'forwardCounterOpposite'
  | 'rock'
  | 'passingBay'
  | 'selfRight'
  | 'waitForSafeRecovery';

export type VehicleCrewAiAction =
  | 'none'
  | 'replaceDriver'
  | 'requestBoarding'
  | 'requestDisembark'
  /** El blanco quedó donde el vehículo no llega: baja infantería a seguirlo. */
  | 'dismountToPursue'
  /** El vehículo ya no sirve: se baja todo el mundo. */
  | 'abandonVehicle';

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

/**
 * Si el perfil se planifica sobre una grilla. Los guionados siguen su trazado y
 * los aéreos no pisan celdas; el predicado de tipo deja que quien lo consulte
 * asuma después una superficie con grilla sin volver a comprobarlo.
 */
export function profileHasNavGrid(
  profile: VehicleNavigationProfile,
): profile is VehicleNavigationProfile & { surface: 'ground' | 'water' } {
  return profile.surface === 'ground' || profile.surface === 'water';
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
    case 'rotorcraft':
      // Un helicóptero acelera inclinándose: la componente horizontal del
      // empuje a inclinación máxima es todo lo que tiene.
      maxAcceleration = WORLD_GRAVITY * Math.tan(preset.motor.maxPitch);
      maxBraking = maxAcceleration;
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
