import type {
  VehicleControlCommand,
  VehicleDrivingPath,
  VehicleDrivingPathPoint,
  VehicleFollowerInput,
  VehicleNavigationProfile,
  VehicleNavPoint,
} from './VehicleAiTypes';
import {
  clamp,
  headingBetween,
  headingToVector,
  normalizeAngle,
  planarDistance,
} from './VehicleAiMath';

export interface VehiclePathFollowerTuning {
  baseLookAhead?: number;
  speedLookAheadGain?: number;
  maximumLateralAcceleration?: number;
  obstacleHalfWidthMargin?: number;
  cautionTtc?: number;
  emergencyTtc?: number;
  waypointReachDistance?: number;
  speedPid?: {
    proportional: number;
    integral: number;
    derivative: number;
    integralLimit?: number;
  };
}

export class PidController {
  private integral = 0;
  private previousError = 0;
  private initialized = false;

  constructor(
    private readonly proportional: number,
    private readonly integralGain: number,
    private readonly derivative: number,
    private readonly integralLimit = 10,
  ) {}

  update(error: number, delta: number): number {
    const safeDelta = Math.max(1e-4, delta);
    this.integral = clamp(
      this.integral + error * safeDelta,
      -this.integralLimit,
      this.integralLimit,
    );
    const derivativeValue = this.initialized ? (error - this.previousError) / safeDelta : 0;
    this.previousError = error;
    this.initialized = true;
    return (
      this.proportional * error +
      this.integralGain * this.integral +
      this.derivative * derivativeValue
    );
  }

  reset(): void {
    this.integral = 0;
    this.previousError = 0;
    this.initialized = false;
  }
}

export class VehiclePathFollower {
  private readonly speedController: PidController;
  private pathCursor = 0;
  private previousPath: VehicleDrivingPath | null = null;

  constructor(
    private readonly profile: VehicleNavigationProfile,
    private readonly tuning: VehiclePathFollowerTuning = {},
  ) {
    const pid = tuning.speedPid ?? {
      proportional: 0.34,
      integral: 0.055,
      derivative: 0.08,
      integralLimit: 8,
    };
    this.speedController = new PidController(
      pid.proportional,
      pid.integral,
      pid.derivative,
      pid.integralLimit,
    );
  }

  update(input: VehicleFollowerInput): VehicleControlCommand {
    if (input.path !== this.previousPath) {
      this.previousPath = input.path;
      this.pathCursor = 0;
      this.speedController.reset();
    }
    if (input.path.points.length === 0) return stoppedCommand();

    this.advanceCursor(input.path, input.pose.position);
    const lookAhead = Math.max(
      this.profile.halfLength,
      (this.tuning.baseLookAhead ?? this.profile.halfLength * 1.2) +
        Math.abs(input.speed) * (this.tuning.speedLookAheadGain ?? 0.22),
    );
    const target = findLookAheadTarget(input.path, this.pathCursor, input.pose.position, lookAhead);
    const direction = target.direction ?? 'forward';
    const travelHeading = normalizeAngle(
      input.pose.heading + (direction === 'reverse' ? Math.PI : 0),
    );
    const targetHeading = headingBetween(input.pose.position, target.position);
    const alpha = normalizeAngle(targetHeading - travelHeading);
    const curvature = (2 * Math.sin(alpha)) / Math.max(0.5, lookAhead);
    const steeringAngle = Math.atan(this.profile.wheelbase * curvature);
    const steeringDenominator = Math.max(0.05, this.profile.maxSteeringAngle);
    let steering = clamp(steeringAngle / steeringDenominator, -1, 1);
    if (direction === 'reverse') steering *= -1;

    const targetSpeedLimit = target.speedLimit ?? this.profile.maxSpeed;
    const curvatureSpeed = curveSafeSpeed(
      input.path,
      this.pathCursor,
      this.tuning.maximumLateralAcceleration ?? 5.5,
      targetSpeedLimit,
    );
    let targetSpeed = Math.min(this.profile.maxSpeed, targetSpeedLimit, curvatureSpeed);
    const timeToCollision = findTimeToCollision(input, this.profile, this.tuning);
    const cautionTtc = this.tuning.cautionTtc ?? 2.4;
    const emergencyTtc = this.tuning.emergencyTtc ?? 0.75;
    if (timeToCollision !== null) {
      const safetyFactor = clamp(
        (timeToCollision - emergencyTtc) / Math.max(0.1, cautionTtc - emergencyTtc),
        0,
        1,
      );
      targetSpeed *= safetyFactor;
    }

    const speedMagnitude = Math.abs(input.speed);
    const effort = this.speedController.update(targetSpeed - speedMagnitude, input.delta);
    const emergency = timeToCollision !== null && timeToCollision <= emergencyTtc;
    const brake = emergency
      ? 1
      : clamp(-effort / Math.max(1, this.profile.maxBraking), 0, 1);
    const throttle = emergency
      ? 0
      : clamp(effort / Math.max(1, this.profile.maxAcceleration), 0, 1);
    return {
      throttle,
      brake,
      steering,
      reverse: direction === 'reverse',
      handbrake: emergency && speedMagnitude > 3,
      targetSpeed,
      targetPoint: target.position,
      timeToCollision,
    };
  }

  reset(): void {
    this.previousPath = null;
    this.pathCursor = 0;
    this.speedController.reset();
  }

