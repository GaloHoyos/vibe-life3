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
  avoidanceDistance?: number;
  avoidanceSteeringGain?: number;
  waypointReachDistance?: number;
  /** Fracción de la velocidad máxima que este conductor usa en recta. */
  cruiseSpeedFactor?: number;
  /**
   * Piso de velocidad en curva como fracción del máximo, el `driverminspeed` de
   * HL2: sin esto el límite por curvatura hace que gatee en cada esquina.
   */
  minimumSpeedFactor?: number;
  /** Desaceleración con la que rueda hasta parar en el destino (m/s²). */
  arrivalDeceleration?: number;
  speedPid?: {
    proportional: number;
    integral: number;
    derivative: number;
    integralLimit?: number;
  };
}

export interface VehiclePathProgress {
  /** Distancia recorrida sobre el path. En loops no se reinicia al completar una vuelta. */
  distance: number;
  /** Distancia envuelta dentro de la vuelta actual. */
  wrappedDistance: number;
  totalLength: number;
  /** `null` en loops, que no tienen final. */
  remainingDistance: number | null;
  lateralError: number;
  segmentIndex: number;
  lap: number;
}

/** Margen para que el morro quede sobre la meta y no la pase de largo. */
const ARRIVAL_MARGIN = 0.5;
/**
 * Debajo de esta velocidad no hay frenada por colisión inminente. A paso de
 * hombre no hay nada contra qué estrellarse, y sin este piso un vehículo
 * detenido contra un obstáculo se auto-frena para siempre: el TTC tiende a cero,
 * el `targetSpeed` queda en cero y nunca llega a intentar maniobrar.
 */
