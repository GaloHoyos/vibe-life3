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
  /** Steering lock at or below `steeringSpeedSlow` (Source's `degreesSlow`). */
  maxSteeringAngle: number;
  /** Steering lock at or above `steeringSpeedFast` (Source's `degreesFast`). */
  fastSteeringAngle: number;
  /**
   * Speeds bracketing the steering fade, in m/s (Source's `slowcarspeed` and
   * `fastcarspeed`). The band is narrow and low on purpose: the contrast
   * between a car that pivots when parking and one that stays planted on a
   * straight is most of what a vehicle feels like.
   */
  steeringSpeedSlow: number;
  steeringSpeedFast: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  /** Speed above which opposite throttle brakes before changing direction. */
  directionChangeBrakeSpeed: number;
  boostMultiplier?: number;
  /** Brake impulse applied while coasting, standing in for engine drag. */
  autoBrakeForce?: number;
  /**
   * Steering response curve. The driver input stays linear and is raised to
   * this power, so small corrections at speed stay gentle (Source's
   * `steeringExponent`).
   */
  steeringExponent?: number;
  /** Side grip left on the handbrake wheels while it is pulled, 0..1. */
  handbrakeSideFrictionFactor?: number;
  /** Extra downward gravity as a multiple of the standard one. */
  extraGravity?: number;
  /** Hard ceiling on angular speed, in rad/s. */
  maxAngularVelocity?: number;
  /** Torque that rights the chassis while airborne, in N·m per radian. */
  uprightTorque?: number;
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
// El eje de rueda fija hacia dónde empuja la fuerza motriz: con +X el vehículo
// avanzaba hacia -Z, contra la convención del proyecto (+Z es adelante, y así
// están modelados el morro, los faros y el ancla de cámara).
const DEFAULT_WHEEL_AXLE = new Vector3(-1, 0, 0);
const RPM_IDLE = 700;
const RPM_MAX = 6500;
const WORLD_DOWN = new Vector3(0, -1, 0);
const GRAVITY = 20.5;
/**
 * Rapier only consults `wheel.brake` when `engine_force` is EXACTLY zero
 * (`if wheel.engine_force != 0.0 { ... } else { max_impulse = brake }`).
 * A throttle that decays exponentially never reaches zero, so anything below
 * this has to be snapped to it or the brakes are dead for good.
 */
