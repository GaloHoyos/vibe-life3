import type RAPIER from "@dimforge/rapier3d-compat";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
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

export interface RotorcraftVehicleMotorConfig {
  mass: number;
  gravity: number;
  /**
   * Fracción del peso que sostiene el rotor con el colectivo en neutro. Por
   * debajo de 1 el aparato desciende suave al soltar los mandos, que es lo que
   * hace que la altitud se sienta pilotada en vez de automática.
   */
  hoverLift: number;
  /** Empuje a colectivo lleno, como múltiplo del peso. */
  maxLift: number;
  /** Empuje con el colectivo abajo del todo, como múltiplo del peso. */
  minLift: number;
  /** Con qué rapidez el rotor alcanza el empuje pedido, en 1/s. */
  liftResponse: number;
  /** Inclinación máxima que puede pedir el cíclico, en radianes. */
  maxPitch: number;
  maxRoll: number;
  /** Con qué rapidez el aparato adopta la actitud pedida, en 1/s. */
  attitudeResponse: number;
  /** Par de actitud por radián de error, relativo a la masa. */
  attitudeStiffness: number;
  /** Amortiguación angular de ese par, también relativa a la masa. */
  attitudeDamping: number;
  /** Guiñada a pedal lleno, en rad/s. */
  yawRate: number;
  /**
   * Guiñada que induce el alabeo, en rad/s a alabeo lleno. Es lo que convierte
   * un simple ladeo en un viraje sin tocar los pedales.
   */
  turnCoordination: number;
  /** Arrastres como tasa por segundo; el motor los multiplica por la masa. */
  linearDrag: number;
  verticalDrag: number;
  /** Arrastre extra con el tren apoyado, para que no patine por la pista. */
  groundDrag: number;
  /**
   * Altura del punto más bajo del casco SOBRE el origen del cuerpo. Como el
   * origen queda por debajo de ese punto, al posarse termina enterrado, y una
   * sonda lanzada desde ahí saldría por debajo del terreno sin tocar nada.
   */
  hullBottom: number;
  surfaceProvider?: VehicleSurfaceProvider;
  /** Alcance de la sonda de altura. Más allá el aparato se considera en vuelo. */
  probeDistance?: number;
}

const WORLD_UP = new Vector3(0, 1, 0);
const LOCAL_UP = new Vector3(0, 1, 0);
const LOCAL_FORWARD = new Vector3(0, 0, 1);
const GROUNDED_ALTITUDE = 0.12;
/** Margen con el que la sonda arranca por encima del casco apoyado. */
const PROBE_LIFT = 0.5;
/**
 * Piso del coseno de inclinación con el que se compensa el empuje. Sin él, un
 * ladeo extremo pediría empuje infinito para sostener la altura.
 */
const MIN_TILT_COMPENSATION = 0.35;
const IDLE_RPM = 2_600;
const MAX_RPM = 6_500;

/**
 * Vuelo libre híbrido: el cíclico pide una actitud y un PD la sostiene, así que
 * el aparato nunca se vuelca ni entra en pérdida, pero el empuje sale del eje
 * vertical LOCAL, con lo cual inclinarse es la única forma de trasladarse y la
 * inercia se siente entera. La altitud queda en manos del piloto.
 *
 * No hay referencia en Source: Valve nunca dio un helicóptero pilotable, y su
 * `npc_helicopter` vuela sobre un `CAI_TrackPather`, que es justamente lo que
 * hace el otro preset.
 */
export class RotorcraftVehicleMotor implements VehicleMotor {
  readonly body: RAPIER.RigidBody;

  private enabled = true;
  private disposed = false;
  private pitch = 0;
  private roll = 0;
  private heading = 0;
  private lift: number;
  private grounded = false;
  private altitude = Number.POSITIVE_INFINITY;
  private control: VehicleControlInput = {
    throttle: 0,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
    collective: 0,
    yaw: 0,
  };
  private readonly telemetry: VehicleTelemetry;

  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly velocity = new Vector3();
  private readonly angularVelocity = new Vector3();
  private readonly up = new Vector3();
  private readonly forward = new Vector3();
  private readonly targetRotation = new Quaternion();
  private readonly errorRotation = new Quaternion();
  private readonly targetEuler = new Euler(0, 0, 0, "YXZ");
  private readonly axis = new Vector3();
  private readonly probePoint = new Vector3();
  private readonly force = new Vector3();
  private readonly torque = new Vector3();