  private advanceCursor(path: VehicleDrivingPath, position: VehicleNavPoint): void {
    const reachDistance = Math.max(
      0.75,
      this.tuning.waypointReachDistance ?? this.profile.halfLength * 0.7,
    );
    while (
      this.pathCursor + 1 < path.points.length &&
      planarDistance(position, path.points[this.pathCursor].position) <= reachDistance
    ) {
      this.pathCursor += 1;
    }
    let bestIndex = this.pathCursor;
    let bestDistance = planarDistance(position, path.points[bestIndex].position);
    const scanEnd = Math.min(path.points.length, this.pathCursor + 8);
    for (let index = this.pathCursor + 1; index < scanEnd; index += 1) {
      const distance = planarDistance(position, path.points[index].position);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    this.pathCursor = bestIndex;
  }
}

export function findTimeToCollision(
  input: VehicleFollowerInput,
  profile: VehicleNavigationProfile,
  tuning: VehiclePathFollowerTuning = {},
): number | null {
  const nearestDirection = nearestPathDirection(input.path, input.pose.position);
  const travelHeading = input.pose.heading +
    (nearestDirection === 'reverse' ? Math.PI : 0);
  const forward = headingToVector(travelHeading);
  const speed = Math.abs(input.speed);
  const corridorHalfWidth =
    profile.halfWidth + (tuning.obstacleHalfWidthMargin ?? 0.45);
  let minimum = Infinity;

  for (const obstacle of input.obstacles ?? []) {
    if (obstacle.blocking === false) continue;
    const relativeX = obstacle.position[0] - input.pose.position[0];
    const relativeZ = obstacle.position[2] - input.pose.position[2];
    const longitudinal = relativeX * forward[0] + relativeZ * forward[1];
    const lateral = Math.abs(relativeX * forward[1] - relativeZ * forward[0]);
    if (longitudinal <= 0 || lateral > corridorHalfWidth + obstacle.radius) continue;
    const obstacleLongitudinalSpeed =
      obstacle.velocity[0] * forward[0] + obstacle.velocity[2] * forward[1];
    const closingSpeed = speed - obstacleLongitudinalSpeed;
    if (closingSpeed <= 0.05) continue;
    const freeDistance = Math.max(
      0,
      longitudinal - profile.halfLength - obstacle.radius,
    );
    minimum = Math.min(minimum, freeDistance / closingSpeed);
  }

  for (const cast of input.shapeCasts ?? []) {
    if (
      Math.abs(cast.lateralOffset) >
      corridorHalfWidth + (cast.radius ?? 0)
    ) continue;
    const closingSpeed = Math.max(cast.closingSpeed, speed);
    if (closingSpeed <= 0.05) continue;
    minimum = Math.min(
      minimum,
      Math.max(0, cast.distance - profile.halfLength) / closingSpeed,
    );
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function nearestPathDirection(
  path: VehicleDrivingPath,
  position: VehicleNavPoint,
): 'forward' | 'reverse' {
  let direction: 'forward' | 'reverse' = 'forward';
  let distance = Infinity;
  for (const point of path.points) {
    const candidate = planarDistance(position, point.position);
    if (candidate < distance) {
      distance = candidate;
      direction = point.direction ?? 'forward';
    }
  }
  return direction;
}

function findLookAheadTarget(
  path: VehicleDrivingPath,
  startIndex: number,
  position: VehicleNavPoint,
  lookAhead: number,
): VehicleDrivingPathPoint {
  let remaining = lookAhead;
  let previous = position;
  for (let index = startIndex; index < path.points.length; index += 1) {
    const point = path.points[index];
    const segmentLength = planarDistance(previous, point.position);
    if (segmentLength >= remaining && segmentLength > 1e-6) {
      const alpha = remaining / segmentLength;
      return {
        ...point,
        position: [
          previous[0] + (point.position[0] - previous[0]) * alpha,
          previous[1] + (point.position[1] - previous[1]) * alpha,
          previous[2] + (point.position[2] - previous[2]) * alpha,
        ],
      };
    }
    remaining -= segmentLength;
    previous = point.position;
  }
  return path.points[path.points.length - 1];
}

function curveSafeSpeed(
  path: VehicleDrivingPath,
  cursor: number,
  maximumLateralAcceleration: number,
  fallback: number,
): number {
  let maximumCurvature = 0;
  const end = Math.min(path.points.length - 1, cursor + 6);
  for (let index = Math.max(1, cursor); index < end; index += 1) {
    const before = path.points[index - 1].position;
    const current = path.points[index].position;
    const after = path.points[index + 1].position;
    const incoming = headingBetween(before, current);
    const outgoing = headingBetween(current, after);
    const angle = Math.abs(normalizeAngle(outgoing - incoming));
    const segment = Math.max(
      0.5,
      (planarDistance(before, current) + planarDistance(current, after)) * 0.5,
    );
    maximumCurvature = Math.max(maximumCurvature, angle / segment);
  }
  if (maximumCurvature <= 1e-4) return fallback;
  return Math.min(
    fallback,
    Math.sqrt(Math.max(0.1, maximumLateralAcceleration) / maximumCurvature),
  );
}

export function stoppedCommand(): VehicleControlCommand {
  return {
    throttle: 0,
    brake: 1,
    steering: 0,
    reverse: false,
    handbrake: false,
    targetSpeed: 0,
    targetPoint: null,
    timeToCollision: null,
  };
}
