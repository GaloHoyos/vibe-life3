import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type { NavigationPath } from "@engine/ai/navigation/NavigationTypes";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { BlobConfig } from "@game/config/blob.config";
import { NavigationProfiles } from "@game/npc/navigation/NavAgentProfiles";

export interface BlobChunkNavigationMember {
  index: number;
  body: RAPIER.RigidBody;
  supported: boolean;
}

interface BlobChunkNavigationState {
  ownerId: string;
  path: NavigationPath | null;
  waypointIndex: number;
  pending: boolean;
  retryRemaining: number;
  goalAtPlan: Vector3 | null;
  requestSerial: number;
  lastCenter: Vector3 | null;
  stuckElapsed: number;
  paused: boolean;
  recoveryRemaining: number;
  recoverySide: 1 | -1;
}

interface BlobChunkNavigatorOptions {
  ownerId: string;
  navigation: NavigationService;
  requests: NavigationRequestQueue;
  physics: PhysicsWorld;
}

/**
 * Planner/follower de los componentes desprendidos. El path se calcula por
 * racimo y su aceleración común se aplica como impulso proporcional a la masa:
 * así navega el conjunto sin convertir los resortes internos en locomoción.
 */
export class BlobChunkNavigator {
  private readonly states = new Map<string, BlobChunkNavigationState>();
  private readonly lastGoal = new Vector3();
  private readonly goalVelocity = new Vector3();
  private hasGoalSample = false;

  constructor(private readonly options: BlobChunkNavigatorOptions) {}

  update(
    delta: number,
    components: readonly (readonly BlobChunkNavigationMember[])[],
    rawGoal: Vector3,
  ): void {
    const elapsed = finiteNavigationElapsed(delta);
    if (elapsed <= 0) return;
    this.updateGoalVelocity(elapsed, rawGoal);

    const activeSignatures = new Set<string>();
    for (const source of components) {
      const members = source.filter((member) => member.body.isValid());
      if (members.length === 0) continue;
      const signature = navigationComponentSignature(members);
      activeSignatures.add(signature);
      let state = this.states.get(signature);
      if (!state) {
        state = {
          ownerId: `${this.options.ownerId}:blob-chunk:${signature}`,
          path: null,
          waypointIndex: 0,
          pending: false,
          retryRemaining: 0,
          goalAtPlan: null,
          requestSerial: 0,
          lastCenter: null,
          stuckElapsed: 0,
          paused: false,
          recoveryRemaining: 0,
          recoverySide: members[0].index % 2 === 0 ? 1 : -1,
        };
        this.states.set(signature, state);
      }
      state.retryRemaining = Math.max(0, state.retryRemaining - elapsed);
      state.recoveryRemaining = Math.max(
        0,
        state.recoveryRemaining - elapsed,
      );

      const motion = componentMotion(members);
      if (!motion) continue;
      const paused =
        members.some((member) =>
          this.options.physics.isHeldBody(member.body.handle),
        ) || !members.some((member) => member.supported);
      if (paused) {
        if (!state.paused) {
          this.invalidatePath(state);
          state.paused = true;
        }
        this.resetProgress(state, motion.center);
        continue;
      }
      if (state.paused) {
        state.paused = false;
        // La caida o la Gravity Gun pueden haber llevado el racimo a otro
        // corredor. Al recuperar apoyo se planifica desde su COM real.
        this.invalidatePath(state);
        this.resetProgress(state, motion.center);
      } else if (
        state.lastCenter &&
        planarDistance(state.lastCenter, motion.center) >=
          BlobConfig.armor.chunkNavigationOriginRepathDistance
      ) {
        // Tambien cubre teleports o empujones externos mientras sigue apoyado.
        this.invalidatePath(state);
        this.resetProgress(state, motion.center);
      }
      const pursuitGoal = this.predictPursuitGoal(motion.center, rawGoal);
      this.refreshPath(signature, state, motion.center, pursuitGoal);
      const following = this.followPath(
        state,
        members,
        motion,
        rawGoal,
        elapsed,
      );
      this.updateProgress(state, motion.center, following, elapsed);
    }

    for (const [signature, state] of this.states) {
      if (activeSignatures.has(signature)) continue;
      this.options.requests.cancel(state.ownerId);
      this.states.delete(signature);
    }
  }

  clear(): void {
    for (const state of this.states.values()) {
      this.options.requests.cancel(state.ownerId);
    }
    this.states.clear();
    this.hasGoalSample = false;
    this.goalVelocity.set(0, 0, 0);
  }

  dispose(): void {
    this.clear();
  }

