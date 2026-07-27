import { Vector3 } from "three";
import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";
import type { NpcBehaviorController } from "@game/npc/core/NpcBehaviorController";
import type { NpcLocomotionHandle } from "@game/npc/brain/NpcBrainContext";
import type {
  OrganicMatterHandle,
  OrganicPullSettings,
} from "@game/gameplay/organic/OrganicMatter";
import { BlobConfig } from "@game/config/blob.config";
import { NpcDebugFlags } from "@game/npc/core/NpcDebugFlags";

const CORPSE_PULL_SETTINGS = {
  positionGain: BlobConfig.predator.corpsePullPositionGain,
  maxSpeed: BlobConfig.predator.corpsePullMaxSpeed,
  acceleration: BlobConfig.predator.corpsePullAcceleration,
} satisfies OrganicPullSettings;

export interface BlobFeedingBody {
  setFeedingTarget(
    position: Vector3,
    radius: number,
    requestedCoverage01: number,
  ): void;
  clearFeedingTarget(): void;
  getFeedingCoverage(): number;
  addOrganicMass(nodeCount: number): void;
}

type PredatorPhase =
  | "searching"
  | "prowling"
  | "approaching"
  | "repositioning"
  | "embracing"
  | "digesting";

/**
 * Caza organica del Blob. La seleccion ignora facciones a proposito y conserva
 * un claim exclusivo sobre la presa durante toda la transicion vivo -> ragdoll
 * -> digestion. Los fragmentos desprendidos no participan: su navigator sigue
 * teniendo como unico objetivo volver al cuerpo principal.
 */
export class BlobPredatorController implements NpcBehaviorController {
  private phase: PredatorPhase = "searching";
  private target: OrganicMatterHandle | null = null;
  private targetSnapshot: ActorSnapshot | null = null;
  private embraceElapsed = 0;
  private digestionElapsed = 0;
  private damageCooldown = 0;
  private approachStallElapsed = 0;
  private lastApproachDistance = Number.POSITIVE_INFINITY;
  private approachRecoveryAttempts = 0;
  private approachRecoveryRemaining = 0;
  private embraceStallElapsed = 0;
  private bestEmbraceCoverage = 0;
  private searchPauseRemaining = 0;
  private searchRoamRemaining = 0;
  private searchTargetActive = false;
  private searchAnchorInitialized = false;
  private thoughtSequence = 0;
  private defensiveTargetId: string | null = null;
  private disposed = false;
  private readonly targetCooldowns = new Map<string, number>();
  private readonly targetPosition = new Vector3();
  private readonly digestionTarget = new Vector3();
  private readonly attackDirection = new Vector3();
  private readonly approachRecoveryTarget = new Vector3();
  private readonly searchAnchor = new Vector3();
  private readonly searchTarget = new Vector3();
  private readonly thoughtSeed: number;

  constructor(
    private readonly id: string,
    private readonly body: BlobFeedingBody,
    private readonly getCorePosition: () => Vector3,
  ) {
    this.thoughtSeed = hashString(id);
  }

  update(
    ctx: AiFrameContext,
    locomotion: NpcLocomotionHandle,
    urgentThreat?: ActorSnapshot | null,
  ): ActorSnapshot | null {
    if (this.disposed) return null;
    const delta = finiteDelta(ctx.delta);
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);
    this.tickTargetCooldowns(delta);

    this.refreshTargetSnapshot(ctx);
    if (NpcDebugFlags.ignorePlayer && this.target?.id === ctx.player.id) {
      this.releaseTarget();
      this.body.clearFeedingTarget();
    }
    this.prioritizeUrgentThreat(
      NpcDebugFlags.ignorePlayer && urgentThreat?.id === ctx.player.id
        ? null
        : urgentThreat,
    );
    if (!NpcDebugFlags.ignorePlayer && this.defensiveTargetId === null) {
      this.prioritizePlayer(ctx);
    }
    if (!this.validateTarget()) this.acquireTarget(ctx);
    const target = this.target;
    if (!target) {
      this.updateSearching(delta, locomotion);
      return null;
    }