const ENGINE_FORCE_EPSILON = 1;

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
  private appliedThrottle = 0;
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
      this.appliedThrottle = 0;
      this.clearWheelForces();
    }
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  prePhysicsStep(delta: number): void {
    if (this.disposed || !this.body.isValid()) return;
    // Rapier ACUMULA las fuerzas de usuario entre steps hasta que se resetean
    // (a diferencia de Bullet/PhysX, que las limpian solas). Sin esto la barra
    // estabilizadora suma su fuerza frame tras frame y termina disparando el
    // chasis. Se resetea incluso deshabilitado: si no, lo último que se aplicó
    // queda empujando para siempre.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    if (!this.isEnabled() || delta <= 0) return;

    // Pisar el freno cierra la mariposa: mantener acelerador y freno a la vez
    // dejaría el motor empujando contra el freno durante casi un segundo.
    //
    // Acelerador y volante entran SIN suavizar. Quien conduce ya trae su propia
    // rampa —`VehicleDriverInputModel` para el jugador, `VehicleControlSmoother`
    // para la IA—, así que filtrar acá otra vez sólo agregaba retardo encima de
    // una señal que ya estaba bien formada. El motor es la máquina, no el pie.
    this.appliedThrottle =
      this.control.brake > 0 || this.control.handbrake > 0
        ? 0
        : this.control.throttle;

    const forwardSpeed = this.controller.currentVehicleSpeed();
    // Giro de morro por velocidad, con la banda explícita de Source
    // (`slowcarspeed`/`fastcarspeed`) en vez de una fracción de la punta: una
    // curva referida a la velocidad máxima nunca llega a cerrarse de verdad.
    const steeringAngle = remap(
      Math.abs(forwardSpeed),
      this.config.steeringSpeedSlow,
      this.config.steeringSpeedFast,
      this.config.maxSteeringAngle,
      this.config.fastSteeringAngle,
    );
    // `steering > 0` es a la derecha, y la derecha del proyecto es `forward ×
    // up` = -X con +Z adelante. El signo también va atado a
    // DEFAULT_WHEEL_AXLE: con el eje en -X, Rapier lee el ángulo al revés.
    const steering =
      -curve(this.control.steering, this.config.steeringExponent ?? 1) *
      steeringAngle;

    let throttle = this.appliedThrottle;
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
    const rawEngineForce =
      throttle >= 0
        ? throttle * this.config.maxEngineForce * boost
        : throttle * this.config.maxReverseForce;
    // Ver ENGINE_FORCE_EPSILON: sin este corte el freno nunca llega a aplicarse.
    const engineForce =
      Math.abs(rawEngineForce) < ENGINE_FORCE_EPSILON ? 0 : rawEngineForce;
    const brakeInput = Math.max(this.control.brake, directionBrake);
    const serviceBrake = brakeInput * this.config.maxBrakeForce;
    const handbrake =
      this.control.handbrake * this.config.maxHandbrakeForce;
    // Freno motor: sin él la inercia lleva el chasis cientos de metros porque
    // Rapier no modela resistencia a la rodadura.
    const autoBrake =
      engineForce === 0 && brakeInput <= 0 && this.control.handbrake <= 0
        ? (this.config.autoBrakeForce ?? 0)
        : 0;
    const sideFrictionFactor = MathUtils.lerp(
      1,
      MathUtils.clamp(this.config.handbrakeSideFrictionFactor ?? 1, 0, 1),
      this.control.handbrake,
    );

    this.config.wheels.forEach((wheel, index) => {
      this.controller.setWheelSteering(index, wheel.steering ? steering : 0);
      this.controller.setWheelEngineForce(
        index,
        wheel.driven ? engineForce : 0,
      );
      const brake =
        (wheel.braking ? serviceBrake : 0) +
        (wheel.handbrake ? handbrake : 0) +
        autoBrake;
      this.controller.setWheelBrake(index, brake);
      // El tren de mano pierde agarre lateral: es lo que convierte el freno de
      // mano en un derrape en vez de en un ancla.
      this.controller.setWheelSideFrictionStiffness(
        index,
        wheel.sideFrictionStiffness *
          (wheel.handbrake ? sideFrictionFactor : 1),
      );
    });

    this.applyChassisForces(delta);
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

  /**
   * Chassis aids from the Source vehicle body block: extra gravity to keep the
   * car planted, an angular speed ceiling so one bad landing can't spin it up,
   * and a righting torque while airborne (`addGravity`, `maxAngularVelocity`
   * and `keepUprightTorque`).
   */
  private applyChassisForces(delta: number): void {
    const rotation = this.body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.up.copy(LOCAL_UP).applyQuaternion(this.rotation);

    const extraGravity = this.config.extraGravity ?? 0;
    if (extraGravity > 0) {
      this.body.addForce(
        this.antiRollForce
          .copy(WORLD_DOWN)
          .multiplyScalar(this.body.mass() * GRAVITY * extraGravity),
        true,
      );
    }

    const maxAngular = this.config.maxAngularVelocity ?? 0;
    if (maxAngular > 0) {
      const angular = this.body.angvel();
      const magnitude = Math.hypot(angular.x, angular.y, angular.z);
      if (magnitude > maxAngular) {
        const scale = maxAngular / magnitude;
        this.body.setAngvel(
          {
            x: angular.x * scale,
            y: angular.y * scale,
            z: angular.z * scale,
          },
          true,
        );
      }
    }

    const uprightTorque = this.config.uprightTorque ?? 0;
    // Con ruedas apoyadas manda la suspensión; asistir ahí haría que el chasis
    // se "pegue" al piso de forma antinatural en rampas y peraltes.
    if (uprightTorque > 0 && this.telemetry.contactCount === 0 && delta > 0) {
      const tilt = this.up.angleTo(LOCAL_UP);
      if (tilt > 0.02) {
        this.antiRollForce
          .crossVectors(this.up, LOCAL_UP)
          .normalize()
          .multiplyScalar(tilt * uprightTorque);
        this.body.addTorque(this.antiRollForce, true);
      }
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

      // Compresión, no longitud: la barra debe LEVANTAR el lado hundido y
      // BAJAR el que se despega. Con los signos al revés cualquier asimetría se
      // realimenta, el buggy se sube a dos ruedas y termina volando.
      const leftCompression = leftConfig.suspensionRestLength - leftLength;
      const rightCompression = rightConfig.suspensionRestLength - rightLength;
      const force = (leftCompression - rightCompression) * stiffness;

      const leftPoint = this.controller.wheelHardPoint(leftIndex);
      const rightPoint = this.controller.wheelHardPoint(rightIndex);
      if (leftPoint && this.controller.wheelIsInContact(leftIndex)) {
        this.antiRollForce.copy(this.up).multiplyScalar(force);
        this.body.addForceAtPoint(this.antiRollForce, leftPoint, true);
      }
      if (rightPoint && this.controller.wheelIsInContact(rightIndex)) {
        this.antiRollForce.copy(this.up).multiplyScalar(-force);
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
    this.telemetry.steering = this.control.steering;

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
      Math.abs(this.appliedThrottle) * (RPM_MAX - RPM_IDLE) * 0.35;
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

function remap(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number {
  if (fromHigh <= fromLow) return toLow;
  return MathUtils.lerp(
    toLow,
    toHigh,
    MathUtils.clamp((value - fromLow) / (fromHigh - fromLow), 0, 1),
  );
}

function curve(value: number, exponent: number): number {
  if (exponent === 1) return value;
  return Math.sign(value) * Math.abs(value) ** exponent;
}
