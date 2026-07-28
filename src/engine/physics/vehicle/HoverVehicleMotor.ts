import type RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import {
  captureRigidBodyState,
  copyRigidBodyState,
  createVehicleTelemetry,
  restoreRigidBodyState,
  type RigidBodyState,
  type VehicleControlInput,
  type VehicleMotor,
  type VehicleSurfaceProvider,
  type VehicleTelemetry,
} from "./VehicleMotor";

export interface HoverProbeConfig {
  position: Vector3;
  buoyancyStiffness: number;
  buoyancyDamping: number;
  maxBuoyancyForce: number;
}

export interface HoverVehicleMotorConfig {
  surfaceProvider: VehicleSurfaceProvider;
  probes: readonly HoverProbeConfig[];
  maxSubmersionDepth: number;
  maxForwardThrust: number;
  maxReverseThrust: number;
  maxSteeringTorque: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  forwardDrag: number;
  lateralDrag: number;
  verticalDrag: number;
  angularDrag: number;
  planingLift: number;
  maxPlaningLift: number;
  landThrustFactor: number;
  throttleResponse: number;
  steeringResponse: number;
  boostMultiplier?: number;
  /**
   * Maximum thrust deflection at full rudder, in radians. An airboat steers by
   * aiming its propeller, so the same push that moves it is what turns it.
   */
  rudderAngle?: number;
  /** Where thrust is applied, in body space. Behind the centre of mass. */
  thrustPoint?: Vector3;
  /** Extra drag while the water brake is held, as a multiple of the normal. */
  waterBrakeDrag?: number;
  /** Linear drag from the hull scraping while out of the water. */
  landDrag?: number;
  /** Centre of lateral resistance, in body space. Aft of the centre of mass. */
  lateralDragPoint?: Vector3;
}

const LOCAL_FORWARD = new Vector3(0, 0, 1);
const LOCAL_RIGHT = new Vector3(1, 0, 0);
const LOCAL_UP = new Vector3(0, 1, 0);

/**
 * Floating-hull motor. Probes apply forces at their actual positions so the
 * solver produces pitch and roll naturally. Outside a fluid it retains
 * reduced propulsion for beach recovery, but never assumes implicit water.
 */
export class HoverVehicleMotor implements VehicleMotor {
  readonly body: RAPIER.RigidBody;

  private readonly telemetry: VehicleTelemetry;
  private control: VehicleControlInput = {
    throttle: 0,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
  };
  private enabled = true;
  private disposed = false;
  private smoothedThrottle = 0;
  private smoothedSteering = 0;

  private readonly rotation = new Quaternion();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly bodyPosition = new Vector3();
  private readonly probePoint = new Vector3();
  private readonly relativePoint = new Vector3();
  private readonly pointVelocity = new Vector3();
  private readonly relativeVelocity = new Vector3();
  private readonly surfaceVelocity = new Vector3();
  private readonly averageSurfaceVelocity = new Vector3();
  private readonly averageNormal = new Vector3();
  private readonly force = new Vector3();
  private readonly torque = new Vector3();
  private readonly thrustDirection = new Vector3();
  private readonly thrustOrigin = new Vector3();
  private readonly centerOfMass = new Vector3();
  private contactCount = 0;
  private submersion = 0;

  constructor(
    body: RAPIER.RigidBody,
    private readonly config: HoverVehicleMotorConfig,
  ) {
    if (!body.isDynamic()) {
      throw new Error("HoverVehicleMotor requires a dynamic rigid body.");
    }
    if (config.probes.length === 0) {
      throw new Error("HoverVehicleMotor requires at least one probe.");
    }
    this.body = body;
    this.telemetry = createVehicleTelemetry(body);
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
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      this.smoothedThrottle = 0;
      this.smoothedSteering = 0;
    }
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  prePhysicsStep(delta: number): void {
    if (this.disposed || !this.body.isValid()) return;
    // Rapier ACUMULA las fuerzas de usuario entre steps hasta que se resetean.
    // Sin esto la flotación de cada frame se suma a la anterior y el casco sale
    // disparado hacia arriba aunque ya no toque el agua.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    if (!this.isEnabled() || delta <= 0) return;

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

    const bodyRotation = this.body.rotation();
    this.rotation.set(
      bodyRotation.x,
      bodyRotation.y,
      bodyRotation.z,
      bodyRotation.w,
    );
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.rotation).normalize();
    this.right.copy(LOCAL_RIGHT).applyQuaternion(this.rotation).normalize();