    target.getPosition(this.targetPosition);
    const corePosition = this.getCorePosition();
    const distance = planarDistance(corePosition, this.targetPosition);
    const contactDistance = corePosition.distanceTo(this.targetPosition);
    const embraceDistance =
      BlobConfig.predator.coreEmbraceDistance +
      target.radius +
      BlobConfig.predator.embraceContactPadding;
    const releaseDistance =
      embraceDistance + BlobConfig.predator.embraceReleasePadding;
    const canMaintainEmbrace =
      this.phase === "embracing" || this.phase === "digesting";

    if (this.approachRecoveryRemaining > 0) {
      return this.updateApproach(ctx, locomotion, distance, delta);
    }

    // Si una presa/ragdoll se aleja durante el abrazo, el gel se recoge y el
    // core vuelve a navegar. El claim permanece para no alternar objetivos.
    if (
      contactDistance >
      (canMaintainEmbrace ? releaseDistance : embraceDistance)
    ) {
      this.embraceElapsed = 0;
      this.digestionElapsed = 0;
      this.resetEmbraceTracking();
      target.setRestraint(this.id, 0);
      target.setDigestionProgress(this.id, 0);
      this.body.clearFeedingTarget();
      return this.updateApproach(ctx, locomotion, distance, delta);
    }

    this.pauseApproachTracking();
    locomotion.stop();
    locomotion.face(this.targetPosition);
    if (this.phase !== "digesting") this.phase = "embracing";
    this.embraceElapsed = Math.min(
      BlobConfig.predator.embraceRampSeconds,
      this.embraceElapsed + delta,
    );
    const requestedCoverage = Math.min(
      1,
      this.embraceElapsed / BlobConfig.predator.embraceRampSeconds,
    );
    this.body.setFeedingTarget(
      this.targetPosition,
      target.radius,
      requestedCoverage,
    );
    const physicalCoverage = Math.min(
      requestedCoverage,
      this.body.getFeedingCoverage(),
    );
    target.setRestraint(this.id, physicalCoverage);

    if (
      this.tickEmbraceStall(
        target,
        requestedCoverage,
        physicalCoverage,
        delta,
      )
    ) {
      target.setRestraint(this.id, 0);
      target.setDigestionProgress(this.id, 0);
      this.body.clearFeedingTarget();
      this.embraceElapsed = 0;
      this.digestionElapsed = 0;
      if (
        this.approachRecoveryAttempts <
        BlobConfig.predator.approachMaxRecoveryAttempts
      ) {
        this.beginApproachRecovery(locomotion);
        return this.targetSnapshot;
      }
      return this.abandonBlockedTarget(ctx, locomotion);
    }

