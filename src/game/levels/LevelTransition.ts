import { MathUtils, Quaternion, Vector3 } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';

export interface LevelLandmark {
  position: VectorTuple;
  /** Orientación del eje +Z del landmark, en radianes. */
  yaw?: number;
}

/** Los tuples se conservan para cargar mapas y documentos anteriores. */
export type LandmarkReference = LevelLandmark | VectorTuple;

export type QuaternionTuple = [number, number, number, number];

export interface TransitionKinematicState {
  id?: string;
  transitionKey?: string;
  actor?: string;
  seatId?: string;
  position: VectorTuple;
  yaw?: number;
  rotation?: QuaternionTuple;
  linearVelocity?: VectorTuple;
  angularVelocity?: VectorTuple;
}

export interface TransitionVehicleState extends TransitionKinematicState {
  occupants?: TransitionKinematicState[];
}

export interface TransitionWorldState {
  player: TransitionKinematicState;
  npcs: TransitionKinematicState[];
  vehicles: TransitionVehicleState[];
}

export interface SerializedRigidBodyKinematics {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly linearVelocity: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
}

export interface LandmarkTransform {
  readonly source: LevelLandmark;
  readonly destination: LevelLandmark;
  readonly yawDelta: number;
  transformPosition(position: VectorTuple): VectorTuple;
  transformVector(vector: VectorTuple): VectorTuple;
  transformYaw(yaw: number): number;
  transformRotation(rotation: QuaternionTuple): QuaternionTuple;
  transformKinematics(state: TransitionKinematicState): TransitionKinematicState;
}

const UP = new Vector3(0, 1, 0);

export function normalizeLandmark(landmark: LandmarkReference): LevelLandmark {
  if (Array.isArray(landmark)) {
    return { position: cloneVector(landmark), yaw: 0 };
  }
  return {
    position: cloneVector(landmark.position),
    ...(landmark.yaw === undefined ? {} : { yaw: landmark.yaw }),
  };
}

export function createLandmarkTransform(
  sourceReference: LandmarkReference,
  destinationReference: LandmarkReference,
): LandmarkTransform {
  const source = normalizeLandmark(sourceReference);
  const destination = normalizeLandmark(destinationReference);
  const yawDelta = normalizeRadians((destination.yaw ?? 0) - (source.yaw ?? 0));
  const sourcePosition = new Vector3(...source.position);
  const destinationPosition = new Vector3(...destination.position);
  const yawRotation = new Quaternion().setFromAxisAngle(UP, yawDelta);

  const transformVector = (value: VectorTuple): VectorTuple => {
    const transformed = new Vector3(...value).applyQuaternion(yawRotation);
    return vectorTuple(transformed);
  };

  const transformPosition = (value: VectorTuple): VectorTuple => {
    const transformed = new Vector3(...value)
      .sub(sourcePosition)
      .applyQuaternion(yawRotation)
      .add(destinationPosition);
    return vectorTuple(transformed);
  };

  const transformRotation = (value: QuaternionTuple): QuaternionTuple => {
    const transformed = yawRotation
      .clone()
      .multiply(new Quaternion(...value))
      .normalize();
    return [
      transformed.x,
      transformed.y,
      transformed.z,
      transformed.w,
    ];
  };

  const transformKinematics = (
    state: TransitionKinematicState,
  ): TransitionKinematicState => ({
    ...state,
    position: transformPosition(state.position),
    ...(state.yaw === undefined
      ? {}
      : { yaw: normalizeRadians(state.yaw + yawDelta) }),
    ...(state.rotation === undefined
      ? {}
      : { rotation: transformRotation(state.rotation) }),
    ...(state.linearVelocity === undefined
      ? {}
      : { linearVelocity: transformVector(state.linearVelocity) }),
    ...(state.angularVelocity === undefined
      ? {}
      : { angularVelocity: transformVector(state.angularVelocity) }),
  });

  return {
    source,
    destination,
    yawDelta,
    transformPosition,
    transformVector,
    transformYaw: (yaw) => normalizeRadians(yaw + yawDelta),
    transformRotation,
    transformKinematics,
  };
}

export function transformTransitionWorld(
  state: TransitionWorldState,
  transform: LandmarkTransform,
): TransitionWorldState {
  return {
    player: transform.transformKinematics(state.player),
    npcs: state.npcs.map((npc) => transform.transformKinematics(npc)),
    vehicles: state.vehicles.map((vehicle) => ({
      ...transform.transformKinematics(vehicle),
      occupants: vehicle.occupants?.map((occupant) =>
        transform.transformKinematics(occupant),
      ),
    })),
  };
}

/** Adapta directamente el bloque `motor` serializado por VehicleEntity. */
export function transformRigidBodyKinematics(
  state: SerializedRigidBodyKinematics,
  transform: LandmarkTransform,
): SerializedRigidBodyKinematics {
  return {
    position: transform.transformPosition([...state.position]),
    rotation: transform.transformRotation([...state.rotation]),
    linearVelocity: transform.transformVector([...state.linearVelocity]),
    angularVelocity: transform.transformVector([...state.angularVelocity]),
  };
}

/**
 * Resuelve el caso de gameplay: sin landmark de entrada conserva orientación y
 * momentum, pero usa `playerStart`, igual que las transiciones legacy.
 */
export function computeTransitionKinematics(
  state: TransitionKinematicState,
  exitLandmark: LandmarkReference | undefined,
  exitFallbackPosition: VectorTuple,
  entryLandmark: LandmarkReference | undefined,
  playerStart: VectorTuple,
): TransitionKinematicState {
  if (!entryLandmark) {
    return {
      ...cloneKinematics(state),
      position: cloneVector(playerStart),
    };
  }
  return createLandmarkTransform(
    exitLandmark ?? { position: exitFallbackPosition },
    entryLandmark,
  ).transformKinematics(state);
}

export function landmarkPosition(landmark: LandmarkReference): VectorTuple {
  return cloneVector(
    Array.isArray(landmark) ? landmark : landmark.position,
  );
}

function cloneKinematics(
  state: TransitionKinematicState,
): TransitionKinematicState {
  return {
    ...state,
    position: cloneVector(state.position),
    ...(state.yaw === undefined ? {} : { yaw: state.yaw }),
    ...(state.rotation === undefined
      ? {}
      : { rotation: [...state.rotation] }),
    ...(state.linearVelocity === undefined
      ? {}
      : { linearVelocity: cloneVector(state.linearVelocity) }),
    ...(state.angularVelocity === undefined
      ? {}
      : { angularVelocity: cloneVector(state.angularVelocity) }),
  };
}

function cloneVector(value: VectorTuple): VectorTuple {
  return [value[0], value[1], value[2]];
}

function vectorTuple(vector: Vector3): VectorTuple {
  return [vector.x, vector.y, vector.z];
}

function normalizeRadians(angle: number): number {
  return MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}
