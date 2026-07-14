import { Vector3 } from "three";
import type { NpcMotor } from "@engine/physics/character/NpcMotor";
import type { NavigationService, NavigationAgentHandle } from "@engine/ai/navigation/NavigationService";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type {
  NavAgentProfile,
  NavigationPath,
  NavigationStatus,
} from "@engine/ai/navigation/NavigationTypes";

/** Vecino para separacion local. Datos planos: la capa game los provee. */
export interface LocomotionNeighbor {
  x: number;
  y?: number;
  z: number;
  radius: number;
}

export interface NpcLocomotionDebug {
  goal: Vector3 | null;
  waypoints: Vector3[];
  waypointCount: number;
  waypointIndex: number;
  pathPending: boolean;
  stuck: boolean;
}

export interface NavigationLocomotionOptions {
  repathThreshold?: number;
  waypointReachRadius?: number;
  goalReachRadius?: number;
  priority?: 0 | 1 | 2;
  hoverHeight?: number;
  separation?: boolean;
}

const TELEPORT_DISTANCE = 4;
const MAX_RECOVERY_ATTEMPTS = 4;
const STUCK_HOLD_TIME = 0.85;
const STUCK_MIN_SPEED = 0.12;
const SEPARATION_PADDING = 0.35;
const SEPARATION_MAX_PUSH = 0.8;

/**
 * Locomoción sobre NavigationService. Mantiene la API angosta que consume el
 * brain, pero sigue corredores Recast/aéreos y usa la velocidad predictiva de
 * Detour Crowd cuando el agente es terrestre.
 */
export class NavigationLocomotion {
  private readonly repathThreshold: number;
  private readonly waypointReachRadius: number;
  private readonly goalReachRadius: number;
  private readonly priority: 0 | 1 | 2;
  private readonly hoverHeight: number;
  private readonly separation: boolean;
  private readonly crowdAgent: NavigationAgentHandle | null;
  private readonly tmpPos = new Vector3();
  private readonly tmpLast = new Vector3();
  private readonly tmpAim = new Vector3();
  private readonly tmpVelocity = new Vector3();
  private readonly tmpSeparation = new Vector3();
  private readonly tmpFacing = new Vector3();

  private goal: Vector3 | null = null;
  private goalAtPlan = new Vector3();
  private facingTarget: Vector3 | null = null;
  private path: NavigationPath | null = null;
  private waypointIndex = 0;
  private pathPending = false;
  private neighbors: ReadonlyArray<LocomotionNeighbor> = [];
  private hasLast = false;
  private stuckTimer = 0;
  private recoveryAttempts = 0;
  private recoverySide = 1;
  private recoveryTime = 0;
  private stuck = false;
  private navStatus: NavigationStatus = "idle";
  private reservedAction: NavigationPath["actions"][number]["link"] | null = null;

  constructor(
    private readonly motor: NpcMotor,
    private readonly navigation: NavigationService,
    private readonly requests: NavigationRequestQueue,
    private readonly ownerId: string,
    readonly profile: NavAgentProfile,
    options: NavigationLocomotionOptions = {},
  ) {
    this.repathThreshold = options.repathThreshold ?? 2.25;
    this.waypointReachRadius = options.waypointReachRadius ?? Math.max(0.4, profile.radius * 1.15);
    this.goalReachRadius = options.goalReachRadius ?? Math.max(0.8, profile.radius * 1.5);
    this.priority = options.priority ?? 2;
    this.hoverHeight = options.hoverHeight ?? 0;
    this.separation = options.separation ?? true;
    this.crowdAgent = navigation.createAgent(ownerId, profile, motor.getPosition());
  }

  setNeighbors(neighbors: ReadonlyArray<LocomotionNeighbor>): void {
    this.neighbors = neighbors;
  }

