import { MathUtils } from "three";
import type { VehicleControlInput } from "./VehicleMotor";

/** Raw driver intent, already resolved from bindings or an AI controller. */
export interface VehicleDriverIntent {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  boost: boolean;
}

export interface VehicleDriverTuning {
  /**
   * Speed at which the vehicle counts as "moving" for the purpose of deciding
   * whether the opposite key brakes or reverses. Below it the same key changes
   * direction instead.
   */
  throttleAsBrakeSpeed: number;
  /** Fraction of full throttle gained per second. */
  throttleRate: number;
  /** Fraction of full brake gained per second. */
  brakeRate: number;
  /** Brake rate multiplier when slowing a vehicle that moves forward. */
  brakeRateFromForward: number;
  /** Throttle ceiling in reverse, as a positive fraction. */
  maxReverseThrottle: number;
  /** Steering wheel travel per second at `speedSlow` and at `speedFast`. */
  steeringRateSlow: number;
  steeringRateFast: number;
  /** Self-centering speed at `speedSlow` and at `speedFast`. */
  steeringRestRateSlow: number;
  steeringRestRateFast: number;
  speedSlow: number;
  speedFast: number;
  /** Throttle cut at full lock, interpolated between both speeds. */
  turnThrottleReduceSlow: number;
  turnThrottleReduceFast: number;
  /** Steering rate multiplier while braking. */
  brakeSteeringRateFactor: number;
  /** Self-centering multiplier while on the throttle. */
  throttleSteeringRestRateFactor: number;
}

export const DEFAULT_VEHICLE_DRIVER_TUNING: Readonly<VehicleDriverTuning> =
  Object.freeze({
    throttleAsBrakeSpeed: 1.4,
    throttleRate: 4,
    brakeRate: 3.6,
    brakeRateFromForward: 2,
    maxReverseThrottle: 1,
    steeringRateSlow: 4,
    steeringRateFast: 1.8,
    steeringRestRateSlow: 4.5,
    steeringRestRateFast: 2.6,
    speedSlow: 6,
    speedFast: 26,
    turnThrottleReduceSlow: 0.01,
    turnThrottleReduceFast: 0.35,
    brakeSteeringRateFactor: 1.6,
    throttleSteeringRestRateFactor: 1,
  });

/**
 * Driving feel of the Half-Life 2 four-wheel vehicles, ported from
 * `CFourWheelVehiclePhysics::UpdateDriverControls`.
 *
 * The part that matters for feel is that throttle and brake are not the same
 * axis: the key opposite to the current direction of travel brakes first and
 * only reverses once the vehicle has actually stopped. Everything ramps over
 * time, which is what keeps a keyboard from feeling like an on/off switch.
 */
export class VehicleDriverInputModel {
  private throttle = 0;
  private brake = 0;
  private steering = 0;
  private readonly tuning: VehicleDriverTuning;

  constructor(tuning: Partial<VehicleDriverTuning> = {}) {
    this.tuning = { ...DEFAULT_VEHICLE_DRIVER_TUNING, ...tuning };
  }

  reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.steering = 0;
  }

  update(
    intent: Readonly<VehicleDriverIntent>,
    forwardSpeed: number,
    delta: number,
  ): VehicleControlInput {
    if (delta <= 0) return this.snapshot(intent);
    const tuning = this.tuning;
    const speed = Math.abs(forwardSpeed);
    // Direction of travel with a dead band, so that a vehicle creeping to a
    // halt does not flicker between braking and reversing.
    const heading =
      forwardSpeed >= tuning.throttleAsBrakeSpeed
        ? 1
        : forwardSpeed <= -tuning.throttleAsBrakeSpeed
          ? -1
          : 0;

    this.updateSteering(intent, speed, delta);

    const wantsForward = intent.forward && !intent.back;
    const wantsBack = intent.back && !intent.forward;
    if (wantsForward) {
      this.applyDrive(1, heading, speed, delta);
    } else if (wantsBack) {
      this.applyDrive(-1, heading, speed, delta);
    } else {
      this.throttle = 0;
      this.brake = 0;
    }

    return this.snapshot(intent);
  }

  private applyDrive(
    direction: 1 | -1,
    heading: number,
    speed: number,
    delta: number,
  ): void {
    // Pressing against the direction of travel is a brake request, not a gear
    // change: hold it and the vehicle stops, keep holding and it reverses.
    if (heading === -direction) {
      // Braking a forward-moving vehicle is deliberately snappier than
      // arresting one that rolls backwards.
      const rate =
        direction > 0
          ? this.tuning.brakeRate
          : this.tuning.brakeRate * this.tuning.brakeRateFromForward;
      this.brake = approach(1, this.brake, rate * delta);
      this.throttle = 0;
      return;
    }

    this.brake = 0;
    if (this.throttle * direction < 0) this.throttle = 0;
    const ceiling =
      direction > 0
        ? this.throttleCeiling(speed)
        : -Math.min(1, Math.max(0.1, this.tuning.maxReverseThrottle));
    this.throttle = approach(
      ceiling,
      this.throttle,
      this.tuning.throttleRate * delta,
    );
  }

  /**
   * Full lock plus full throttle understeers into a wall, so Source trims the
   * throttle with the steering angle. The trim ramps in from a standstill,
   * otherwise pulling away in a tight turn feels broken.
   */
  private throttleCeiling(speed: number): number {
    const tuning = this.tuning;
    const reduce =
      speed < tuning.speedSlow
        ? remap(speed, 0, tuning.speedSlow, 0, tuning.turnThrottleReduceSlow)
        : remap(
            speed,
            tuning.speedSlow,
            tuning.speedFast,
            tuning.turnThrottleReduceSlow,
            tuning.turnThrottleReduceFast,
          );
    return Math.max(0.1, 1 - reduce * Math.abs(this.steering));
  }

  private updateSteering(
    intent: Readonly<VehicleDriverIntent>,
    speed: number,
    delta: number,
  ): void {
    const tuning = this.tuning;
    const turning = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
    const restRate = remap(
      speed,
      tuning.speedSlow,
      tuning.speedFast,
      tuning.steeringRestRateSlow,
      tuning.steeringRestRateFast,
    );
    if (turning === 0) {
      this.steering = approach(0, this.steering, restRate * delta);
      return;
    }

    let rate = remap(
      speed,
      tuning.speedSlow,
      tuning.speedFast,
      tuning.steeringRateSlow,
      tuning.steeringRateFast,
    );
    // Counter-steering must never be slower than self-centering, or the wheel
    // crawls through the middle when flicking from one lock to the other.
    if (rate < restRate && Math.sign(turning) !== Math.sign(this.steering)) {
      rate = restRate;
    }
    if (intent.back || intent.handbrake) {
      rate *= tuning.brakeSteeringRateFactor;
    } else if (intent.forward) {
      rate *= tuning.throttleSteeringRestRateFactor;
    }
    this.steering = approach(turning, this.steering, rate * delta);
  }

  private snapshot(intent: Readonly<VehicleDriverIntent>): VehicleControlInput {
    return {
      throttle: this.throttle,
      steering: this.steering,
      brake: this.brake,
      handbrake: intent.handbrake ? 1 : 0,
      // Boosting off the throttle would just burn the meter while coasting.
      boost: intent.boost && this.throttle > 0,
    };
  }
}

function approach(target: number, current: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
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