  private updateGoalVelocity(elapsed: number, rawGoal: Vector3): void {
    const config = BlobConfig.armor;
    if (!this.hasGoalSample) {
      this.lastGoal.copy(rawGoal);
      this.goalVelocity.set(0, 0, 0);
      this.hasGoalSample = true;
      return;
    }

    const displacement = rawGoal.clone().sub(this.lastGoal);
    displacement.y = 0;
    if (displacement.length() >= config.chunkNavigationGoalTeleportDistance) {
      this.goalVelocity.set(0, 0, 0);
    } else {
      displacement.multiplyScalar(1 / elapsed);
      const response = 1 - Math.exp(
        -config.chunkNavigationGoalVelocityResponse * elapsed,
      );
      this.goalVelocity.lerp(displacement, response);
      this.goalVelocity.y = 0;
    }
    this.lastGoal.copy(rawGoal);
  }

  private predictPursuitGoal(center: Vector3, rawGoal: Vector3): Vector3 {
    const config = BlobConfig.armor;
    const distance = planarDistance(center, rawGoal);
    const leadSeconds = Math.min(
      config.chunkNavigationPredictionMaxSeconds,
      (distance / Math.max(0.1, config.chunkNavigationCatchupMaxSpeed)) *
        config.chunkNavigationPredictionScale,
    );
    const lead = this.goalVelocity.clone().multiplyScalar(leadSeconds);
    const maximumLead = config.chunkNavigationPredictionMaxDistance;
    if (lead.lengthSq() > maximumLead * maximumLead) {
      lead.setLength(maximumLead);
    }
    return rawGoal.clone().add(lead);
  }

  private refreshPath(
    signature: string,
    state: BlobChunkNavigationState,
    center: Vector3,
    rawGoal: Vector3,
  ): void {
    const config = BlobConfig.armor;
    const goalMoved =
      state.goalAtPlan !== null &&
      state.goalAtPlan.distanceTo(rawGoal) >=
        config.chunkNavigationRepathDistance;
    const pathFinished =
      state.path !== null && state.waypointIndex >= state.path.points.length;
    if (
      state.pending ||
      (!goalMoved &&
        state.path !== null &&
        !pathFinished) ||
      (!goalMoved && state.retryRemaining > 0)
    ) {
      return;
    }

    const from = this.options.navigation.projectPoint(
      center,
      NavigationProfiles.blobFragment,
    );
    const goal = this.options.navigation.projectPoint(
      rawGoal,
      NavigationProfiles.blobFragment,
    );
    if (!from || !goal) {
      state.path = null;
      state.waypointIndex = 0;
      state.retryRemaining = config.chunkNavigationRetrySeconds;
      return;
    }

    state.pending = true;
    state.goalAtPlan = rawGoal.clone();
    state.requestSerial += 1;
    const requestSerial = state.requestSerial;
    this.options.requests.enqueue({
      ownerId: state.ownerId,
      profile: NavigationProfiles.blobFragment,
      from,
      to: goal,
      priority: config.chunkNavigationRequestPriority,
      onResolve: (path) => {
        const current = this.states.get(signature);
        if (current !== state || state.requestSerial !== requestSerial) return;
        state.pending = false;
        state.path = path;
        state.waypointIndex = 0;
        state.retryRemaining = config.chunkNavigationRetrySeconds;
        state.stuckElapsed = 0;
      },
    });
  }

  private followPath(
    state: BlobChunkNavigationState,
    members: readonly BlobChunkNavigationMember[],
    motion: ComponentMotion,
    rawGoal: Vector3,
    elapsed: number,
  ): boolean {
    const path = state.path;
    if (!path) return false;
    const config = BlobConfig.armor;
    while (state.waypointIndex < path.points.length) {
      const waypoint = path.points[state.waypointIndex];
      if (
        planarDistance(motion.center, waypoint) >
        config.chunkNavigationWaypointReachRadius
      ) {
        break;
      }
      state.waypointIndex += 1;
    }
    if (state.waypointIndex >= path.points.length) return false;

    const waypoint = path.points[state.waypointIndex];
    const desiredVelocity = new Vector3(
      waypoint.x - motion.center.x,
      0,
      waypoint.z - motion.center.z,
    );
    const distance = desiredVelocity.length();
    if (distance <= 1e-5) return false;
    const goalDistance = planarDistance(motion.center, rawGoal);
    const catchup = inverseLerp(
      config.chunkNavigationCatchupStartDistance,
      config.chunkNavigationCatchupFullDistance,
      goalDistance,
    );
    const maximumSpeed = lerp(
      config.chunkNavigationMaxSpeed,
      config.chunkNavigationCatchupMaxSpeed,
      catchup,
    );
    const speedControlDistance = Math.max(
      distance,
      goalDistance * config.chunkNavigationGoalSpeedInfluence,
    );
    const forwardX = desiredVelocity.x / distance;
    const forwardZ = desiredVelocity.z / distance;
    const pursuitSpeed =
      Math.max(
        0,
        this.goalVelocity.x * forwardX + this.goalVelocity.z * forwardZ,
      ) * config.chunkNavigationGoalVelocityInfluence +
      config.chunkNavigationClosingSpeed;
    const desiredSpeed = Math.min(
      maximumSpeed,
      Math.max(
        config.chunkNavigationMinimumSpeed,
        speedControlDistance * config.chunkNavigationPositionGain,
        pursuitSpeed,
      ),
    );
    if (state.recoveryRemaining > 0) {
      desiredVelocity.set(
        forwardX * desiredSpeed * config.chunkNavigationRecoveryForwardScale -
          forwardZ *
            state.recoverySide *
            maximumSpeed *
            config.chunkNavigationRecoveryLateralScale,
        0,
        forwardZ * desiredSpeed * config.chunkNavigationRecoveryForwardScale +
          forwardX *
            state.recoverySide *
            maximumSpeed *
            config.chunkNavigationRecoveryLateralScale,
      );
      if (desiredVelocity.lengthSq() > maximumSpeed * maximumSpeed) {
        desiredVelocity.setLength(maximumSpeed);
      }
    } else {
      desiredVelocity.multiplyScalar(desiredSpeed / distance);
    }
    const velocityDelta = desiredVelocity.sub(motion.averageVelocity);
    velocityDelta.y = 0;
    const maxDelta = config.chunkNavigationAcceleration * elapsed;
    if (velocityDelta.lengthSq() > maxDelta * maxDelta) {
      velocityDelta.setLength(maxDelta);
    }
    for (const member of members) {
      const mass = Math.max(1e-4, member.body.mass());
      member.body.applyImpulse(
        velocityDelta.clone().multiplyScalar(mass),
        true,
      );
    }
    return true;
  }