    if (target.isAlive()) {
      this.tickLivingPrey(target, physicalCoverage, corePosition);
    } else {
      this.digestionTarget.copy(corePosition);
      this.digestionTarget.y += BlobConfig.predator.corpsePullCoreHeight;
      target.pullToward(
        this.id,
        this.digestionTarget,
        delta,
        CORPSE_PULL_SETTINGS,
      );
      if (
        this.phase === "digesting" ||
        physicalCoverage >= BlobConfig.predator.digestionCoverageThreshold
      ) {
        if (this.tickDigestion(target, delta)) {
          this.acquireTarget(ctx);
          if (this.target) {
            this.target.getPosition(this.targetPosition);
            this.commandDirectApproach(locomotion);
            return this.targetSnapshot;
          }
          this.updateSearching(0, locomotion);
          return null;
        }
      }
    }
    return this.targetSnapshot;
  }

  getState(): string {
    return `blob-${this.phase}`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseTarget();
    this.body.clearFeedingTarget();
  }

  private tickLivingPrey(
    target: OrganicMatterHandle,
    physicalCoverage: number,
    corePosition: Vector3,
  ): void {
    if (
      physicalCoverage < BlobConfig.predator.damageCoverageThreshold ||
      this.damageCooldown > 0
    ) {
      return;
    }
    this.damageCooldown = BlobConfig.predator.damageIntervalSeconds;
    this.attackDirection.copy(this.targetPosition).sub(corePosition);
    if (this.attackDirection.lengthSq() <= 1e-6) {
      this.attackDirection.set(0, 0.15, 1);
    } else {
      this.attackDirection.normalize();
    }
    const entity = this.targetSnapshot?.entity;
    entity?.applyDamage(
      BlobConfig.predator.damagePerPulse,
      this.attackDirection,
      undefined,
      this.id,
      this.targetPosition,
      "melee",
    );
    if (!target.isAlive()) {
      if (this.defensiveTargetId === target.id) {
        this.defensiveTargetId = null;
      }
      this.phase =
        physicalCoverage >= BlobConfig.predator.digestionCoverageThreshold
          ? "digesting"
          : "embracing";
      this.digestionElapsed = 0;
    }
  }

  private tickDigestion(
    target: OrganicMatterHandle,
    delta: number,
  ): boolean {
    this.phase = "digesting";
    this.digestionElapsed = Math.min(
      BlobConfig.predator.digestionSeconds,
      this.digestionElapsed + delta,
    );
    const progress =
      this.digestionElapsed / BlobConfig.predator.digestionSeconds;
    target.setDigestionProgress(this.id, progress);
    if (progress < 1) return false;

    const gained = target.consume(this.id);
    if (gained > 0) this.body.addOrganicMass(gained);
    this.target = null;
    this.targetSnapshot = null;
    this.phase = "searching";
    this.embraceElapsed = 0;
    this.digestionElapsed = 0;
    this.resetApproachTracking();
    this.beginSearchPause();
    this.searchAnchor.copy(this.getCorePosition());
    this.searchAnchorInitialized = true;
    this.body.clearFeedingTarget();
    return true;
  }

  private updateApproach(
    ctx: AiFrameContext,
    locomotion: NpcLocomotionHandle,
    distance: number,
    delta: number,
  ): ActorSnapshot | null {
    const config = BlobConfig.predator;
    if (this.approachRecoveryRemaining > 0) {
      this.approachRecoveryRemaining = Math.max(
        0,
        this.approachRecoveryRemaining - delta,
      );
      const reachedRecovery =
        locomotion.distanceToTarget() <=
        config.navigationGoalReachRadius + 0.2;
      if (locomotion.isStuck()) {
        if (
          this.approachRecoveryAttempts >=
          config.approachMaxRecoveryAttempts
        ) {
          return this.abandonBlockedTarget(ctx, locomotion);
        }
        this.beginApproachRecovery(locomotion);
        return this.targetSnapshot;
      }
      if (!reachedRecovery && this.approachRecoveryRemaining > 0) {
        this.phase = "repositioning";
        locomotion.moveTo(this.approachRecoveryTarget, {
          gait: "walk",
          facing: this.targetPosition,
        });
        return this.targetSnapshot;
      }
      this.approachRecoveryRemaining = 0;
      this.approachStallElapsed = 0;
      this.lastApproachDistance = distance;
    }

    if (!Number.isFinite(this.lastApproachDistance)) {
      this.lastApproachDistance = distance;
      this.approachStallElapsed = 0;
    } else if (
      this.lastApproachDistance - distance >=
      config.approachProgressDistance
    ) {
      this.lastApproachDistance = distance;
      this.approachStallElapsed = 0;
    } else {
      this.approachStallElapsed += delta;
    }

    if (
      locomotion.isStuck() ||
      this.approachStallElapsed >= config.approachStallSeconds
    ) {
      if (
        this.approachRecoveryAttempts < config.approachMaxRecoveryAttempts
      ) {
        this.beginApproachRecovery(locomotion);
        return this.targetSnapshot;
      }
      return this.abandonBlockedTarget(ctx, locomotion);
    }

    this.commandDirectApproach(locomotion);
    return this.targetSnapshot;
  }

  private commandDirectApproach(
    locomotion: NpcLocomotionHandle,
  ): void {
    this.phase = "approaching";
    locomotion.moveTo(this.targetPosition, {
      gait: "walk",
      facing: this.targetPosition,
    });
  }

  private beginApproachRecovery(
    locomotion: NpcLocomotionHandle,
  ): void {
    const config = BlobConfig.predator;
    this.approachRecoveryAttempts += 1;
    this.approachRecoveryRemaining = config.approachRecoverySeconds;
    this.approachStallElapsed = 0;
    this.resetEmbraceTracking();
    const targetSeed = hashString(this.target?.id ?? this.id);
    const angle =
      deterministicUnit(
        this.thoughtSeed ^ targetSeed,
        this.approachRecoveryAttempts,
      ) *
      Math.PI *
      2;
    this.approachRecoveryTarget.set(
      this.targetPosition.x +
        Math.cos(angle) * config.approachRecoveryRadius,
      this.targetPosition.y,
      this.targetPosition.z +
        Math.sin(angle) * config.approachRecoveryRadius,
    );
    this.phase = "repositioning";
    locomotion.moveTo(this.approachRecoveryTarget, {
      gait: "walk",
      facing: this.targetPosition,
    });
  }

  private abandonBlockedTarget(
    ctx: AiFrameContext,
    locomotion: NpcLocomotionHandle,
  ): ActorSnapshot | null {
    const blockedId = this.target?.id;
    if (blockedId) {
      this.targetCooldowns.set(
        blockedId,
        BlobConfig.predator.blockedTargetRetrySeconds,
      );
    }
    this.releaseTarget();
    this.body.clearFeedingTarget();
    this.acquireTarget(ctx);
    if (this.target) {
      this.target.getPosition(this.targetPosition);
      this.commandDirectApproach(locomotion);
      return this.targetSnapshot;
    }
    this.beginSearchPause();
    this.updateSearching(0, locomotion);
    return null;
  }

  private updateSearching(
    delta: number,
    locomotion: NpcLocomotionHandle,
  ): void {
    const config = BlobConfig.predator;
    const core = this.getCorePosition();
    this.body.clearFeedingTarget();
    if (!this.searchAnchorInitialized) {
      this.searchAnchor.copy(core);
      this.searchAnchorInitialized = true;
    }
    if (this.searchPauseRemaining > 0) {
      this.searchPauseRemaining = Math.max(
        0,
        this.searchPauseRemaining - delta,
      );
      this.phase = "searching";
      locomotion.stop();
      return;
    }

    if (this.searchTargetActive) {
      this.searchRoamRemaining = Math.max(
        0,
        this.searchRoamRemaining - delta,
      );
      if (
        locomotion.isStuck() ||
        locomotion.distanceToTarget() <=
          config.navigationGoalReachRadius + 0.2 ||
        this.searchRoamRemaining <= 0
      ) {
        this.searchTargetActive = false;
        this.beginSearchPause();
        this.phase = "searching";
        locomotion.stop();
        return;
      }
    } else {
      if (
        planarDistance(core, this.searchAnchor) >
        config.searchRoamMaxRadius * 1.5
      ) {
        this.searchAnchor.copy(core);
      }
      const angle = this.nextThought() * Math.PI * 2;
      const radius =
        config.searchRoamMinRadius +
        (config.searchRoamMaxRadius - config.searchRoamMinRadius) *
          this.nextThought();
      this.searchTarget.set(
        this.searchAnchor.x + Math.cos(angle) * radius,
        core.y,
        this.searchAnchor.z + Math.sin(angle) * radius,
      );
      this.searchTargetActive = true;
      this.searchRoamRemaining = config.searchRoamTimeoutSeconds;
    }

    this.phase = "prowling";
    locomotion.moveTo(this.searchTarget, {
      gait: "walk",
      facing: this.searchTarget,
    });
  }

  private selectTarget(
    organic: OrganicMatterHandle,
    snapshot: ActorSnapshot,
    defensive = false,
  ): void {
    this.target = organic;
    this.targetSnapshot = snapshot;
    this.defensiveTargetId = defensive ? organic.id : null;
    this.phase = "approaching";
    this.embraceElapsed = 0;
    this.digestionElapsed = 0;
    this.damageCooldown = 0;
    this.searchPauseRemaining = 0;
    this.searchRoamRemaining = 0;
    this.searchTargetActive = false;
    this.resetApproachTracking();
  }

  private resetApproachTracking(): void {
    this.pauseApproachTracking();
    this.approachRecoveryAttempts = 0;
    this.resetEmbraceTracking();
  }

  private pauseApproachTracking(): void {
    this.approachStallElapsed = 0;
    this.lastApproachDistance = Number.POSITIVE_INFINITY;
    this.approachRecoveryRemaining = 0;
  }

  private tickEmbraceStall(
    target: OrganicMatterHandle,
    requestedCoverage: number,
    physicalCoverage: number,
    delta: number,
  ): boolean {
    if (this.phase === "digesting") {
      this.resetEmbraceTracking();
      this.approachRecoveryAttempts = 0;
      return false;
    }
    const requiredCoverage = target.isAlive()
      ? BlobConfig.predator.damageCoverageThreshold
      : BlobConfig.predator.digestionCoverageThreshold;
    if (physicalCoverage >= requiredCoverage) {
      this.resetEmbraceTracking();
      this.approachRecoveryAttempts = 0;
      return false;
    }
    if (
      physicalCoverage - this.bestEmbraceCoverage >=
      BlobConfig.predator.embraceCoverageProgress
    ) {
      this.bestEmbraceCoverage = physicalCoverage;
      this.embraceStallElapsed = 0;
    } else if (requestedCoverage >= requiredCoverage) {
      this.embraceStallElapsed += delta;
    }
    return (
      this.embraceStallElapsed >= BlobConfig.predator.embraceStallSeconds
    );
  }

  private resetEmbraceTracking(): void {
    this.embraceStallElapsed = 0;
    this.bestEmbraceCoverage = 0;
  }

  private beginSearchPause(): void {
    const config = BlobConfig.predator;
    this.searchPauseRemaining =
      config.searchPauseMinSeconds +
      (config.searchPauseMaxSeconds - config.searchPauseMinSeconds) *
        this.nextThought();
    this.searchRoamRemaining = 0;
    this.searchTargetActive = false;
    this.phase = "searching";
  }

  private tickTargetCooldowns(delta: number): void {
    for (const [targetId, remaining] of this.targetCooldowns) {
      const next = remaining - delta;
      if (next <= 0) this.targetCooldowns.delete(targetId);
      else this.targetCooldowns.set(targetId, next);
    }
  }

  private nextThought(): number {
    const value = deterministicUnit(this.thoughtSeed, this.thoughtSequence);
    this.thoughtSequence += 1;
    return value;
  }

  private acquireTarget(ctx: AiFrameContext): void {
    const core = this.getCorePosition();
    const candidates = [ctx.player, ...ctx.npcs]
      .filter((actor) => {
        const organic = actor.organicMatter;
        return (
          actor.id !== this.id &&
          !(NpcDebugFlags.ignorePlayer && actor.id === ctx.player.id) &&
          actor.characterId !== "blob" &&
          !this.targetCooldowns.has(actor.id) &&
          organic !== undefined &&
          organic.isAvailable() &&
          planarDistance(core, organic.getPosition(this.targetPosition)) <=
            BlobConfig.predator.detectionRange
        );
      })
      .sort((left, right) => {
        const leftOrganic = left.organicMatter!;
        const rightOrganic = right.organicMatter!;
        // Materia ya muerta siempre antes que una presa viva.
        const lifeOrder = Number(leftOrganic.isAlive()) - Number(rightOrganic.isAlive());
        if (lifeOrder !== 0) return lifeOrder;
        const playerOrder =
          Number(right.id === ctx.player.id) -
          Number(left.id === ctx.player.id);
        if (playerOrder !== 0) return playerOrder;
        return (
          planarDistance(core, leftOrganic.getPosition(this.targetPosition)) -
          planarDistance(core, rightOrganic.getPosition(new Vector3()))
        );
      });

    for (const candidate of candidates) {
      const organic = candidate.organicMatter!;
      if (!organic.tryClaim(this.id)) continue;
      this.selectTarget(organic, candidate);
      return;
    }
  }

  private prioritizePlayer(ctx: AiFrameContext): void {
    if (
      this.target === null ||
      this.target.id === ctx.player.id ||
      !this.target.isAlive()
    ) {
      return;
    }
    const player = ctx.player;
    const organic = player.organicMatter;
    if (
      this.targetCooldowns.has(player.id) ||
      !player.isAlive ||
      !player.entity.isAlive() ||
      !organic?.isAlive() ||
      !organic.isAvailable() ||
      planarDistance(
        this.getCorePosition(),
        organic.getPosition(this.targetPosition),
      ) > BlobConfig.predator.detectionRange ||
      !organic.tryClaim(this.id)
    ) {
      return;
    }
    this.releaseTarget();
    this.selectTarget(organic, player);
  }

  private prioritizeUrgentThreat(threat: ActorSnapshot | null | undefined): void {
    if (this.defensiveTargetId) {
      const currentDefenseIsActive =
        this.target?.id === this.defensiveTargetId &&
        this.target.isAlive() &&
        this.target.isAvailable() &&
        this.target.isClaimedBy(this.id);
      if (currentDefenseIsActive) return;
      this.defensiveTargetId = null;
    }

    const organic = threat?.organicMatter;
    if (
      !threat ||
      threat.id === this.id ||
      threat.characterId === "blob" ||
      !threat.isAlive ||
      !threat.entity.isAlive() ||
      !organic?.isAlive() ||
      !organic.isAvailable() ||
      planarDistance(this.getCorePosition(), organic.getPosition(this.targetPosition)) >
        BlobConfig.predator.disengageRange
    ) {
      return;
    }
    if (this.target?.id === organic.id) {
      this.targetSnapshot = threat;
      this.defensiveTargetId = organic.id;
      return;
    }
    if (!organic.tryClaim(this.id)) return;

    this.releaseTarget();
    this.selectTarget(organic, threat, true);
  }

  private validateTarget(): boolean {
    if (!this.target) return false;
    if (
      !this.target.isAvailable() ||
      !this.target.isClaimedBy(this.id) ||
      planarDistance(this.getCorePosition(), this.target.getPosition(this.targetPosition)) >
        BlobConfig.predator.disengageRange
    ) {
      this.releaseTarget(true);
      return false;
    }
    return true;
  }

  private refreshTargetSnapshot(ctx: AiFrameContext): void {
    if (!this.target) return;
    if (ctx.player.id === this.target.id) {
      this.targetSnapshot = ctx.player;
      return;
    }
    this.targetSnapshot =
      ctx.npcs.find((candidate) => candidate.id === this.target!.id) ??
      this.targetSnapshot;
  }

  private releaseTarget(startSearchPause = false): void {
    if (this.target?.id === this.defensiveTargetId) {
      this.defensiveTargetId = null;
    }
    this.target?.release(this.id);
    this.target = null;
    this.targetSnapshot = null;
    this.embraceElapsed = 0;
    this.digestionElapsed = 0;
    this.damageCooldown = 0;
    this.resetApproachTracking();
    if (startSearchPause) this.beginSearchPause();
  }
}

function planarDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function finiteDelta(delta: number): number {
  return Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicUnit(seed: number, sequence: number): number {
  let value = (seed + Math.imul(sequence + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}