const COLLISION_BRAKE_SPEED = 0.8;

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
  private previousPath: VehicleDrivingPath | null = null;
  private geometry: PathGeometry | null = null;
  private pathProgress = 0;
  private lateralError = 0;
  private segmentIndex = 0;
  private avoidanceSide: -1 | 1 = 1;

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
      this.geometry = buildPathGeometry(input.path);
      const projection = projectOntoPath(
        this.geometry,
        input.pose.position,
        input.pose.heading,
        null,
      );
      this.pathProgress = projection?.distance ?? 0;
      this.lateralError = projection?.lateralError ?? 0;
      this.segmentIndex = projection?.segmentIndex ?? 0;
      this.speedController.reset();
    }
    if (input.path.points.length === 0) return stoppedCommand();

    const geometry = this.geometry ?? buildPathGeometry(input.path);
    this.geometry = geometry;
    const projection = projectOntoPath(
      geometry,
      input.pose.position,
      input.pose.heading,
      this.pathProgress,
    );
    if (projection) {
      this.pathProgress = Math.max(this.pathProgress, projection.distance);
      this.lateralError = projection.lateralError;
      this.segmentIndex = segmentIndexAtDistance(geometry, this.pathProgress);
    }
    const lookAhead = Math.max(
      this.profile.halfLength,
      (this.tuning.baseLookAhead ?? this.profile.halfLength * 1.2) +
        Math.abs(input.speed) * (this.tuning.speedLookAheadGain ?? 0.22),
    );
    const target = findLookAheadTarget(
      input.path,
      geometry,
      this.pathProgress,
      input.pose.position,
      lookAhead,
    );
    const direction = target.direction ?? 'forward';
    const travelHeading = normalizeAngle(
      input.pose.heading + (direction === 'reverse' ? Math.PI : 0),
    );
    const targetHeading = headingBetween(input.pose.position, target.position);
    const alpha = normalizeAngle(targetHeading - travelHeading);
    const curvature = (2 * Math.sin(alpha)) / Math.max(0.5, lookAhead);
    const steeringAngle = Math.atan(this.profile.wheelbase * curvature);
    const steeringDenominator = Math.max(0.05, this.profile.maxSteeringAngle);
    // `alpha > 0` significa que el objetivo quedó hacia +X, que es la IZQUIERDA
    // (la derecha del proyecto es `forward × up` = -X). Sin el signo la IA
    // mandaba doblar para el lado opuesto al de su propio camino.
    let steering = -clamp(steeringAngle / steeringDenominator, -1, 1);
    if (direction === 'reverse') steering *= -1;
    const avoidance = findAvoidanceSteering(
      input,
      this.profile,
      this.tuning,
      this.avoidanceSide,
    );
    if (avoidance.side !== null) this.avoidanceSide = avoidance.side;
    steering = clamp(
      steering +
        avoidance.steering * (this.tuning.avoidanceSteeringGain ?? 0.9),
      -1,
      1,
    );

    const cruiseSpeed = this.profile.maxSpeed *
      clamp(this.tuning.cruiseSpeedFactor ?? 1, 0.1, 1);
    const targetSpeedLimit = Math.min(
      target.speedLimit ?? this.profile.maxSpeed,
      input.speedLimit ?? this.profile.maxSpeed,
    );
    const maximumLateralAcceleration = this.tuning.maximumLateralAcceleration ?? 5.5;
    const pathCurvatureSpeed = curveSafeSpeed(
      input.path,
      this.segmentIndex,
      maximumLateralAcceleration,
      targetSpeedLimit,
    );
    const commandedCurvatureSpeed = safeSpeedForCurvature(
      Math.abs(curvature),
      maximumLateralAcceleration,
      targetSpeedLimit,
    );
    // El mínimo del preset es una preferencia. Nunca puede levantar el límite
    // físico que imponen la curva pedida o el path que viene por delante.
    const preferredMinimum = this.profile.maxSpeed *
      clamp(this.tuning.minimumSpeedFactor ?? 0, 0, 1);
    const desiredCruise = Math.max(preferredMinimum, cruiseSpeed);
    let targetSpeed = Math.min(
      desiredCruise,
      targetSpeedLimit,
      pathCurvatureSpeed,
      commandedCurvatureSpeed,
    );
    // Frenada de llegada: sin esto el vehículo cruza la meta a velocidad de
    // crucero y sólo clava los frenos cuando el cerebro le suelta el goal.
    const arrivalDeceleration = this.tuning.arrivalDeceleration ?? 3;
    if (input.path.loop !== true) {
      const remaining = distanceToPathEnd(
        input.path,
        geometry,
        this.pathProgress,
        this.lateralError,
        input.pose.position,
        brakingHorizon(input.speed, arrivalDeceleration, this.profile.halfLength),
      );
      if (remaining !== null) {
        targetSpeed = Math.min(
          targetSpeed,
          Math.sqrt(
            2 * arrivalDeceleration * Math.max(0, remaining - ARRIVAL_MARGIN),
          ),
        );
      }
    }
    const directionChangeDistance = distanceToDirectionChange(
      geometry,
      this.pathProgress,
      this.segmentIndex,
    );
    if (directionChangeDistance !== null) {
      targetSpeed = Math.min(
        targetSpeed,
        Math.sqrt(
          2 * arrivalDeceleration *
          Math.max(0, directionChangeDistance - ARRIVAL_MARGIN),
        ),
      );
    }
    const timeToCollision = Math.abs(input.speed) > COLLISION_BRAKE_SPEED
      ? findTimeToCollision(input, this.profile, this.tuning)
      : null;
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
    this.geometry = null;
    this.pathProgress = 0;
    this.lateralError = 0;
    this.segmentIndex = 0;
    this.avoidanceSide = 1;
    this.speedController.reset();
  }

  getProgress(): VehiclePathProgress | null {
    const geometry = this.geometry;
    if (!geometry || geometry.segments.length === 0) return null;
    const wrappedDistance = wrapPathDistance(this.pathProgress, geometry.totalLength);
    return {
      distance: this.pathProgress,
      wrappedDistance,
      totalLength: geometry.totalLength,
      remainingDistance: geometry.loop
        ? null
        : Math.max(0, geometry.totalLength - this.pathProgress),
      lateralError: this.lateralError,
      segmentIndex: this.segmentIndex,
      lap: geometry.loop
        ? Math.max(0, Math.floor(this.pathProgress / geometry.totalLength))
        : 0,
    };
  }
}

