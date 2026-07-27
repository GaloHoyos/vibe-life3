import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  captureRigidBodyState,
  copyRigidBodyState,
  createVehicleTelemetry,
  restoreRigidBodyState,
  type RigidBodyState,
  type VehicleControlInput,
  type VehicleMotor,
  type VehicleTelemetry,
  type VehicleWheelTelemetry,
} from "./VehicleMotor";

export interface RaycastWheelConfig {
  connection: Vector3;
  radius: number;
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  maxSuspensionForce: number;
  frictionSlip: number;
  sideFrictionStiffness: number;
  steering?: boolean;
  driven?: boolean;
  braking?: boolean;
  handbrake?: boolean;
}

export interface RaycastVehicleMotorConfig {
  wheels: readonly RaycastWheelConfig[];
  maxEngineForce: number;
  maxReverseForce: number;
  maxBrakeForce: number;
  maxHandbrakeForce: number;
  maxSteeringAngle: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  throttleResponse: number;
  steeringResponse: number;
  /** Fraction of the steering angle available at maximum speed. */
  highSpeedSteeringFactor: number;
  /** Speed above which opposite throttle brakes before changing direction. */
  directionChangeBrakeSpeed: number;
  boostMultiplier?: number;
  antiRollStiffness?: number;
  antiRollPairs?: readonly (readonly [number, number])[];
  wheelDirection?: Vector3;
  wheelAxle?: Vector3;
  filterFlags?: RAPIER.QueryFilterFlags;
  filterGroups?: RAPIER.InteractionGroups;
  filterPredicate?: (collider: RAPIER.Collider) => boolean;
}

const LOCAL_FORWARD = new Vector3(0, 0, 1);
const LOCAL_UP = new Vector3(0, 1, 0);
const DEFAULT_WHEEL_DIRECTION = new Vector3(0, -1, 0);
const DEFAULT_WHEEL_AXLE = new Vector3(1, 0, 0);
const RPM_IDLE = 700;
const RPM_MAX = 6500;

export class RaycastVehicleMotor implements VehicleMotor {
  readonly body: RAPIER.RigidBody;

  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly ownerWorld: RAPIER.World;
  private readonly telemetry: VehicleTelemetry;
  private control: VehicleControlInput = {
    throttle: 0,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
  };
  private smoothedThrottle = 0;
  private smoothedSteering = 0;
  private enabled = true;
  private disposed = false;

  private readonly rotation = new Quaternion();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly antiRollForce = new Vector3();