    const translation = this.body.translation();
    this.bodyPosition.set(translation.x, translation.y, translation.z);
    const linearVelocity = this.body.linvel();
    const angularVelocity = this.body.angvel();
    const worldCom = this.body.worldCom();
    this.centerOfMass.set(worldCom.x, worldCom.y, worldCom.z);
    this.averageSurfaceVelocity.set(0, 0, 0);
    this.averageNormal.set(0, 0, 0);
    this.contactCount = 0;
    this.submersion = 0;

    for (const probe of this.config.probes) {
      this.probePoint
        .copy(probe.position)
        .applyQuaternion(this.rotation)
        .add(this.bodyPosition);
      const sample = this.config.surfaceProvider.sampleSurface(
        this.probePoint,
        this.config.maxSubmersionDepth,
      );
      if (!sample || sample.kind !== "fluid") continue;

      const depth = this.force
        .copy(sample.point)
        .sub(this.probePoint)
        .dot(sample.normal);
      if (depth <= 0 || depth > this.config.maxSubmersionDepth) continue;

      this.relativePoint.copy(this.probePoint).sub(this.centerOfMass);
      this.pointVelocity
        .set(angularVelocity.x, angularVelocity.y, angularVelocity.z)
        .cross(this.relativePoint)
        .add(
          this.relativeVelocity.set(
            linearVelocity.x,
            linearVelocity.y,
            linearVelocity.z,
          ),
        );
      this.surfaceVelocity.copy(sample.velocity);
      const normalVelocity = this.pointVelocity
        .sub(this.surfaceVelocity)
        .dot(sample.normal);
      const buoyancy = MathUtils.clamp(
        (depth * probe.buoyancyStiffness -
          normalVelocity * probe.buoyancyDamping) *
          Math.max(0, sample.density),
        0,
        probe.maxBuoyancyForce,
      );
      this.force.copy(sample.normal).multiplyScalar(buoyancy);
      this.body.addForceAtPoint(this.force, this.probePoint, true);

      this.averageSurfaceVelocity.add(sample.velocity);
      this.averageNormal.add(sample.normal);
      this.contactCount += 1;
      this.submersion += MathUtils.clamp(
        depth / this.config.maxSubmersionDepth,
        0,
        1,
      );
    }

