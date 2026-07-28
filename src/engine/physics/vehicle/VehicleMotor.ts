import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { Disposable } from "@shared/types/lifecycle";

/**
 * Normalized controls independent of the input device. The game layer maps
 * keyboard, player, or AI intent into this contract.
 */
export interface VehicleControlInput {
  /** -1 = reverse, 0 = neutral, 1 = full forward throttle. */
  throttle: number;
  /**
   * -1 = left, 0 = centered, 1 = right.
   *
   * "Right" is the project's right: `forward × up`, which with +Z forward and
   * +Y up is **-X**, not +X. Turning right therefore *decreases*
   * `atan2(forward.x, forward.z)`. Cada sitio que traducía esto por su cuenta
   * lo tenía al revés, así que la convención se verifica en
   * `tests/unit/game/gameplay/vehicles/VehicleSteering.test.ts`.
   */
  steering: number;
  /** Service brake in the 0..1 range. */
  brake: number;
  /** Analog handbrake in the 0..1 range. */
  handbrake: number;
  /** Requests the boosted force variant defined by the preset. */
  boost: boolean;
}

export const NEUTRAL_VEHICLE_CONTROL: Readonly<VehicleControlInput> = Object.freeze({
  throttle: 0,
  steering: 0,
  brake: 0,
  handbrake: 0,
  boost: false,
});

export interface RigidBodyState {
  position: Vector3;
  rotation: Quaternion;
  linearVelocity: Vector3;
  angularVelocity: Vector3;
}

export type VehicleSurfaceKind = "solid" | "fluid";

export interface VehicleSurfaceSample {
  /** A point on the surface in world space. */
  point: Vector3;
  /** Unit surface normal in world space. */
  normal: Vector3;
  /** Surface velocity for currents and moving platforms. */
  velocity: Vector3;
  kind: VehicleSurfaceKind;
  /** Relative density, where 1 represents water. */
  density: number;
}

/** Neutral surface query backed by water volumes, terrain, or colliders. */
export interface VehicleSurfaceProvider {
  sampleSurface(
    probePosition: Readonly<Vector3>,
    maxDistance: number,
  ): VehicleSurfaceSample | null;
}

export interface VehicleWheelTelemetry {
  index: number;
  inContact: boolean;
  suspensionLength: number;
  rotation: number;
  steering: number;
  engineForce: number;
  brake: number;
  contactPoint: Vector3 | null;
  contactNormal: Vector3 | null;
}

export interface VehicleTelemetry {
  state: RigidBodyState;
  /** Linear speed magnitude in m/s. */
  speed: number;
  /** Signed velocity along the vehicle's local +Z axis. */
  forwardSpeed: number;
  /** Approximate value for animation/audio, not a gearbox simulation. */
  engineRpm: number;
  steering: number;
  contactCount: number;
  grounded: boolean;
  submergedRatio: number;
  wheels: readonly VehicleWheelTelemetry[];
}

/**
 * Vehicle locomotion contract. Motors don't own the rigid body; the entity
 * that created the body remains responsible for removing it.
 */
export interface VehicleMotor extends Disposable {
  readonly body: RAPIER.RigidBody;
  setControl(input: Readonly<VehicleControlInput>): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  prePhysicsStep(delta: number): void;
  postPhysicsStep(delta: number): void;
  getTelemetry(): Readonly<VehicleTelemetry>;
  captureState(): RigidBodyState;
  restoreState(state: Readonly<RigidBodyState>): void;
}

export function captureRigidBodyState(body: RAPIER.RigidBody): RigidBodyState {
  const position = body.translation();
  const rotation = body.rotation();
  const linearVelocity = body.linvel();
  const angularVelocity = body.angvel();
  return {
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    linearVelocity: new Vector3(
      linearVelocity.x,
      linearVelocity.y,
      linearVelocity.z,
    ),
    angularVelocity: new Vector3(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    ),
  };
}

export function restoreRigidBodyState(
  body: RAPIER.RigidBody,
  state: Readonly<RigidBodyState>,
): void {
  body.setTranslation(state.position, true);
  body.setRotation(state.rotation, true);
  body.setLinvel(state.linearVelocity, true);
  body.setAngvel(state.angularVelocity, true);
  if (body.isKinematic()) {
    body.setNextKinematicTranslation(state.position);
    body.setNextKinematicRotation(state.rotation);
  }
}

export function createVehicleTelemetry(body: RAPIER.RigidBody): VehicleTelemetry {
  return {
    state: captureRigidBodyState(body),
    speed: 0,
    forwardSpeed: 0,
    engineRpm: 0,
    steering: 0,
    contactCount: 0,
    grounded: false,
    submergedRatio: 0,
    wheels: [],
  };
}

export function copyRigidBodyState(
  target: RigidBodyState,
  body: RAPIER.RigidBody,
): void {
  const position = body.translation();
  const rotation = body.rotation();
  const linearVelocity = body.linvel();
  const angularVelocity = body.angvel();
  target.position.set(position.x, position.y, position.z);
  target.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
  target.linearVelocity.set(
    linearVelocity.x,
    linearVelocity.y,
    linearVelocity.z,
  );
  target.angularVelocity.set(
    angularVelocity.x,
    angularVelocity.y,
    angularVelocity.z,
  );
}
