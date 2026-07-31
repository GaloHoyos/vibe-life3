import type { VehicleControlCommand } from './VehicleAiTypes';
import { clamp } from './VehicleAiMath';

export interface VehicleControlSmootherTuning {
  /** Velocidad del volante en unidades normalizadas por segundo. */
  steeringRate: number;
  /** Subida del acelerador en unidades normalizadas por segundo. */
  throttleRate: number;
  /** Subida del freno; se suelta al doble de rápido, como un pie real. */
  brakeRate: number;
  /** Retardo entre que aparece un peligro y que el conductor frena. */
  reactionSeconds: number;
}

export interface VehicleSmoothingOptions {
  /**
   * Salta el suavizado. Lo usan los overrides de recovery (`reverse`, `rock`),
   * que dependen de invertir la marcha rápido para desatascarse.
   */
  immediate?: boolean;
}

const DEFAULT_TUNING: VehicleControlSmootherTuning = {
  steeringRate: 2.4,
  throttleRate: 2.2,
  brakeRate: 4,
  reactionSeconds: 0.35,
};

/** Un TTC por debajo de esto ya cuenta como peligro que dispara la reacción. */
const HAZARD_TTC = 2.4;
const HAZARD_BRAKE = 0.35;
const GEAR_CHANGE_THROTTLE = 0.05;

/**
 * Convierte la decisión de la IA (5-10 Hz, congelada entre ticks) en una señal
 * continua. Sin esto el volante da escalones visibles y el vehículo frena en el
 * instante físico exacto en que aparece el obstáculo, que es el tell más claro
 * de que no lo conduce nadie.
 *
 * Corre cada frame, no por tick.
 */
export class VehicleControlSmoother {
  private steering = 0;
  private throttle = 0;
  private brake = 0;
  private reverse = false;
  private hazardCountdown = 0;
  private hazardLatched = false;
  private preHazardThrottle = 0;

  constructor(private tuning: VehicleControlSmootherTuning = DEFAULT_TUNING) {}

  setTuning(tuning: VehicleControlSmootherTuning): void {
    this.tuning = tuning;
  }

  update(
    delta: number,
    command: VehicleControlCommand,
    options: VehicleSmoothingOptions = {},
  ): VehicleControlCommand {
    const step = Math.max(0, Math.min(delta, 0.25));
    if (options.immediate) {
      this.snapTo(command);
      return command;
    }

    const hazard = isHazard(command);
    if (hazard && !this.hazardLatched) {
      this.hazardLatched = true;
      this.hazardCountdown = this.tuning.reactionSeconds;
      this.preHazardThrottle = this.throttle;
    } else if (!hazard) {
      this.hazardLatched = false;
      this.hazardCountdown = 0;
    }
    if (this.hazardCountdown > 0) {
      this.hazardCountdown = Math.max(0, this.hazardCountdown - step);
    }
    const reacting = this.hazardCountdown <= 0;

    // El volante nunca se retarda: un conductor sigue corrigiendo la línea
    // mientras todavía no decidió frenar.
    this.steering = approach(
      this.steering,
      clamp(command.steering, -1, 1),
      this.tuning.steeringRate * step,
    );

    let targetThrottle = clamp(command.throttle, 0, 1);
    let targetBrake = clamp(command.brake, 0, 1);
    if (!reacting) {
      targetThrottle = this.preHazardThrottle;
      targetBrake = 0;
    }
    // Nunca acelerador y freno a la vez: el motor de HL2 lo tolera pero se ve
    // como un tirón raro y arruina la telemetría de velocidad.
    if (targetBrake > 0.02) targetThrottle = 0;

    const gearChange = command.reverse !== this.reverse;
    if (gearChange) {
      targetThrottle = 0;
      if (this.throttle <= GEAR_CHANGE_THROTTLE) {
        this.reverse = command.reverse;
      }
    }

    this.throttle = approach(
      this.throttle,
      targetThrottle,
      this.tuning.throttleRate * step,
    );
    this.brake = approach(
      this.brake,
      targetBrake,
      (targetBrake > this.brake ? this.tuning.brakeRate : this.tuning.brakeRate * 2) * step,
    );

    return {
      ...command,
      // El acelerador sigue bajando por dentro para que soltar el freno no dé
      // un tirón, pero mientras el freno esté pisado no sale nada de motor.
      throttle: this.brake > 0.02 ? 0 : this.throttle,
      brake: this.brake,
      steering: this.steering,
      reverse: this.reverse,
      handbrake: command.handbrake && reacting,
    };
  }

  reset(): void {
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.reverse = false;
    this.hazardCountdown = 0;
    this.hazardLatched = false;
    this.preHazardThrottle = 0;
  }

  private snapTo(command: VehicleControlCommand): void {
    this.steering = clamp(command.steering, -1, 1);
    this.throttle = clamp(command.throttle, 0, 1);
    this.brake = clamp(command.brake, 0, 1);
    this.reverse = command.reverse;
    this.hazardCountdown = 0;
    this.hazardLatched = false;
  }
}

function isHazard(command: VehicleControlCommand): boolean {
  if (command.handbrake) return true;
  if (command.brake >= HAZARD_BRAKE) return true;
  return command.timeToCollision !== null && command.timeToCollision <= HAZARD_TTC;
}

function approach(current: number, target: number, maximumStep: number): number {
  const difference = target - current;
  if (Math.abs(difference) <= maximumStep) return target;
  return current + Math.sign(difference) * maximumStep;
}