  moveTo(target: Vector3, facing?: Vector3): void {
    const adjusted = this.profile.domain === "air"
      ? this.tmpAim.copy(target).add(new Vector3(0, this.hoverHeight, 0))
      : target;
    if (!this.goal || this.goal.distanceTo(adjusted) > this.repathThreshold) {
      this.goalAtPlan.copy(adjusted);
      this.requestPath(adjusted);
    }
    if (!this.goal) this.goal = adjusted.clone();
    else this.goal.copy(adjusted);
    this.facingTarget = facing ? facing.clone() : null;
    this.stuck = false;
    if (this.crowdAgent && !this.pathHasActions()) this.crowdAgent.setGoal(adjusted);
  }

  stop(): void {
    this.requests.cancel(this.ownerId);
    this.crowdAgent?.cancelGoal();
    this.goal = null;
    this.path = null;
    this.waypointIndex = 0;
    this.pathPending = false;
    this.facingTarget = null;
    this.motor.setCrouched?.(false);
    this.releaseReservation();
    this.resetProgress();
    this.navStatus = "idle";
  }

  dispose(): void {
    this.stop();
    this.crowdAgent?.dispose();
  }

  face(target: Vector3): void { this.facingTarget = this.tmpFacing.copy(target).clone(); }

  leap(target: Vector3, params: { upSpeed: number; maxForwardSpeed: number }): void {
    this.stop();
    this.facingTarget = target.clone();
    this.motor.leapTo(target, params.upSpeed, params.maxForwardSpeed);
    this.navStatus = "traversing";
  }

  isLeaping(): boolean { return this.motor.isLeaping(); }
  isStuck(): boolean { return this.stuck; }
  hasPath(): boolean { return this.path !== null && this.waypointIndex < this.path.points.length; }

  distanceToTarget(): number {
    if (!this.goal) return Number.POSITIVE_INFINITY;
    const position = this.motor.getPosition();
    return this.profile.domain === "air"
      ? position.distanceTo(this.goal)
      : planarDistance(position, this.goal);
  }

  debug(): NpcLocomotionDebug {
    return {
      goal: this.goal?.clone() ?? null,
      waypoints: this.path?.points.map((point) => point.clone()) ?? [],
      waypointCount: this.path?.points.length ?? 0,
      waypointIndex: this.waypointIndex,
      pathPending: this.pathPending,
      stuck: this.stuck,
    };
  }

  status(): NavigationStatus { return this.navStatus; }