  private updateProgress(
    state: BlobChunkNavigationState,
    center: Vector3,
    following: boolean,
    elapsed: number,
  ): void {
    if (!following) {
      this.resetProgress(state, center);
      return;
    }
    const config = BlobConfig.armor;
    if (state.lastCenter) {
      const moved = planarDistance(state.lastCenter, center);
      if (moved < config.chunkNavigationMinimumProgressSpeed * elapsed) {
        state.stuckElapsed += elapsed;
      } else {
        state.stuckElapsed = Math.max(0, state.stuckElapsed - elapsed * 2);
      }
      if (state.stuckElapsed >= config.chunkNavigationStuckSeconds) {
        state.recoverySide = state.recoverySide === 1 ? -1 : 1;
        state.recoveryRemaining = config.chunkNavigationRecoverySeconds;
        // Un replan desde el mismo punto suele devolver el mismo corredor. El
        // sesgo lateral de recovery desplaza primero el COM físico y hace que
        // la consulta siguiente tenga una alternativa real.
        this.invalidatePath(state, true);
      }
      state.lastCenter.copy(center);
    } else {
      state.lastCenter = center.clone();
    }
  }

  private resetProgress(
    state: BlobChunkNavigationState,
    center: Vector3,
  ): void {
    state.stuckElapsed = 0;
    if (state.lastCenter) state.lastCenter.copy(center);
    else state.lastCenter = center.clone();
  }

  private invalidatePath(
    state: BlobChunkNavigationState,
    preserveRecovery = false,
  ): void {
    this.options.requests.cancel(state.ownerId);
    state.requestSerial += 1;
    state.pending = false;
    state.path = null;
    state.waypointIndex = 0;
    state.retryRemaining = 0;
    state.goalAtPlan = null;
    state.stuckElapsed = 0;
    if (!preserveRecovery) {
      state.recoveryRemaining = 0;
    }
  }
}

interface ComponentMotion {
  center: Vector3;
  averageVelocity: Vector3;
}

function componentMotion(
  members: readonly BlobChunkNavigationMember[],
): ComponentMotion | null {
  let totalMass = 0;
  const center = new Vector3();
  const averageVelocity = new Vector3();
  for (const member of members) {
    if (!member.body.isValid()) continue;
    const mass = Math.max(1e-4, member.body.mass());
    const position = member.body.translation();
    const velocity = member.body.linvel();
    totalMass += mass;
    center.addScaledVector(
      new Vector3(position.x, position.y, position.z),
      mass,
    );
    averageVelocity.addScaledVector(
      new Vector3(velocity.x, 0, velocity.z),
      mass,
    );
  }
  if (totalMass <= 1e-4) return null;
  center.multiplyScalar(1 / totalMass);
  averageVelocity.multiplyScalar(1 / totalMass);
  return { center, averageVelocity };
}

function navigationComponentSignature(
  members: readonly BlobChunkNavigationMember[],
): string {
  return members
    .map((member) => member.index)
    .sort((a, b) => a - b)
    .join(":");
}

function planarDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function inverseLerp(minimum: number, maximum: number, value: number): number {
  if (maximum <= minimum) return value >= maximum ? 1 : 0;
  return Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function finiteNavigationElapsed(delta: number): number {
  return Number.isFinite(delta)
    ? Math.min(Math.max(0, delta), 1 / 20)
    : 0;
}