  constructor(
    body: RAPIER.RigidBody,
    private readonly config: RotorcraftVehicleMotorConfig,
  ) {
    if (body.isKinematic()) {
      throw new Error("RotorcraftVehicleMotor requiere un cuerpo dinámico.");
    }
    this.body = body;
    this.lift = config.hoverLift;
    this.telemetry = createVehicleTelemetry(body);
    const rotation = body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.heading = headingOf(this.rotation, this.forward);
    this.refreshTelemetry();
  }

  setControl(input: Readonly<VehicleControlInput>): void {
    this.control = {
      throttle: MathUtils.clamp(input.throttle, -1, 1),
      steering: MathUtils.clamp(input.steering, -1, 1),
      brake: MathUtils.clamp(input.brake, 0, 1),
      handbrake: MathUtils.clamp(input.handbrake, 0, 1),
      boost: input.boost,
      collective: MathUtils.clamp(input.collective ?? 0, -1, 1),
      yaw: MathUtils.clamp(input.yaw ?? 0, -1, 1),
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  prePhysicsStep(delta: number): void {
    if (this.disposed || !this.body.isValid()) return;
    // Rapier acumula las fuerzas de usuario entre steps: ver
    // `reference_rapier_forces_persist`.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    if (!this.isEnabled() || delta <= 0) return;

    this.readBodyState();
    this.updateAltitude();
    this.updateAttitude(delta);
    this.applyAttitudeTorque();
    this.applyLift(delta);
    this.applyDrag();
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
    this.rotation.copy(state.rotation);
    this.heading = headingOf(this.rotation, this.forward);
    this.pitch = 0;
    this.roll = 0;
    this.lift = this.config.hoverLift;
    this.refreshTelemetry();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    if (this.body.isValid()) {
      this.body.resetForces(false);
      this.body.resetTorques(false);
    }
  }

  /** Altura sobre el terreno, o `Infinity` sin nada debajo. */
  getAltitude(): number {
    return this.altitude;
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  private readBodyState(): void {
    const position = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    const angularVelocity = this.body.angvel();
    this.position.set(position.x, position.y, position.z);
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.velocity.set(velocity.x, velocity.y, velocity.z);
    this.angularVelocity.set(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    );
    this.up.copy(LOCAL_UP).applyQuaternion(this.rotation);
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.rotation);
  }

  private updateAltitude(): void {
    const provider = this.config.surfaceProvider;
    if (!provider) {
      this.altitude = Number.POSITIVE_INFINITY;
      this.grounded = false;
      return;
    }
    const lift = this.config.hullBottom + PROBE_LIFT;
    this.probePoint.set(
      this.position.x,
      this.position.y + lift,
      this.position.z,
    );
    const sample = provider.sampleSurface(
      this.probePoint,
      (this.config.probeDistance ?? 60) + lift,
    );
    this.altitude = sample
      ? Math.max(
          0,
          this.position.y + this.config.hullBottom - sample.point.y,
        )
      : Number.POSITIVE_INFINITY;
    this.grounded = this.altitude <= GROUNDED_ALTITUDE;
  }

  private updateAttitude(delta: number): void {
    const config = this.config;
    // El cíclico manda una actitud, no un par: por eso no se puede volcar.
    const targetPitch = this.control.throttle * config.maxPitch;
    const targetRoll = this.control.steering * config.maxRoll;
    const blend = 1 - Math.exp(-config.attitudeResponse * delta);
    this.pitch = MathUtils.lerp(this.pitch, targetPitch, blend);
    this.roll = MathUtils.lerp(this.roll, targetRoll, blend);

    // Guiñada positiva es la derecha del proyecto, y girar a la derecha BAJA
    // `atan2(forward.x, forward.z)`, así que el rumbo va con el signo cambiado.
    const rollFraction =
      config.maxRoll > 0 ? this.roll / config.maxRoll : 0;
    const yawRate =
      (this.control.yaw ?? 0) * config.yawRate +
      rollFraction * config.turnCoordination;
    this.heading = wrapAngle(this.heading - yawRate * delta);
  }

  private applyAttitudeTorque(): void {
    this.targetEuler.set(this.pitch, this.heading, this.roll);
    this.targetRotation.setFromEuler(this.targetEuler);
    this.errorRotation
      .copy(this.rotation)
      .invert()
      .premultiply(this.targetRotation);
    // El cuaternión negado describe el mismo giro por el camino largo; sin
    // corregirlo el aparato daría la vuelta entera para enderezarse.
    if (this.errorRotation.w < 0) {
      this.errorRotation.set(
        -this.errorRotation.x,
        -this.errorRotation.y,
        -this.errorRotation.z,
        -this.errorRotation.w,
      );
    }
    const sinHalf = Math.hypot(
      this.errorRotation.x,
      this.errorRotation.y,
      this.errorRotation.z,
    );
    const angle =
      2 * Math.atan2(sinHalf, MathUtils.clamp(this.errorRotation.w, -1, 1));
    if (sinHalf > 1e-6) {
      this.axis
        .set(this.errorRotation.x, this.errorRotation.y, this.errorRotation.z)
        .divideScalar(sinHalf);
    } else {
      this.axis.set(0, 0, 0);
    }

    const mass = this.config.mass;
    this.torque
      .copy(this.axis)
      .multiplyScalar(angle * this.config.attitudeStiffness * mass)
      .addScaledVector(this.angularVelocity, -this.config.attitudeDamping * mass);
    this.body.addTorque(this.torque, true);
  }

  private applyLift(delta: number): void {
    const config = this.config;
    const collective = this.control.collective ?? 0;
    const target =
      collective >= 0
        ? MathUtils.lerp(config.hoverLift, config.maxLift, collective)
        : MathUtils.lerp(config.hoverLift, config.minLift, -collective);
    this.lift = MathUtils.lerp(
      this.lift,
      target,
      1 - Math.exp(-config.liftResponse * delta),
    );

    // El empuje sale del eje vertical LOCAL, así que ladearse cuesta altura.
    // Compensarlo es lo que hace el piloto con el colectivo: sin esto cada
    // viraje sería un descenso y volar exigiría dos manos coordinadas.
    const compensation =
      1 / Math.max(MIN_TILT_COMPENSATION, this.up.dot(WORLD_UP));
    let thrust = this.lift * config.mass * config.gravity * compensation;
    // Apoyado y sin pedir subir, el rotor no puede levantar más que el peso: de
    // lo contrario el aparato flotaría un palmo sobre la pista para siempre.
    if (this.grounded && collective <= 0) {
      thrust = Math.min(thrust, config.mass * config.gravity);
    }
    this.force.copy(this.up).multiplyScalar(thrust);
    this.body.addForce(this.force, true);
  }

  private applyDrag(): void {
    const config = this.config;
    const horizontalDrag =
      config.linearDrag + (this.grounded ? config.groundDrag : 0);
    this.force.set(
      -this.velocity.x * horizontalDrag * config.mass,
      -this.velocity.y * config.verticalDrag * config.mass,
      -this.velocity.z * horizontalDrag * config.mass,
    );
    this.body.addForce(this.force, true);
  }

  private refreshTelemetry(): void {
    copyRigidBodyState(this.telemetry.state, this.body);
    const velocity = this.body.linvel();
    this.velocity.set(velocity.x, velocity.y, velocity.z);
    const rotation = this.body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.forward.copy(LOCAL_FORWARD).applyQuaternion(this.rotation);
    this.telemetry.speed = this.velocity.length();
    this.telemetry.forwardSpeed = this.velocity.dot(this.forward);
    const config = this.config;
    const liftSpan = Math.max(0.0001, config.maxLift - config.minLift);
    this.telemetry.engineRpm = MathUtils.lerp(
      IDLE_RPM,
      MAX_RPM,
      MathUtils.clamp((this.lift - config.minLift) / liftSpan, 0, 1),
    );
    this.telemetry.steering =
      config.maxRoll > 0 ? MathUtils.clamp(this.roll / config.maxRoll, -1, 1) : 0;
    this.telemetry.contactCount = this.grounded ? 1 : 0;
    this.telemetry.grounded = this.grounded;
    this.telemetry.submergedRatio = 0;
    this.telemetry.altitude = this.altitude;
  }
}

function headingOf(rotation: Quaternion, scratch: Vector3): number {
  scratch.copy(LOCAL_FORWARD).applyQuaternion(rotation);
  return Math.atan2(scratch.x, scratch.z);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