    this.applyPropulsionAndDrag();
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
    this.disposed = true;
    this.enabled = false;
  }

  private applyPropulsionAndDrag(): void {
    const velocity = this.body.linvel();
    this.relativeVelocity.set(velocity.x, velocity.y, velocity.z);
    const contactRatio = this.contactCount / this.config.probes.length;
    if (this.contactCount > 0) {
      this.averageSurfaceVelocity.divideScalar(this.contactCount);
      this.averageNormal.normalize();
      this.relativeVelocity.sub(this.averageSurfaceVelocity);
    } else {
      this.averageSurfaceVelocity.set(0, 0, 0);
      this.averageNormal.copy(LOCAL_UP);
    }

    const forwardSpeed = this.relativeVelocity.dot(this.forward);
    const rightSpeed = this.relativeVelocity.dot(this.right);
    const verticalSpeed = this.relativeVelocity.dot(this.averageNormal);
    const waterFactor =
      this.contactCount > 0
        ? MathUtils.clamp(contactRatio * 1.5, 0.2, 1)
        : MathUtils.clamp(this.config.landThrustFactor, 0, 1);

    let throttle = this.smoothedThrottle;
    if (
      (forwardSpeed >= this.config.maxForwardSpeed && throttle > 0) ||
      (forwardSpeed <= -this.config.maxReverseSpeed && throttle < 0)
    ) {
      throttle = 0;
    }
    const boost = this.control.boost
      ? Math.max(1, this.config.boostMultiplier ?? 1)
      : 1;
    const thrust =
      (throttle >= 0
        ? throttle * this.config.maxForwardThrust * boost
        : throttle * this.config.maxReverseThrust) * waterFactor;

    // Empuje vectorizado: la hélice apunta a donde manda el timón. Como entra
    // por popa, el empuje se desvía hacia el MISMO lado del que se aparta la
    // proa: mandar la cola a +X hace que el morro caiga a -X, o sea a estribor.
    const rudder = this.smoothedSteering * (this.config.rudderAngle ?? 0);
    this.thrustDirection.copy(this.forward);
    if (rudder !== 0) {
      this.thrustDirection.applyAxisAngle(this.averageNormal, rudder);
    }
    this.force.copy(this.thrustDirection).multiplyScalar(thrust);
    const thrustPoint = this.config.thrustPoint;
    if (thrustPoint) {
      this.thrustOrigin
        .copy(thrustPoint)
        .applyQuaternion(this.rotation)
        .add(this.bodyPosition);
      this.body.addForceAtPoint(this.force, this.thrustOrigin, true);
    } else {
      this.body.addForce(this.force, true);
    }

    if (this.contactCount > 0) {
      // Un casco de hidrodeslizador no tiene quilla: el freno de agua es la
      // única forma de raspar velocidad, y aun así derrapa.
      const waterBrake =
        Math.max(this.control.brake, this.control.handbrake) *
        (this.config.waterBrakeDrag ?? 0);
      this.force
        .copy(this.forward)
        .multiplyScalar(-forwardSpeed * this.config.forwardDrag * (1 + waterBrake))
        .addScaledVector(
          this.averageNormal,
          -verticalSpeed * this.config.verticalDrag,
        );
      this.body.addForce(this.force, true);

      // La resistencia lateral se aplica por DETRÁS del centro de masa: así el
      // casco se orienta solo hacia donde viaja en vez de trompear, igual que
      // las plumas de una flecha. Aplicada por delante haría lo contrario.
      this.force
        .copy(this.right)
        .multiplyScalar(-rightSpeed * this.config.lateralDrag * (1 + waterBrake));
      const dragPoint = this.config.lateralDragPoint;
      if (dragPoint) {
        this.thrustOrigin
          .copy(dragPoint)
          .applyQuaternion(this.rotation)
          .add(this.bodyPosition);
        this.body.addForceAtPoint(this.force, this.thrustOrigin, true);
      } else {
        this.body.addForce(this.force, true);
      }

      const planingSpeed = Math.max(0, forwardSpeed);
      const lift = Math.min(
        planingSpeed * planingSpeed * this.config.planingLift * contactRatio,
        this.config.maxPlaningLift,
      );
      this.body.addForce(
        this.force.copy(this.averageNormal).multiplyScalar(lift),
        true,
      );
    } else if ((this.config.landDrag ?? 0) > 0) {
      // Fuera del agua el casco raspa: sin esto el hidrodeslizador patina por
      // tierra indefinidamente porque nada se opone a su inercia.
      this.body.addForce(
        this.force
          .copy(this.relativeVelocity)
          .multiplyScalar(-(this.config.landDrag ?? 0)),
        true,
      );
    }

    const steeringAuthority = MathUtils.clamp(
      Math.max(
        Math.abs(this.smoothedThrottle) * 0.35,
        Math.abs(forwardSpeed) / Math.max(this.config.maxForwardSpeed, 0.001),
      ),
      0,
      1,
    );
    // Guiñada negativa = proa hacia -X = estribor, la derecha del proyecto.
    this.torque
      .copy(this.averageNormal)
      .multiplyScalar(
        -this.smoothedSteering *
          this.config.maxSteeringTorque *
          steeringAuthority *
          waterFactor,
      );
    const angularVelocity = this.body.angvel();
    const yawRate =
      angularVelocity.x * this.averageNormal.x +
      angularVelocity.y * this.averageNormal.y +
      angularVelocity.z * this.averageNormal.z;
    this.torque.addScaledVector(
      this.averageNormal,
      -yawRate * this.config.angularDrag * contactRatio,
    );
    this.body.addTorque(this.torque, true);
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
    const speedRatio = MathUtils.clamp(
      Math.abs(this.telemetry.forwardSpeed) /
        Math.max(this.config.maxForwardSpeed, 0.001),
      0,
      1,
    );
    this.telemetry.engineRpm = MathUtils.lerp(
      650,
      6000,
      Math.max(speedRatio, Math.abs(this.smoothedThrottle) * 0.45),
    );
    this.telemetry.steering = this.smoothedSteering;
    this.telemetry.contactCount = this.contactCount;
    this.telemetry.grounded = this.contactCount > 0;
    this.telemetry.submergedRatio =
      this.contactCount > 0
        ? this.submersion / this.config.probes.length
        : 0;
  }
}

function damp(current: number, target: number, response: number, delta: number): number {
  if (response <= 0) return target;
  return MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
}