  constructor(
    physics: PhysicsWorld,
    body: RAPIER.RigidBody,
    private readonly config: RaycastVehicleMotorConfig,
  ) {
    if (!body.isDynamic()) {
      throw new Error("RaycastVehicleMotor requires a dynamic rigid body.");
    }
    if (config.wheels.length === 0) {
      throw new Error("RaycastVehicleMotor requires at least one wheel.");
    }

    this.body = body;
    this.ownerWorld = physics.world;
    this.controller = this.ownerWorld.createVehicleController(body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const direction = config.wheelDirection ?? DEFAULT_WHEEL_DIRECTION;
    const axle = config.wheelAxle ?? DEFAULT_WHEEL_AXLE;
    config.wheels.forEach((wheel, index) => {
      this.controller.addWheel(
        wheel.connection,
        direction,
        axle,
        wheel.suspensionRestLength,
        wheel.radius,
      );
      this.controller.setWheelMaxSuspensionTravel(
        index,
        Math.max(0, wheel.maxSuspensionTravel),
      );
      this.controller.setWheelSuspensionStiffness(
        index,
        Math.max(0, wheel.suspensionStiffness),
      );
      this.controller.setWheelSuspensionCompression(
        index,
        Math.max(0, wheel.suspensionCompression),
      );
      this.controller.setWheelSuspensionRelaxation(
        index,
        Math.max(0, wheel.suspensionRelaxation),
      );
      this.controller.setWheelMaxSuspensionForce(
        index,
        Math.max(0, wheel.maxSuspensionForce),
      );
      this.controller.setWheelFrictionSlip(
        index,
        Math.max(0, wheel.frictionSlip),
      );
      this.controller.setWheelSideFrictionStiffness(
        index,
        Math.max(0, wheel.sideFrictionStiffness),
      );
    });

    this.telemetry = createVehicleTelemetry(body);
    this.telemetry.wheels = config.wheels.map((_, index) =>
      emptyWheelTelemetry(index),
    );
    body.enableCcd(true);
    this.refreshTelemetry();
  }

  setControl(input: Readonly<VehicleControlInput>): void {
    this.control = {
      throttle: MathUtils.clamp(input.throttle, -1, 1),
      steering: MathUtils.clamp(input.steering, -1, 1),
      brake: MathUtils.clamp(input.brake, 0, 1),
      handbrake: MathUtils.clamp(input.handbrake, 0, 1),
      boost: input.boost,
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.smoothedThrottle = 0;
      this.smoothedSteering = 0;
      this.clearWheelForces();
    }
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  prePhysicsStep(delta: number): void {
    if (!this.isEnabled() || delta <= 0 || !this.body.isValid()) return;

    this.smoothedThrottle = damp(
      this.smoothedThrottle,
      this.control.throttle,
      this.config.throttleResponse,
      delta,
    );
    this.smoothedSteering = damp(
      this.smoothedSteering,
      this.control.steering,
      this.config.steeringResponse,
      delta,
    );

    const forwardSpeed = this.controller.currentVehicleSpeed();
    const speedRatio = MathUtils.clamp(
      Math.abs(forwardSpeed) / Math.max(this.config.maxForwardSpeed, 0.001),
      0,
      1,
    );
    const steeringFactor = MathUtils.lerp(
      1,
      MathUtils.clamp(this.config.highSpeedSteeringFactor, 0, 1),
      speedRatio,
    );
    const steering =
      this.smoothedSteering *
      this.config.maxSteeringAngle *
      steeringFactor;

    let throttle = this.smoothedThrottle;
    let directionBrake = 0;
    const changingDirection =
      Math.abs(forwardSpeed) > this.config.directionChangeBrakeSpeed &&
      Math.sign(forwardSpeed) !== Math.sign(throttle) &&
      Math.abs(throttle) > 0.01;
    if (changingDirection) {
      directionBrake = Math.abs(throttle);
      throttle = 0;
    }
    if (
      (forwardSpeed >= this.config.maxForwardSpeed && throttle > 0) ||
      (forwardSpeed <= -this.config.maxReverseSpeed && throttle < 0)
    ) {
      throttle = 0;
    }

    const boost = this.control.boost
      ? Math.max(1, this.config.boostMultiplier ?? 1)
      : 1;
    const engineForce =
      throttle >= 0
        ? throttle * this.config.maxEngineForce * boost
        : throttle * this.config.maxReverseForce;
    const serviceBrake =
      Math.max(this.control.brake, directionBrake) *
      this.config.maxBrakeForce;
    const handbrake =
      this.control.handbrake * this.config.maxHandbrakeForce;

    this.config.wheels.forEach((wheel, index) => {
      this.controller.setWheelSteering(index, wheel.steering ? steering : 0);
      this.controller.setWheelEngineForce(
        index,
        wheel.driven ? engineForce : 0,
      );
      const brake =
        (wheel.braking ? serviceBrake : 0) +
        (wheel.handbrake ? handbrake : 0);
      this.controller.setWheelBrake(index, brake);
    });

    this.controller.updateVehicle(
      delta,
      this.config.filterFlags,
      this.config.filterGroups,
      this.config.filterPredicate,
    );
    this.applyAntiRoll();
  }

  postPhysicsStep(_delta: number): void {
    if (this.disposed || !this.body.isValid()) return;
    this.refreshTelemetry();
  }

  getTelemetry(): Readonly<VehicleTelemetry> {
    return this.telemetry;
  }

  captureState(): RigidBodyState {
    return captureRigidBodyState(this.body);
  }

  restoreState(state: Readonly<RigidBodyState>): void {
    restoreRigidBodyState(this.body, state);
    this.refreshTelemetry();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    if (this.ownerWorld.vehicleControllers.has(this.controller)) {
      this.ownerWorld.removeVehicleController(this.controller);
    }
  }

  private clearWheelForces(): void {
    for (let i = 0; i < this.config.wheels.length; i += 1) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
  }

  private applyAntiRoll(): void {
    const stiffness = this.config.antiRollStiffness ?? 0;
    if (stiffness <= 0) return;

    const rotation = this.body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.up.copy(LOCAL_UP).applyQuaternion(this.rotation);

    for (const [leftIndex, rightIndex] of this.config.antiRollPairs ?? []) {
      const leftLength = this.controller.wheelSuspensionLength(leftIndex);
      const rightLength = this.controller.wheelSuspensionLength(rightIndex);
      if (leftLength === null || rightLength === null) continue;
      const leftConfig = this.config.wheels[leftIndex];
      const rightConfig = this.config.wheels[rightIndex];
      if (!leftConfig || !rightConfig) continue;

      const leftTravel = leftConfig.suspensionRestLength - leftLength;
      const rightTravel = rightConfig.suspensionRestLength - rightLength;
      const force = (leftTravel - rightTravel) * stiffness;

      const leftPoint = this.controller.wheelHardPoint(leftIndex);
      const rightPoint = this.controller.wheelHardPoint(rightIndex);
      if (leftPoint && this.controller.wheelIsInContact(leftIndex)) {
        this.antiRollForce.copy(this.up).multiplyScalar(-force);
        this.body.addForceAtPoint(this.antiRollForce, leftPoint, true);
      }
      if (rightPoint && this.controller.wheelIsInContact(rightIndex)) {
        this.antiRollForce.copy(this.up).multiplyScalar(force);
        this.body.addForceAtPoint(this.antiRollForce, rightPoint, true);
      }
    }
  }

  private refreshTelemetry(): void {
    copyRigidBodyState(this.telemetry.state, this.body);
    const velocity = this.body.linvel();
    this.telemetry.speed = Math.hypot(velocity.x, velocity.y, velocity.z);

    const rotation = this.body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.rotation);
    this.telemetry.forwardSpeed =
      velocity.x * this.forward.x +
      velocity.y * this.forward.y +
      velocity.z * this.forward.z;
    this.telemetry.steering = this.smoothedSteering;

    let contactCount = 0;
    let drivenRadius = 0;
    let drivenCount = 0;
    const wheels = this.telemetry.wheels as VehicleWheelTelemetry[];
    this.config.wheels.forEach((wheel, index) => {
      const wheelTelemetry = wheels[index];
      const contactPoint = this.controller.wheelContactPoint(index);
      const contactNormal = this.controller.wheelContactNormal(index);
      wheelTelemetry.inContact = this.controller.wheelIsInContact(index);
      wheelTelemetry.suspensionLength =
        this.controller.wheelSuspensionLength(index) ??
        wheel.suspensionRestLength;
      wheelTelemetry.rotation = this.controller.wheelRotation(index) ?? 0;
      wheelTelemetry.steering =
        this.controller.wheelSteering(index) ?? 0;
      wheelTelemetry.engineForce =
        this.controller.wheelEngineForce(index) ?? 0;
      wheelTelemetry.brake = this.controller.wheelBrake(index) ?? 0;
      wheelTelemetry.contactPoint = copyOptionalVector(
        wheelTelemetry.contactPoint,
        contactPoint,
      );
      wheelTelemetry.contactNormal = copyOptionalVector(
        wheelTelemetry.contactNormal,
        contactNormal,
      );
      if (wheelTelemetry.inContact) contactCount += 1;
      if (wheel.driven) {
        drivenRadius += wheel.radius;
        drivenCount += 1;
      }
    });

    const averageRadius =
      drivenCount > 0 ? drivenRadius / drivenCount : this.config.wheels[0].radius;
    const wheelRpm =
      (Math.abs(this.telemetry.forwardSpeed) /
        Math.max(averageRadius, 0.001)) *
      (60 / (Math.PI * 2));
    const throttleRpm =
      Math.abs(this.smoothedThrottle) * (RPM_MAX - RPM_IDLE) * 0.35;
    this.telemetry.engineRpm = MathUtils.clamp(
      RPM_IDLE + wheelRpm * 4 + throttleRpm,
      RPM_IDLE,
      RPM_MAX,
    );
    this.telemetry.contactCount = contactCount;
    this.telemetry.grounded = contactCount > 0;
    this.telemetry.submergedRatio = 0;
  }
}

function emptyWheelTelemetry(index: number): VehicleWheelTelemetry {
  return {
    index,
    inContact: false,
    suspensionLength: 0,
    rotation: 0,
    steering: 0,
    engineForce: 0,
    brake: 0,
    contactPoint: null,
    contactNormal: null,
  };
}

function copyOptionalVector(
  target: Vector3 | null,
  source: RAPIER.Vector | null,
): Vector3 | null {
  if (!source) return null;
  return (target ?? new Vector3()).set(source.x, source.y, source.z);
}

function damp(current: number, target: number, response: number, delta: number): number {
  if (response <= 0) return target;
  return MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
}
