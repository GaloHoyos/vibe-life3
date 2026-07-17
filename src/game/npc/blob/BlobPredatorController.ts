import { Vector3 } from "three";
import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";
import type { NpcBehaviorController } from "@game/npc/core/NpcBehaviorController";
import type { NpcLocomotionHandle } from "@game/npc/brain/NpcBrainContext";
import type {
  OrganicMatterHandle,
  OrganicPullSettings,
} from "@game/gameplay/organic/OrganicMatter";
import { BlobConfig } from "@game/config/blob.config";

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

type PredatorPhase = "searching" | "approaching" | "embracing" | "digesting";

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
  private defensiveTargetId: string | null = null;
  private disposed = false;
  private readonly targetPosition = new Vector3();
  private readonly digestionTarget = new Vector3();
  private readonly attackDirection = new Vector3();

  constructor(
    private readonly id: string,
    private readonly body: BlobFeedingBody,
    private readonly getCorePosition: () => Vector3,
  ) {}

  update(
    ctx: AiFrameContext,
    locomotion: NpcLocomotionHandle,
    urgentThreat?: ActorSnapshot | null,
  ): ActorSnapshot | null {
    if (this.disposed) return null;
    const delta = finiteDelta(ctx.delta);
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);

    this.refreshTargetSnapshot(ctx);
    this.prioritizeUrgentThreat(urgentThreat);
    if (!this.validateTarget()) this.acquireTarget(ctx);
    const target = this.target;
    if (!target) {
      this.phase = "searching";
      locomotion.stop();
      this.body.clearFeedingTarget();
      return null;
    }

    target.getPosition(this.targetPosition);
    const corePosition = this.getCorePosition();
    const distance = planarDistance(corePosition, this.targetPosition);
    const embraceDistance =
      BlobConfig.predator.coreEmbraceDistance + target.radius;
    const releaseDistance =
      embraceDistance + BlobConfig.predator.embraceReleasePadding;
    const canMaintainEmbrace =
      this.phase === "embracing" || this.phase === "digesting";

    // Si una presa/ragdoll se aleja durante el abrazo, el gel se recoge y el
    // core vuelve a navegar. El claim permanece para no alternar objetivos.
    if (distance > (canMaintainEmbrace ? releaseDistance : embraceDistance)) {
      this.phase = "approaching";
      this.embraceElapsed = 0;
      this.digestionElapsed = 0;
      target.setRestraint(this.id, 0);
      target.setDigestionProgress(this.id, 0);
      this.body.clearFeedingTarget();
      locomotion.moveTo(this.targetPosition, {
        gait: "walk",
        facing: this.targetPosition,
      });
      return this.targetSnapshot;
    }

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
        this.tickDigestion(target, delta);
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

  private tickDigestion(target: OrganicMatterHandle, delta: number): void {
    this.phase = "digesting";
    this.digestionElapsed = Math.min(
      BlobConfig.predator.digestionSeconds,
      this.digestionElapsed + delta,
    );
    const progress =
      this.digestionElapsed / BlobConfig.predator.digestionSeconds;
    target.setDigestionProgress(this.id, progress);
    if (progress < 1) return;

    const gained = target.consume(this.id);
    if (gained > 0) this.body.addOrganicMass(gained);
    this.target = null;
    this.targetSnapshot = null;
    this.phase = "searching";
    this.embraceElapsed = 0;
    this.digestionElapsed = 0;
    this.body.clearFeedingTarget();
  }

  private acquireTarget(ctx: AiFrameContext): void {
    const core = this.getCorePosition();
    const candidates = [ctx.player, ...ctx.npcs]
      .filter((actor) => {
        const organic = actor.organicMatter;
        return (
          actor.id !== this.id &&
          actor.characterId !== "blob" &&
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
        return (
          planarDistance(core, leftOrganic.getPosition(this.targetPosition)) -
          planarDistance(core, rightOrganic.getPosition(new Vector3()))
        );
      });

    for (const candidate of candidates) {
      const organic = candidate.organicMatter!;
      if (!organic.tryClaim(this.id)) continue;
      this.target = organic;
      this.targetSnapshot = candidate;
      this.phase = "approaching";
      this.embraceElapsed = 0;
      this.digestionElapsed = 0;
      this.damageCooldown = 0;
      return;
    }
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
    this.target = organic;
    this.targetSnapshot = threat;
    this.defensiveTargetId = organic.id;
    this.phase = "approaching";
  }

  private validateTarget(): boolean {
    if (!this.target) return false;
    if (
      !this.target.isAvailable() ||
      !this.target.isClaimedBy(this.id) ||
      planarDistance(this.getCorePosition(), this.target.getPosition(this.targetPosition)) >
        BlobConfig.predator.disengageRange
    ) {
      this.releaseTarget();
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

  private releaseTarget(): void {
    if (this.target?.id === this.defensiveTargetId) {
      this.defensiveTargetId = null;
    }
    this.target?.release(this.id);
    this.target = null;
    this.targetSnapshot = null;
    this.embraceElapsed = 0;
    this.digestionElapsed = 0;
    this.damageCooldown = 0;
  }
}

function planarDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function finiteDelta(delta: number): number {
  return Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
}
