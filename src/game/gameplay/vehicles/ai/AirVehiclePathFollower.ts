import { WORLD_GRAVITY } from '@engine/physics/PhysicsWorld';
import type {
  AirControlCommand,
  AirFollowerInput,
} from './AirVehicleAiTypes';
import type { VehicleNavPoint } from './VehicleAiTypes';

export interface AirVehicleFollowerTuning {
  /** Inclinación máxima que el piloto se permite pedir, en radianes. */
  maxTilt: number;
  /** Techo de actitud del preset; el mando se normaliza contra él. */
  presetMaxPitch: number;
  presetMaxRoll: number;
  /** Ganancia del lazo de velocidad: error de velocidad → aceleración pedida. */
  velocityGain: number;
  /** Ganancia del lazo de altitud: error de altura → velocidad vertical. */
  altitudeGain: number;
  maxClimbRate: number;
  maxDescentRate: number;
  /** Ritmo de bajada mandado durante un aterrizaje. */
  landingDescentRate: number;
  /** Ganancia del lazo de colectivo: error de velocidad vertical → mando. */
  collectiveGain: number;
  /** Ganancia de pedales sobre el error de rumbo. */
  yawGain: number;
  /** Frenada de llegada: a qué distancia empieza a soltar velocidad. */
  arrivalDeceleration: number;
}

export const DEFAULT_AIR_FOLLOWER_TUNING: Readonly<AirVehicleFollowerTuning> =
  Object.freeze({
    maxTilt: 0.38,
    presetMaxPitch: 0.42,
    presetMaxRoll: 0.5,
    velocityGain: 1.1,
    altitudeGain: 0.55,
    maxClimbRate: 9,
    maxDescentRate: 7,
    landingDescentRate: 2.2,
    collectiveGain: 0.55,
    yawGain: 1.6,
    arrivalDeceleration: 4.5,
  });

const ARRIVAL_RADIUS = 3.5;
const WAYPOINT_RADIUS = 6;
/** Debajo de esta velocidad el rumbo no se deduce del vector velocidad. */
const HEADING_FROM_VELOCITY_SPEED = 2.5;

/**
 * Piloto automático en cascada, que es como se controla un helicóptero de
 * verdad: el lazo externo convierte posición en velocidad deseada, ésta en una
 * aceleración, y la aceleración en la INCLINACIÓN que la produce, porque un
 * rotor sólo puede acelerar ladeando su empuje. El lazo interno —sostener esa
 * actitud— ya vive dentro de `RotorcraftVehicleMotor`.
 *
 * Por eso no se parece al seguidor terrestre: no hay radio de giro mínimo, la
 * altitud es un eje libre y el morro puede apuntar a un lado mientras el
 * aparato viaja hacia otro, que es justo lo que hace que la torreta de puerta
 * apunte al blanco mientras orbita.
 */
export class AirVehiclePathFollower {
  private readonly tuning: AirVehicleFollowerTuning;
  private routeCursor = 0;

  constructor(tuning: Partial<AirVehicleFollowerTuning> = {}) {
    this.tuning = { ...DEFAULT_AIR_FOLLOWER_TUNING, ...tuning };
  }

  reset(): void {
    this.routeCursor = 0;
  }

  update(input: AirFollowerInput): AirControlCommand {
    const tuning = this.tuning;
    const intent = input.intent;
    if (intent.shutdown) {
      return command(0, 0, 0, -1, null, 0);
    }

    const target = this.resolveTarget(input);
    const horizontalSpeed = Math.hypot(input.velocity[0], input.velocity[2]);

    const desired = this.desiredVelocity(input, target);
    const accelX = (desired[0] - input.velocity[0]) * tuning.velocityGain;
    const accelZ = (desired[1] - input.velocity[2]) * tuning.velocityGain;
    const { throttle, steering } = this.tiltFor(accelX, accelZ, input.heading);

    const yaw = this.yawCommand(input, desired, horizontalSpeed);
    const collective = this.collectiveCommand(input);

    return command(
      throttle,
      steering,
      yaw,
      collective,
      target,
      Math.hypot(desired[0], desired[1]),
    );
  }

  /**
   * Punto a perseguir: el de anticipación sobre la ruta si hay ruta, o el
   * objetivo directo si no. El cursor sólo avanza, así que un rodeo del A* no
   * se deshace al pasar cerca de un tramo anterior.
   */
  private resolveTarget(input: AirFollowerInput): VehicleNavPoint | null {
    const route = input.route;
    if (!route || route.length === 0) {
      this.routeCursor = 0;
      return input.intent.target;
    }
    while (this.routeCursor < route.length - 1) {
      const point = route[this.routeCursor];
      if (distance3(point, input.position) > WAYPOINT_RADIUS) break;
      this.routeCursor += 1;
    }
    return route[Math.min(this.routeCursor, route.length - 1)] ?? null;
  }

