import type RAPIER from "@dimforge/rapier3d-compat";
import {
  CatmullRomCurve3,
  MathUtils,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import {
  captureRigidBodyState,
  copyRigidBodyState,
  createVehicleTelemetry,
  restoreRigidBodyState,
  type RigidBodyState,
  type VehicleControlInput,
  type VehicleMotor,
  type VehicleTelemetry,
} from "./VehicleMotor";

export interface RailWaypoint {
  id: string;
  position: Vector3;
  /** Target speed after reaching this point. */
  speed?: number;
  /** Wait time in seconds after reaching this point. */
  wait?: number;
  /** Roll around the forward axis in radians. */
  bank?: number;
}

export interface OnRailsVehicleMotorConfig {
  waypoints: readonly RailWaypoint[];
  loop?: boolean;
  autoStart?: boolean;
  snapToPath?: boolean;
  initialSpeed: number;
  acceleration: number;
  deceleration: number;
  orientationSmoothing: number;
  arcLengthDivisions?: number;
  /** Multiple of the cruise speed reachable on full throttle. */
  throttleBoostFactor?: number;
  /** Fraction of the cruise speed available travelling backwards. */
  reverseFactor?: number;
  /** How far the pilot may slide off the spline sideways, in metres. */
  lateralRange?: number;
  /** How fast that sideways offset follows the stick, in 1/s. */
  lateralResponse?: number;
  /** Roll applied at full lateral deflection, in radians. */
  maxControlBank?: number;
  onWaypoint?: (waypoint: Readonly<RailWaypoint>) => void;
  onComplete?: () => void;
}

const LOCAL_FORWARD = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const MIN_PATH_LENGTH = 0.0001;

/**
 * Kinematic spline follower for authored transports. It integrates speed in
 * meters instead of curve parameter units, keeping SetSpeed stable across
 * irregular waypoint spacing.
 */
export class OnRailsVehicleMotor implements VehicleMotor {
  readonly body: RAPIER.RigidBody;

  private curve: CatmullRomCurve3;
  private waypoints: readonly RailWaypoint[];
  private waypointDistances: number[] = [];
  private totalLength = 0;
  private loop: boolean;
  private distance = 0;
  private targetSpeed: number;
  private currentSpeed = 0;
  private nextWaypointIndex = 1;
  private waitRemaining = 0;
  private lateralOffset = 0;
  private controlBank = 0;
  private running: boolean;
  private enabled = true;
  private disposed = false;
  private completionEmitted = false;
  private control: VehicleControlInput = {
    throttle: 0,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
  };
  private readonly telemetry: VehicleTelemetry;

  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly targetRotation = new Quaternion();
  private readonly currentRotation = new Quaternion();
  private readonly bankRotation = new Quaternion();

  constructor(
    body: RAPIER.RigidBody,
    private readonly config: OnRailsVehicleMotorConfig,
  ) {
    if (!body.isKinematic()) {
      throw new Error("OnRailsVehicleMotor requires a kinematic rigid body.");
    }
    validateWaypoints(config.waypoints);
    this.body = body;
    this.waypoints = config.waypoints;
    this.loop = config.loop ?? false;
    this.curve = this.createCurve(this.waypoints);
    this.targetSpeed = Math.max(0, config.initialSpeed);
    this.running = config.autoStart ?? false;
    this.rebuildArcLengths();
    this.telemetry = createVehicleTelemetry(body);
    if (config.snapToPath ?? true) {
      this.snapPoseToDistance(0);
    }
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
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  start(): void {
    if (this.disposed) return;
    this.running = true;
    this.completionEmitted = false;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running && this.isEnabled();
  }

  setTargetSpeed(speed: number): void {
    this.targetSpeed = Math.max(0, speed);
  }

  getDistance(): number {
    return this.distance;
  }

  getPathLength(): number {
    return this.totalLength;
  }

  setDistance(distance: number): void {
    this.distance = this.normalizeDistance(distance);
    this.nextWaypointIndex = this.findNextWaypointIndex(this.distance);
    this.waitRemaining = 0;
    this.snapPoseToDistance(this.distance);
    this.refreshTelemetry();
  }

  setPath(
    waypoints: readonly RailWaypoint[],
    options?: { loop?: boolean; resetDistance?: boolean },
  ): void {
    validateWaypoints(waypoints);
    this.waypoints = waypoints;
    this.curve = this.createCurve(waypoints, options?.loop);
    if (options?.loop !== undefined) {
      this.loop = options.loop;
    }
    this.rebuildArcLengths();
    if (options?.resetDistance ?? true) {
      this.distance = 0;
    } else {
      this.distance = this.normalizeDistance(this.distance);
    }
    this.nextWaypointIndex = this.findNextWaypointIndex(this.distance);
    this.waitRemaining = 0;
    this.completionEmitted = false;
    this.snapPoseToDistance(this.distance);
  }

  prePhysicsStep(delta: number): void {
    if (!this.isEnabled() || delta <= 0 || !this.body.isValid()) return;

    if (this.waitRemaining > 0) {
      this.waitRemaining = Math.max(0, this.waitRemaining - delta);
      this.currentSpeed = moveToward(
        this.currentSpeed,
        0,
        this.config.deceleration * delta,
      );
      this.applyPose(delta);
      return;
    }

    const braking = Math.max(this.control.brake, this.control.handbrake);
    const desiredSpeed =
      this.running && braking < 1
        ? this.commandedSpeed() * (1 - braking)
        : 0;
    const rate =
      desiredSpeed >= this.currentSpeed
        ? this.config.acceleration
        : this.config.deceleration;
    this.currentSpeed = moveToward(
      this.currentSpeed,
      desiredSpeed,
      Math.max(0, rate) * delta,
    );

    if (this.currentSpeed !== 0 && this.running) {
      this.advance(this.currentSpeed * delta);
    }
    this.applyPose(delta);
  }

  /**
   * Cruise speed as commanded by the pilot. Neutral holds the authored speed,
   * so an unpiloted transport behaves exactly as before.
   */
  private commandedSpeed(): number {
    const throttle = this.control.throttle;
    if (throttle > 0) {
      return MathUtils.lerp(
        this.targetSpeed,
        this.targetSpeed * Math.max(1, this.config.throttleBoostFactor ?? 1),
        throttle,
      );
    }
    if (throttle < 0) {
      return MathUtils.lerp(
        this.targetSpeed,
        -this.targetSpeed * Math.max(0, this.config.reverseFactor ?? 0),
        -throttle,
      );
    }
    return this.targetSpeed;
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
    this.distance = this.projectDistance(state.position);
    this.nextWaypointIndex = this.findNextWaypointIndex(this.distance);
    const u = MathUtils.clamp(this.distance / this.totalLength, 0, 1);
    this.curve.getTangentAt(u, this.tangent).normalize();
    this.currentSpeed = Math.max(0, state.linearVelocity.dot(this.tangent));
    this.waitRemaining = 0;
    this.refreshTelemetry();
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.running = false;
  }

  private createCurve(
    waypoints: readonly RailWaypoint[],
    loop = this.loop,
  ): CatmullRomCurve3 {
    const curve = new CatmullRomCurve3(
      waypoints.map((waypoint) => waypoint.position.clone()),
      loop,
      "catmullrom",
      0.5,
    );
    const segmentCount = loop ? waypoints.length : waypoints.length - 1;
    curve.arcLengthDivisions =
      this.config.arcLengthDivisions ??
      Math.max(128, Math.max(1, segmentCount) * 64);
    return curve;
  }

  private rebuildArcLengths(): void {
    this.curve.updateArcLengths();
    const lengths = this.curve.getLengths(this.curve.arcLengthDivisions);
    this.totalLength = Math.max(
      lengths[lengths.length - 1] ?? 0,
      MIN_PATH_LENGTH,
    );
    const segmentCount = this.loop
      ? this.waypoints.length
      : this.waypoints.length - 1;
    this.waypointDistances = this.waypoints.map((_, index) => {
      if (!this.loop && index === this.waypoints.length - 1) {
        return this.totalLength;
      }
      const t = index / Math.max(segmentCount, 1);
      const sampleIndex = MathUtils.clamp(
        Math.round(t * this.curve.arcLengthDivisions),
        0,
        lengths.length - 1,
      );
      return lengths[sampleIndex] ?? t * this.totalLength;
    });
  }

  private advance(travel: number): void {
    if (travel < 0) {
      // Retroceder no vuelve a disparar los waypoints: son disparadores
      // autorales de un solo sentido, no marcas de posición.
      this.distance = this.normalizeDistance(this.distance + travel);
      this.nextWaypointIndex = this.findNextWaypointIndex(this.distance);
      return;
    }
    let remaining = Math.max(0, travel);
    let guard = this.waypoints.length * 2 + 2;
    while (remaining > 0.000001 && guard > 0) {
      guard -= 1;
      const waypointDistance =
        this.waypointDistances[this.nextWaypointIndex] ?? this.totalLength;
      const distanceToWaypoint = Math.max(0, waypointDistance - this.distance);
      if (remaining + 0.000001 < distanceToWaypoint) {
        this.distance += remaining;
        return;
      }

      this.distance = waypointDistance;
      remaining -= distanceToWaypoint;
      const waypoint = this.waypoints[this.nextWaypointIndex];
      if (waypoint) {
        this.config.onWaypoint?.(waypoint);
        if (waypoint.speed !== undefined) {
          this.targetSpeed = Math.max(0, waypoint.speed);
        }
        this.nextWaypointIndex += 1;
        if ((waypoint.wait ?? 0) > 0) {
          this.waitRemaining = waypoint.wait ?? 0;
          return;
        }
      }

      if (this.distance >= this.totalLength - 0.000001) {
        if (this.loop) {
          this.distance = 0;
          this.nextWaypointIndex = 1;
        } else {
          this.distance = this.totalLength;
          this.currentSpeed = 0;
          this.running = false;
          if (!this.completionEmitted) {
            this.completionEmitted = true;
            this.config.onComplete?.();
          }
          return;
        }
      }
    }
  }

  private applyPose(delta: number): void {
    const u = MathUtils.clamp(this.distance / this.totalLength, 0, 1);
    this.curve.getPointAt(u, this.point);
    this.curve.getTangentAt(u, this.tangent).normalize();

    // Corredor lateral: el trazado sigue mandando, pero el piloto puede
    // desplazarse dentro de él. Sin esto el timón no haría absolutamente nada.
    const range = this.config.lateralRange ?? 0;
    if (range > 0) {
      // `this.right` es Y × tangente = +X con la tangente en +Z, o sea la
      // IZQUIERDA del piloto: el desplazamiento va con el signo cambiado.
      this.lateralOffset = MathUtils.lerp(
        this.lateralOffset,
        -this.control.steering * range,
        1 - Math.exp(-(this.config.lateralResponse ?? 4) * delta),
      );
    }
    // Alabeo hacia adentro del viraje: al irse a estribor baja el ala de -X.
    this.controlBank =
      range > 0
        ? (-this.lateralOffset / range) * (this.config.maxControlBank ?? 0)
        : 0;
    this.buildTargetRotation(u);
    if (range > 0) {
      this.point.addScaledVector(this.right, this.lateralOffset);
    }

    const current = this.body.rotation();
    this.currentRotation.set(current.x, current.y, current.z, current.w);
    if (this.config.orientationSmoothing > 0) {
      this.currentRotation.slerp(
        this.targetRotation,
        1 - Math.exp(-this.config.orientationSmoothing * delta),
      );
    } else {
      this.currentRotation.copy(this.targetRotation);
    }
    this.body.setNextKinematicTranslation(this.point);
    this.body.setNextKinematicRotation(this.currentRotation);
  }

  private snapPoseToDistance(distance: number): void {
    this.lateralOffset = 0;
    this.controlBank = 0;
    const u = MathUtils.clamp(distance / this.totalLength, 0, 1);
    this.curve.getPointAt(u, this.point);
    this.curve.getTangentAt(u, this.tangent).normalize();
    this.buildTargetRotation(u);
    this.body.setTranslation(this.point, true);
    this.body.setRotation(this.targetRotation, true);
    this.body.setNextKinematicTranslation(this.point);
    this.body.setNextKinematicRotation(this.targetRotation);
  }

  private buildTargetRotation(u: number): void {
    this.right.crossVectors(WORLD_UP, this.tangent);
    if (this.right.lengthSq() < 0.000001) {
      this.right.set(1, 0, 0);
    } else {
      this.right.normalize();
    }
    this.up.crossVectors(this.tangent, this.right).normalize();
    this.matrix.makeBasis(this.right, this.up, this.tangent);
    this.targetRotation.setFromRotationMatrix(this.matrix);
    const bank = this.sampleBank(u) + this.controlBank;
    if (Math.abs(bank) > 0.000001) {
      this.bankRotation.setFromAxisAngle(LOCAL_FORWARD, bank);
      this.targetRotation.multiply(this.bankRotation);
    }
  }

  private sampleBank(u: number): number {
    const distance = u * this.totalLength;
    let previousIndex = 0;
    for (let index = 1; index < this.waypointDistances.length; index += 1) {
      if (this.waypointDistances[index] >= distance) {
        const startDistance = this.waypointDistances[previousIndex] ?? 0;
        const endDistance =
          this.waypointDistances[index] ?? this.totalLength;
        const alpha =
          endDistance > startDistance
            ? (distance - startDistance) / (endDistance - startDistance)
            : 0;
        return MathUtils.lerp(
          this.waypoints[previousIndex]?.bank ?? 0,
          this.waypoints[index]?.bank ?? 0,
          alpha,
        );
      }
      previousIndex = index;
    }
    return this.waypoints[this.waypoints.length - 1]?.bank ?? 0;
  }

  private normalizeDistance(distance: number): number {
    if (this.loop) {
      return ((distance % this.totalLength) + this.totalLength) % this.totalLength;
    }
    return MathUtils.clamp(distance, 0, this.totalLength);
  }

  private findNextWaypointIndex(distance: number): number {
    const index = this.waypointDistances.findIndex(
      (waypointDistance, waypointIndex) =>
        waypointIndex > 0 && waypointDistance > distance + 0.000001,
    );
    return index >= 0 ? index : this.waypoints.length;
  }

  private projectDistance(position: Readonly<Vector3>): number {
    const divisions = this.curve.arcLengthDivisions;
    const lengths = this.curve.getLengths(divisions);
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestDistance = 0;
    for (let index = 0; index <= divisions; index += 1) {
      this.curve.getPoint(index / divisions, this.point);
      const distanceSq = this.point.distanceToSquared(position);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestDistance = lengths[index] ?? 0;
      }
    }
    return this.normalizeDistance(bestDistance);
  }

  private refreshTelemetry(): void {
    copyRigidBodyState(this.telemetry.state, this.body);
    const velocity = this.body.linvel();
    this.telemetry.speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    this.telemetry.forwardSpeed = this.currentSpeed;
    this.telemetry.engineRpm = MathUtils.lerp(
      700,
      5200,
      MathUtils.clamp(
        this.currentSpeed / Math.max(this.targetSpeed, 0.001),
        0,
        1,
      ),
    );
    this.telemetry.steering = this.control.steering;
    this.telemetry.contactCount = 0;
    this.telemetry.grounded = false;
    this.telemetry.submergedRatio = 0;
  }
}

function validateWaypoints(waypoints: readonly RailWaypoint[]): void {
  if (waypoints.length < 2) {
    throw new Error("OnRailsVehicleMotor requires at least two waypoints.");
  }
  const ids = new Set<string>();
  for (const waypoint of waypoints) {
    if (ids.has(waypoint.id)) {
      throw new Error(`Duplicate waypoint: ${waypoint.id}.`);
    }
    ids.add(waypoint.id);
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