  update(delta: number): void {
    if (this.motor.isLeaping()) {
      this.motor.update(delta, null, false, this.facingTarget);
      this.navStatus = "traversing";
      return;
    }
    if (!this.goal) {
      this.motor.setCrouched?.(false);
      this.motor.update(delta, null, false, this.facingTarget);
      this.resetProgress();
      return;
    }

    const position = this.tmpPos.copy(this.motor.getPosition());
    if (
      this.reservedAction &&
      position.distanceTo(this.reservedAction.end) <= this.waypointReachRadius * 1.75
    ) this.releaseReservation();
    this.crowdAgent?.syncPosition(position);
    if (this.hasLast && position.distanceTo(this.tmpLast) > TELEPORT_DISTANCE) {
      this.path = null;
      this.waypointIndex = 0;
      this.requestPath(this.goal);
      this.hasLast = false;
    }
    if (!this.pathPending && this.goal.distanceTo(this.goalAtPlan) > this.repathThreshold) {
      this.goalAtPlan.copy(this.goal);
      this.requestPath(this.goal);
    }

    const reached = this.profile.domain === "air"
      ? position.distanceTo(this.goal) <= this.goalReachRadius
      : planarDistance(position, this.goal) <= this.goalReachRadius &&
        Math.abs(position.y - this.goal.y) <= Math.max(1.2, this.profile.stepHeight + 0.8);
    if (reached) {
      this.motor.setCrouched?.(false);
      this.navStatus = "arrived";
      this.motor.update(delta, null, false, this.facingTarget);
      this.resetProgress();
      return;
    }

    this.advanceCorridor(position);
    if (!this.path || this.waypointIndex >= this.path.points.length) {
      this.navStatus = this.pathPending ? "blocked" : "unreachable";
      this.motor.update(delta, null, false, this.facingTarget);
      this.updateProgress(delta, position);
      return;
    }

    let aim = this.path.points[this.waypointIndex];
    const action = this.path.actions.find((item) => item.pointIndex === this.waypointIndex);
    this.motor.setCrouched?.(action?.link.kind === "crouch");
    this.navStatus = action ? "traversing" : "moving";
    if (action && action.link.kind !== "crouch" && !this.ensureReservation(action.link)) {
      this.motor.update(delta, null, false, this.facingTarget);
      this.updateProgress(delta, position, false);
      this.navStatus = "blocked";
      return;
    }
    if (action && (action.link.kind === "jump" || action.link.kind === "drop")) {
      const distance = planarDistance(position, aim);
      if (distance <= this.waypointReachRadius * 1.35) {
        this.motor.setCrouched?.(false);
        this.motor.leapTo(
          action.link.end,
          action.link.kind === "jump" ? this.profile.jumpSpeed : 0.1,
          Math.max(this.profile.maxSpeed * 1.35, 4),
        );
        this.waypointIndex += 1;
        this.navStatus = "traversing";
        this.motor.update(delta, null, false, this.facingTarget);
        this.updateProgress(delta, position);
        return;
      }
    }
    if (action?.link.kind === "door") {
      const distance = planarDistance(position, aim);
      if (distance <= this.waypointReachRadius * 1.35) {
        this.navigation.activateAction(action.link, this.ownerId);
        if (!this.navigation.isActionReady(action.link)) {
          this.motor.update(delta, null, false, this.facingTarget);
          this.updateProgress(delta, position, false);
          return;
        }
        this.waypointIndex += 1;
        if (this.path && this.waypointIndex < this.path.points.length) {
          aim = this.path.points[this.waypointIndex];
        }
      }
    }
    if (!action && this.crowdAgent && !this.pathHasActions()) {
      const velocity = this.crowdAgent.velocity(this.tmpVelocity);
      if (velocity.lengthSq() > 0.01) {
        aim = this.tmpAim.copy(position).addScaledVector(velocity, 0.6);
      }
    } else if (this.separation && !action) {
      aim = this.applySeparation(position, aim);
    }
    if (this.recoveryTime > 0) {
      this.recoveryTime = Math.max(0, this.recoveryTime - delta);
      const dx = aim.x - position.x;
      const dz = aim.z - position.z;
      const length = Math.hypot(dx, dz) || 1;
      this.tmpAim.copy(aim);
      this.tmpAim.x += (-dz / length) * this.recoverySide * 0.9;
      this.tmpAim.z += (dx / length) * this.recoverySide * 0.9;
      aim = this.tmpAim;
    }
    this.motor.update(delta, aim, true, action ? null : this.facingTarget);
    this.updateProgress(delta, position);
  }

  private advanceCorridor(position: Vector3): void {
    if (!this.path) return;
    while (this.waypointIndex < this.path.points.length) {
      const point = this.path.points[this.waypointIndex];
      const action = this.path.actions.find((item) => item.pointIndex === this.waypointIndex);
      const distance = this.profile.domain === "air"
        ? position.distanceTo(point)
        : planarDistance(position, point);
      if (distance > this.waypointReachRadius) break;
      if (action && action.link.kind !== "crouch") break;
      this.waypointIndex += 1;
    }
  }

  private requestPath(target: Vector3): void {
    if (this.profile.domain === "stationary") {
      this.path = null;
      this.navStatus = "unreachable";
      return;
    }
    this.pathPending = true;
    const requestTarget = target.clone();
    this.requests.enqueue({
      ownerId: this.ownerId,
      profile: this.profile,
      from: this.motor.getPosition().clone(),
      to: requestTarget,
      priority: this.priority,
      onResolve: (path) => {
        this.pathPending = false;
        if (!this.goal || this.goal.distanceTo(requestTarget) > this.repathThreshold * 1.5) return;
        this.path = path;
        this.waypointIndex = 0;
        if (!path) {
          this.navStatus = "unreachable";
          this.stuck = true;
          return;
        }
        this.navStatus = path.partial ? "partial" : "moving";
        if (this.crowdAgent && path.actions.length === 0) this.crowdAgent.setGoal(requestTarget);
        else this.crowdAgent?.cancelGoal();
      },
    });
  }