export function findAvoidanceSteering(
  input: VehicleFollowerInput,
  profile: VehicleNavigationProfile,
  tuning: VehiclePathFollowerTuning = {},
  fallbackSide: -1 | 1 = 1,
): { steering: number; side: -1 | 1 | null } {
  const nearestDirection = nearestPathDirection(input.path, input.pose.position);
  const travelHeading = input.pose.heading +
    (nearestDirection === 'reverse' ? Math.PI : 0);
  const forward = headingToVector(travelHeading);
  const influenceDistance =
    tuning.avoidanceDistance ??
    Math.max(9, profile.halfLength * 2 + Math.abs(input.speed) * 1.15);
  const corridor = profile.halfWidth * 2.4 +
    (tuning.obstacleHalfWidthMargin ?? 0.45);
  let leftThreat = 0;
  let rightThreat = 0;
  let centerThreat = 0;

  const accumulate = (
    longitudinal: number,
    lateral: number,
    radius: number,
    closingSpeed: number,
  ): void => {
    if (
      longitudinal <= 0 ||
      longitudinal > influenceDistance + radius ||
      Math.abs(lateral) > corridor + radius
    ) {
      return;
    }
    const freeDistance = Math.max(
      0,
      longitudinal - profile.halfLength - radius,
    );
    const proximity = clamp(1 - freeDistance / influenceDistance, 0, 1);
    const closingFactor = clamp(
      closingSpeed / Math.max(2, profile.maxSpeed * 0.5),
      0.25,
      1.4,
    );
    const threat = proximity * proximity * closingFactor;
    const centerBand = Math.max(0.28, profile.halfWidth * 0.32);
    if (lateral > centerBand) leftThreat += threat;
    else if (lateral < -centerBand) rightThreat += threat;
    else centerThreat += threat;
  };

  for (const obstacle of input.obstacles ?? []) {
    if (obstacle.blocking === false) continue;
    const relativeX = obstacle.position[0] - input.pose.position[0];
    const relativeZ = obstacle.position[2] - input.pose.position[2];
    const longitudinal = relativeX * forward[0] + relativeZ * forward[1];
    const lateral = relativeX * forward[1] - relativeZ * forward[0];
    const obstacleSpeed =
      obstacle.velocity[0] * forward[0] + obstacle.velocity[2] * forward[1];
    accumulate(
      longitudinal,
      lateral,
      obstacle.radius,
      Math.max(0, Math.abs(input.speed) - obstacleSpeed),
    );
  }
  for (const cast of input.shapeCasts ?? []) {
    accumulate(
      cast.distance,
      cast.lateralOffset,
      cast.radius ?? 0,
      cast.closingSpeed,
    );
  }

  const sideDifference = leftThreat - rightThreat;
  let side: -1 | 1 | null = null;
  if (Math.abs(sideDifference) > 0.02) {
    side = sideDifference > 0 ? 1 : -1;
  } else if (centerThreat > 0.01) {
    side = fallbackSide;
  }
  if (side === null) return { steering: 0, side: null };
  const sideThreat = Math.abs(sideDifference);
  return {
    steering: clamp(
      sideDifference + centerThreat * side + sideThreat * 0.35,
      -1,
      1,
    ),
    side,
  };
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
  const geometry = buildPathGeometry(path);
  let best: { direction: 'forward' | 'reverse'; distance: number } | null = null;
  for (const segment of geometry.segments) {
    const projection = projectOntoSegment(position, segment);
    if (!best || projection.lateralError < best.distance) {
      best = { direction: segment.direction, distance: projection.lateralError };
    }
  }
  if (best) return best.direction;
  return path.points[0]?.direction ?? 'forward';
}

function findLookAheadTarget(
  path: VehicleDrivingPath,
  geometry: PathGeometry,
  progress: number,
  position: VehicleNavPoint,
  lookAhead: number,
): VehicleDrivingPathPoint {
  if (geometry.segments.length === 0) {
    return path.points[0] ?? { position };
  }
  const segmentIndex = segmentIndexAtDistance(geometry, progress);
  const directionBoundary = distanceToDirectionChange(geometry, progress, segmentIndex);
  const boundedLookAhead = directionBoundary === null
    ? lookAhead
    : Math.min(lookAhead, directionBoundary);
  const target = samplePathAt(geometry, progress + boundedLookAhead);
  if (
    directionBoundary !== null &&
    boundedLookAhead >= directionBoundary - 1e-5
  ) {
    const current = geometry.segments[segmentIndex];
    if (current) {
      return {
        ...target,
        direction: current.direction,
        speedLimit: current.speedLimit,
      };
    }
  }
  return target;
}

function brakingHorizon(
  speed: number,
  deceleration: number,
  halfLength: number,
): number {
  const stoppingDistance = (speed * speed) / Math.max(0.5, 2 * deceleration);
  return stoppingDistance + halfLength + 2;
}