  /** Velocidad horizontal deseada, ya con la frenada de llegada aplicada. */
  private desiredVelocity(
    input: AirFollowerInput,
    target: VehicleNavPoint | null,
  ): [number, number] {
    if (!target) return [0, 0];
    const dx = target[0] - input.position[0];
    const dz = target[2] - input.position[2];
    const planar = Math.hypot(dx, dz);
    if (planar < 0.05) return [0, 0];

    const isFinalLeg =
      !input.route || this.routeCursor >= input.route.length - 1;
    let speed = input.intent.cruiseSpeed;
    if (isFinalLeg) {
      // sqrt(2·a·d) es la velocidad máxima con la que todavía se puede frenar
      // en `d` metros. Sin esto el aparato pasa de largo y oscila alrededor del
      // punto, que en un helicóptero se lee como estar borracho.
      const braking = Math.sqrt(
        2 * this.tuning.arrivalDeceleration * Math.max(0, planar - ARRIVAL_RADIUS),
      );
      speed = Math.min(speed, braking);
    }
    const scale = speed / planar;
    return [dx * scale, dz * scale];
  }

  /**
   * Aceleración horizontal → actitud. Un rotor acelera `g·tan(θ)` en la
   * dirección hacia la que se inclina, así que la cuenta se invierte con un
   * arcotangente y después se pasa a ejes del aparato.
   */
  private tiltFor(
    accelX: number,
    accelZ: number,
    heading: number,
  ): { throttle: number; steering: number } {
    const magnitude = Math.hypot(accelX, accelZ);
    if (magnitude < 1e-4) return { throttle: 0, steering: 0 };
    const tilt = Math.min(
      this.tuning.maxTilt,
      Math.atan(magnitude / WORLD_GRAVITY),
    );
    const unitX = accelX / magnitude;
    const unitZ = accelZ / magnitude;
    // Adelante es (sin h, cos h) y la derecha del proyecto es forward × up,
    // o sea (-cos h, sin h). Ver `reference` de la convención de dirección.
    const forward = unitX * Math.sin(heading) + unitZ * Math.cos(heading);
    const right = -unitX * Math.cos(heading) + unitZ * Math.sin(heading);
    // Morro abajo acelera hacia adelante y alabear a la derecha acelera a la
    // derecha: los dos mandos van con el mismo signo que su componente.
    const pitch = tilt * forward;
    const roll = tilt * right;
    return {
      throttle: clamp(pitch / this.tuning.presetMaxPitch, -1, 1),
      steering: clamp(roll / this.tuning.presetMaxRoll, -1, 1),
    };
  }

  private yawCommand(
    input: AirFollowerInput,
    desired: readonly [number, number],
    horizontalSpeed: number,
  ): number {
    const facing = input.intent.facing;
    let desiredHeading: number | null = null;
    if (facing) {
      const dx = facing[0] - input.position[0];
      const dz = facing[2] - input.position[2];
      if (Math.hypot(dx, dz) > 0.5) desiredHeading = Math.atan2(dx, dz);
    } else if (
      horizontalSpeed > HEADING_FROM_VELOCITY_SPEED ||
      Math.hypot(desired[0], desired[1]) > HEADING_FROM_VELOCITY_SPEED
    ) {
      desiredHeading = Math.atan2(desired[0], desired[1]);
    }
    if (desiredHeading === null) return 0;
    const error = wrapAngle(desiredHeading - input.heading);
    // Guiñar a la derecha BAJA el rumbo, así que el mando va con signo opuesto
    // al error.
    return clamp(-error * this.tuning.yawGain, -1, 1);
  }

  /**
   * Colectivo por servo de velocidad vertical. Al ser un servo sobre la
   * velocidad y no sobre la posición, se compensa solo el hundimiento del
   * rotor al ralentí: no hace falta conocer el `hoverLift` del preset.
   */
  private collectiveCommand(input: AirFollowerInput): number {
    const tuning = this.tuning;
    let desiredVertical: number;
    if (input.intent.descend) {
      desiredVertical = input.grounded ? 0 : -tuning.landingDescentRate;
    } else if (!Number.isFinite(input.altitude)) {
      // Sin terreno debajo —un hueco entre plataformas, el borde del mapa— la
      // altura sobre el suelo no existe. Restarla daba error infinito y el
      // aparato se hundía para siempre; lo correcto es sostener lo que tiene.
      desiredVertical = 0;
    } else {
      const altitudeError = input.intent.targetAltitude - input.altitude;
      desiredVertical = clamp(
        altitudeError * tuning.altitudeGain,
        -tuning.maxDescentRate,
        tuning.maxClimbRate,
      );
    }
    if (input.grounded && desiredVertical <= 0) return -1;
    const error = desiredVertical - input.velocity[1];
    return clamp(error * tuning.collectiveGain, -1, 1);
  }
}

function command(
  throttle: number,
  steering: number,
  yaw: number,
  collective: number,
  targetPoint: VehicleNavPoint | null,
  targetSpeed: number,
): AirControlCommand {
  return { throttle, steering, yaw, collective, targetPoint, targetSpeed };
}

function distance3(a: VehicleNavPoint, b: VehicleNavPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