  private updateProgress(delta: number, position: Vector3, countAsStuck = true): void {
    if (!this.hasLast) {
      this.tmpLast.copy(position);
      this.hasLast = true;
      return;
    }
    const moved = position.distanceTo(this.tmpLast);
    if (countAsStuck && moved < STUCK_MIN_SPEED * delta) {
      this.stuckTimer += delta;
      if (this.stuckTimer >= STUCK_HOLD_TIME) {
        this.stuckTimer = 0;
        this.recoveryAttempts += 1;
        this.recoverySide *= -1;
        if (this.recoveryAttempts === 1) {
          // Correccion local: conserva corredor y prueba un side-step corto.
          this.recoveryTime = 0.45;
        } else if (this.recoveryAttempts === 2) {
          // Cede y retrocede un corner para destrabar cruces frente a frente.
          this.recoveryTime = 0.7;
          this.waypointIndex = Math.max(0, this.waypointIndex - 1);
        } else {
          // Solo después de agotar correcciones locales invalida y replanea.
          this.path = null;
          this.waypointIndex = 0;
          this.crowdAgent?.cancelGoal();
          if (this.goal) this.requestPath(this.goal);
        }
        this.stuck = this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS;
        this.navStatus = this.stuck ? "blocked" : "moving";
      }
    } else if (countAsStuck) {
      this.stuckTimer = 0;
      if (moved > 0.1) this.recoveryAttempts = Math.max(0, this.recoveryAttempts - 1);
      if (this.recoveryAttempts === 0) this.stuck = false;
    }
    this.tmpLast.copy(position);
  }

  private resetProgress(): void {
    this.hasLast = false;
    this.stuckTimer = 0;
    this.recoveryAttempts = 0;
    this.recoveryTime = 0;
    this.stuck = false;
  }

  private applySeparation(position: Vector3, aim: Vector3): Vector3 {
    if (this.neighbors.length === 0) return aim;
    const push = this.tmpSeparation.set(0, 0, 0);
    for (const neighbor of this.neighbors) {
      const dx = position.x - neighbor.x;
      const dy = this.profile.domain === "air" ? position.y - (neighbor.y ?? position.y) : 0;
      const dz = position.z - neighbor.z;
      const distance = Math.hypot(dx, dy, dz);
      const threshold = this.profile.radius + neighbor.radius + SEPARATION_PADDING;
      if (distance < 1e-4 || distance >= threshold) continue;
      const weight = (threshold - distance) / threshold;
      push.x += (dx / distance) * weight;
      push.y += (dy / distance) * weight;
      push.z += (dz / distance) * weight;
    }
    if (push.lengthSq() < 1e-4) return aim;
    push.setLength(Math.min(SEPARATION_MAX_PUSH, push.length()));
    return this.tmpAim.copy(aim).add(push);
  }

  private pathHasActions(): boolean { return (this.path?.actions.length ?? 0) > 0; }

  private ensureReservation(link: NavigationPath["actions"][number]["link"]): boolean {
    if (this.reservedAction?.id === link.id) return this.navigation.reserveAction(link, this.ownerId);
    this.releaseReservation();
    if (!this.navigation.reserveAction(link, this.ownerId)) return false;
    this.reservedAction = link;
    return true;
  }

  private releaseReservation(): void {
    if (this.reservedAction) this.navigation.releaseAction(this.reservedAction, this.ownerId);
    this.navigation.releaseAgentReservations(this.ownerId);
    this.reservedAction = null;
  }
}

function planarDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