/**
 * Longitud restante del path desde la posición actual. Devuelve `null` si el
 * final está más lejos que `horizon`, para no recorrer paths de cientos de
 * puntos cuando la llegada todavía no manda.
 */
function distanceToPathEnd(
  path: VehicleDrivingPath,
  geometry: PathGeometry,
  progress: number,
  lateralError: number,
  position: VehicleNavPoint,
  horizon: number,
): number | null {
  if (path.points.length === 0) return null;
  const onlyPoint = path.points[0];
  const remaining = geometry.segments.length === 0 && onlyPoint
    ? planarDistance(position, onlyPoint.position)
    : Math.hypot(
      Math.max(0, geometry.totalLength - progress),
      Math.max(0, lateralError),
    );
  return remaining <= horizon ? remaining : null;
}

function curveSafeSpeed(
  path: VehicleDrivingPath,
  segmentIndex: number,
  maximumLateralAcceleration: number,
  fallback: number,
): number {
  let maximumCurvature = 0;
  const end = Math.min(path.points.length - 1, segmentIndex + 7);
  for (let index = Math.max(1, segmentIndex + 1); index < end; index += 1) {
    const incomingDirection = path.points[index]?.direction ?? 'forward';
    const outgoingDirection = path.points[index + 1]?.direction ?? 'forward';
    if (incomingDirection !== outgoingDirection) break;
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
  return safeSpeedForCurvature(maximumCurvature, maximumLateralAcceleration, fallback);
}

function safeSpeedForCurvature(
  curvature: number,
  maximumLateralAcceleration: number,
  fallback: number,
): number {
  if (curvature <= 1e-4) return fallback;
  return Math.min(
    fallback,
    Math.sqrt(Math.max(0.1, maximumLateralAcceleration) / curvature),
  );
}

interface PathSegment {
  start: VehicleNavPoint;
  end: VehicleNavPoint;
  startDistance: number;
  length: number;
  direction: 'forward' | 'reverse';
  speedLimit?: number;
}

interface PathGeometry {
  segments: readonly PathSegment[];
  totalLength: number;
  loop: boolean;
}

interface PathProjection {
  distance: number;
  lateralError: number;
  segmentIndex: number;
}

function buildPathGeometry(path: VehicleDrivingPath): PathGeometry {
  const segments: PathSegment[] = [];
  let distance = 0;
  const append = (
    from: VehicleDrivingPathPoint,
    to: VehicleDrivingPathPoint,
  ): void => {
    const length = planarDistance(from.position, to.position);
    if (length <= 1e-5) return;
    segments.push({
      start: from.position,
      end: to.position,
      startDistance: distance,
      length,
      direction: to.direction ?? 'forward',
      speedLimit: to.speedLimit,
    });
    distance += length;
  };
  for (let index = 1; index < path.points.length; index += 1) {
    const from = path.points[index - 1];
    const to = path.points[index];
    if (from && to) append(from, to);
  }
  if (path.loop === true && path.points.length > 1) {
    const last = path.points[path.points.length - 1];
    const first = path.points[0];
    if (last && first) append(last, first);
  }
  return { segments, totalLength: distance, loop: path.loop === true && distance > 1e-5 };
}

function projectOntoPath(
  geometry: PathGeometry,
  position: VehicleNavPoint,
  bodyHeading: number,
  currentProgress: number | null,
): PathProjection | null {
  if (geometry.segments.length === 0 || geometry.totalLength <= 1e-5) return null;
  let best: (PathProjection & { score: number }) | null = null;
  const currentLap = currentProgress === null
    ? 0
    : Math.floor(currentProgress / geometry.totalLength);

  for (let index = 0; index < geometry.segments.length; index += 1) {
    const segment = geometry.segments[index];
    if (!segment) continue;
    const local = projectOntoSegment(position, segment);
    const baseDistance = segment.startDistance + local.alpha * segment.length;
    let distance = baseDistance;
    if (currentProgress !== null && geometry.loop) {
      distance += currentLap * geometry.totalLength;
      while (distance < currentProgress - 0.75) distance += geometry.totalLength;
    }
    if (
      currentProgress !== null &&
      !geometry.loop &&
      distance < currentProgress - 0.75
    ) {
      continue;
    }
    const travelHeading = headingBetween(segment.start, segment.end);
    const expectedBodyHeading = normalizeAngle(
      travelHeading + (segment.direction === 'reverse' ? Math.PI : 0),
    );
    const headingMismatch = Math.abs(normalizeAngle(expectedBodyHeading - bodyHeading));
    const forwardJump = currentProgress === null
      ? 0
      : Math.max(0, distance - currentProgress);
    const score = local.lateralError + headingMismatch * 0.35 + forwardJump * 0.001;
    if (!best || score < best.score - 1e-6) {
      best = {
        distance,
        lateralError: local.lateralError,
        segmentIndex: index,
        score,
      };
    }
  }

  if (best) return best;
  if (currentProgress === null) return null;
  const sampled = samplePathAt(geometry, currentProgress);
  return {
    distance: currentProgress,
    lateralError: planarDistance(position, sampled.position),
    segmentIndex: segmentIndexAtDistance(geometry, currentProgress),
  };
}

function projectOntoSegment(
  position: VehicleNavPoint,
  segment: PathSegment,
): { alpha: number; lateralError: number } {
  const deltaX = segment.end[0] - segment.start[0];
  const deltaZ = segment.end[2] - segment.start[2];
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const alpha = lengthSquared <= 1e-8
    ? 0
    : clamp(
      ((position[0] - segment.start[0]) * deltaX +
        (position[2] - segment.start[2]) * deltaZ) / lengthSquared,
      0,
      1,
    );
  const projectedX = segment.start[0] + deltaX * alpha;
  const projectedZ = segment.start[2] + deltaZ * alpha;
  return {
    alpha,
    lateralError: Math.hypot(position[0] - projectedX, position[2] - projectedZ),
  };
}

function samplePathAt(
  geometry: PathGeometry,
  distance: number,
): VehicleDrivingPathPoint {
  const resolvedDistance = geometry.loop
    ? wrapPathDistance(distance, geometry.totalLength)
    : clamp(distance, 0, geometry.totalLength);
  const segmentIndex = segmentIndexAtDistance(geometry, resolvedDistance);
  const segment = geometry.segments[segmentIndex];
  if (!segment) return { position: [0, 0, 0] };
  const alpha = clamp(
    (resolvedDistance - segment.startDistance) / Math.max(1e-5, segment.length),
    0,
    1,
  );
  return {
    position: [
      segment.start[0] + (segment.end[0] - segment.start[0]) * alpha,
      segment.start[1] + (segment.end[1] - segment.start[1]) * alpha,
      segment.start[2] + (segment.end[2] - segment.start[2]) * alpha,
    ],
    direction: segment.direction,
    speedLimit: segment.speedLimit,
  };
}

function segmentIndexAtDistance(geometry: PathGeometry, distance: number): number {
  if (geometry.segments.length <= 1) return 0;
  const resolved = geometry.loop
    ? wrapPathDistance(distance, geometry.totalLength)
    : clamp(distance, 0, geometry.totalLength);
  for (let index = 0; index < geometry.segments.length; index += 1) {
    const segment = geometry.segments[index];
    if (!segment) continue;
    if (resolved < segment.startDistance + segment.length - 1e-5) return index;
  }
  return geometry.segments.length - 1;
}

function distanceToDirectionChange(
  geometry: PathGeometry,
  progress: number,
  segmentIndex: number,
): number | null {
  const current = geometry.segments[segmentIndex];
  if (!current || geometry.segments.length < 2) return null;
  const wrapped = geometry.loop
    ? wrapPathDistance(progress, geometry.totalLength)
    : clamp(progress, 0, geometry.totalLength);
  let distance = Math.max(
    0,
    current.startDistance + current.length - wrapped,
  );
  for (let offset = 1; offset < geometry.segments.length; offset += 1) {
    const nextIndex = segmentIndex + offset;
    if (!geometry.loop && nextIndex >= geometry.segments.length) return null;
    const next = geometry.segments[nextIndex % geometry.segments.length];
    if (!next) return null;
    if (next.direction !== current.direction) return distance;
    distance += next.length;
  }
  return null;
}

function wrapPathDistance(distance: number, totalLength: number): number {
  if (totalLength <= 1e-5) return 0;
  const wrapped = distance % totalLength;
  return wrapped < 0 ? wrapped + totalLength : wrapped;
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
