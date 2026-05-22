import { Group, MathUtils, Object3D, Vector3 } from "three";
import { Blackboard, createBlackboard } from "@engine/ai/Blackboard";
import { type Faction, isHostileTo } from "@engine/ai/Faction";
import { Perception } from "@engine/ai/Perception";
import { StateMachine } from "@engine/ai/StateMachine";
import type { CharacterDefinition } from "@engine/characters/CharacterDefinition";
import { getWeaponDefinition } from "@game/config/weapons.config";
import type {
  WeaponHandedness,
  WeaponId,
} from "@game/gameplay/weapons/core/WeaponDefinition";
import {
  CharacterMotor,
  type CharacterMotorSnapshot,
} from "@engine/physics/character/CharacterMotor";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { Damageable } from "@shared/types/lifecycle";
import { Dialogue } from "@game/config/strings";
import type { GameEventBus } from "@game/GameEvents";
import { Health } from "@game/gameplay/Health";
import type {
  ActorSnapshot,
  AiFrameContext,
  INpc,
  NpcAiDebugSnapshot,
} from "@game/npc/core/INpc";
import { NpcDebugFlags } from "@game/npc/core/NpcDebugFlags";
import { NpcAnimationBridge } from "@game/npc/animation/NpcAnimationBridge";
import { NpcRangedCombat } from "@game/npc/combat/NpcRangedCombat";
import { NpcNavigator } from "@game/npc/movement/NpcNavigator";
import type { WeaponAttachmentHandle } from "@game/npc/combat/NpcWeaponAttachment";
import { NpcBrainRuntime } from "@game/npc/ai/NpcBrainRuntime";
import { getCharacterAIProfile } from "@game/npc/ai/CharacterAIProfiles";
import type { NpcCondition } from "@game/npc/ai/NpcConditionSet";

type AlyxState = "follow" | "combat" | "takeCover" | "regroup" | "dead";

export interface AlyxNpcOptions {
  id: string;
  definition: CharacterDefinition;
  position: Vector3;
  visualRoot: Object3D;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  weaponAttachment?: WeaponAttachmentHandle | null;
}

/**
 * Alyx aliada del player.
 *
 * Comportamiento por estado:
 *  - `follow`     â€” el player no estÃ¡ en combate. Mantiene distancia cÃ³moda
 *                   (idealRange) del player, mira en su direcciÃ³n.
 *  - `combat`     â€” hay hostiles visibles. Dispara rÃ¡fagas al mÃ¡s cercano,
 *                   se reposiciona si pierde LOS, evita estar en la lÃ­nea
 *                   de tiro del player.
 *  - `takeCover`  â€” vida baja o sin LOS al enemigo. Busca cover cercano.
 *  - `regroup`    â€” el player se alejÃ³ demasiado. Corre hacia Ã©l priorizando
 *                   sobre el combate.
 *
 * No usa el player como threat (faction = player, aliada). Selecciona threats
 * combine/creatures vÃ­a `isHostileTo`.
 */
export class AlyxNpc implements Damageable, INpc {
  readonly mesh = new Group();
  readonly health: Health;
  readonly id: string;
  readonly faction: Faction;
  readonly radius: number;

  private readonly motor: CharacterMotor;
  private readonly animation: NpcAnimationBridge;
  private readonly combat: NpcRangedCombat;
  private readonly perception: Perception;
  private readonly navigator: NpcNavigator;
  private readonly brain: NpcBrainRuntime;
  private readonly raycast: Raycast;
  private readonly blackboard: Blackboard;
  private readonly definition: CharacterDefinition;
  private readonly eventBus: GameEventBus;
  private readonly fsm: StateMachine<AlyxState>;

  private readonly desiredTarget = new Vector3();
  private readonly aimTarget = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private readonly tmpDir = new Vector3();
  private readonly tmpEye = new Vector3();
  private readonly tmpForward = new Vector3(0, 0, 1);
  private readonly tmpNeighbors: { position: Vector3; radius: number }[] = [];
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private lastMotorTarget: Vector3 | null = null;
  private currentThreat: ActorSnapshot | null = null;
  private wantsMove = false;
  private deadHandled = false;
  private disposed = false;
  private currentElapsed = 0;
  private currentCtx: AiFrameContext | null = null;
  private aimSettleTime = 0;
  private readonly weaponAttachment: WeaponAttachmentHandle | null;
  private readonly weaponHandedness: WeaponHandedness;

  /** Distancia ideal al player en modo follow. */
  private readonly followDistance = 4.0;
  /** MÃ¡s allÃ¡ de esto, se prioriza alcanzar al player. */
  private readonly tooFarFromPlayer = 16;
  /** A partir de esta distancia empieza a aplicar sprint para no perder al player. */
  private readonly catchUpStartDistance = 6.0;
  /** A esta distancia el sprint estÃ¡ al mÃ¡ximo. */
  private readonly catchUpFullDistance = 10.0;
  /** Multiplicador de maxSpeed al sprint mÃ¡ximo â€” 4.2 * 2.4 â‰ˆ 10.1 (player sprint = 9.5). */
  private readonly catchUpMaxMultiplier = 2.4;

  constructor(options: AlyxNpcOptions) {
    this.id = options.id;
    this.definition = options.definition;
    this.eventBus = options.eventBus;
    this.faction = options.definition.faction;
    this.radius = options.definition.collider.radius;
    this.health = new Health(options.definition.health.maxHealth);
    this.mesh.name = options.id;
    this.mesh.position.copy(options.position);
    this.mesh.add(options.visualRoot);

    this.raycast = new Raycast(options.physics);
    this.blackboard = createBlackboard();
    this.perception = new Perception(options.definition.perception, this.raycast);
    this.navigator = new NpcNavigator(this.raycast, {
      repathInterval: 0.8,
      repathDistance: 2.5,
      arriveDistance: 1.4,
      stuckRepathTime: 2.2,
    });
    this.brain = new NpcBrainRuntime(
      getCharacterAIProfile(options.definition.aiProfileId),
    );

    this.motor = new CharacterMotor(options.physics, {
      id: options.id,
      position: options.position,
      height: options.definition.collider.height,
      radius: options.definition.collider.radius,
      mass: options.definition.collider.mass,
      maxSpeed: options.definition.movement.maxSpeed,
      acceleration: options.definition.movement.acceleration,
      turnSpeed: options.definition.movement.turnSpeed,
      rotationSmoothing: options.definition.movement.rotationSmoothing,
      faceTargetDeadzone: options.definition.movement.faceTargetDeadzone,
      turnBeforeMoveAngle: options.definition.movement.turnBeforeMoveAngle,
      minMoveFacingDot: options.definition.movement.minMoveFacingDot,
      gravity: options.definition.movement.gravity,
      stepOffset: options.definition.collider.stepOffset,
      snapToGround: options.definition.collider.snapToGround,
      debug: options.definition.debug,
      metadata: { id: options.id, kind: "npc", damageable: this },
    });

    this.animation = new NpcAnimationBridge(
      options.id,
      options.definition,
      options.visualRoot,
      options.physics,
      this,
    );

    const rangedConfig = options.definition.attack.ranged;
    if (!rangedConfig) {
      throw new Error(
        `AlyxNpc '${options.id}' requires definition.attack.ranged config`,
      );
    }
    this.combat = new NpcRangedCombat(
      options.id,
      this.faction,
      rangedConfig,
      this.raycast,
      options.eventBus,
      () => this.animation.notifyShot(),
    );
    this.weaponHandedness = getWeaponDefinition(
      rangedConfig.weaponId as WeaponId,
    ).handedness;

    this.weaponAttachment = options.weaponAttachment ?? null;
    this.fsm = this.buildFsm();
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  update(ctx: AiFrameContext): void {
    if (this.deadHandled) {
      this.animation.updateStandalone(ctx.delta, { dead: true });
      return;
    }

    this.currentElapsed = ctx.elapsed;
    this.currentCtx = ctx;
    this.currentThreat = this.pickThreat(ctx);
    if (this.currentThreat) {
      this.perception.sense(
        ctx.delta,
        this.mesh.position,
        this.getForwardDirection(),
        { id: this.currentThreat.id, position: this.currentThreat.position },
      );
    } else {
      this.perception.tickMemory(ctx.delta);
    }

    this.blackboard.timeSinceLastSeen += ctx.delta;
    if (this.perception.isVisibleNow()) {
      this.blackboard.timeSinceLastSeen = 0;
      this.aimSettleTime = Math.min(
        this.aimSettleTime + ctx.delta,
        this.definition.attack.ranged?.aimSettleDuration ?? 1.2,
      );
    } else if (this.blackboard.timeSinceLastSeen > 0.5) {
      this.aimSettleTime = Math.max(0, this.aimSettleTime - ctx.delta * 0.8);
    }

    this.updateBrain(ctx);
    this.fsm.update(ctx.delta);
    this.updateAimingPose();

    if (this.combat.isFiringBurst() && this.currentThreat) {
      this.aimTarget.copy(this.currentThreat.position);
    }
    const settleDuration =
      this.definition.attack.ranged?.aimSettleDuration ?? 1.2;
    const aimSettleProgress =
      settleDuration > 0 ? this.aimSettleTime / settleDuration : 1;
    this.combat.update({
      origin: this.eyePosition(),
      targetPosition: this.aimTarget,
      ownerBody: this.motor.body,
      now: ctx.elapsed,
      aimSettleProgress,
    });

    const adjusted = this.computeSteeredTarget(ctx);
    const targetForMotor = this.wantsMove ? adjusted : null;
    this.lastMotorTarget = targetForMotor?.clone() ?? null;
    const frozen = NpcDebugFlags.freezeMovement;
    const alyxState = this.fsm.getState();
    const facingThreat =
      this.currentThreat && alyxState === "combat"
        ? this.currentThreat.position
        : null;
    this.motor.update(
      ctx.delta,
      frozen ? null : targetForMotor,
      frozen ? false : this.wantsMove,
      frozen ? null : facingThreat,
    );
  }

  syncFromPhysics(): void {
    if (this.deadHandled) {
      this.animation.updateStandalone(1 / 60, { dead: true });
      return;
    }
    const snapshot = this.motor.syncFromPhysics();
    this.lastMotorSnapshot = snapshot;
    this.mesh.position.copy(snapshot.position);
    this.mesh.rotation.set(0, snapshot.yaw, 0);
    const lookTarget = this.currentThreat
      ? this.currentThreat.position
      : this.desiredTarget;
    this.animation.updateFromMotor({
      snapshot,
      lookTarget,
      balanceIsStumbling: false,
    });
  }

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
  ): void {
    if (!this.health.isAlive() || this.deadHandled) return;

    const dir =
      hitDirection && hitDirection.lengthSq() > 0.001
        ? hitDirection.clone().normalize()
        : new Vector3(0, 0.2, 1);
    this.lastHitDirection.copy(dir);
    this.blackboard.lastDamageDirection.copy(dir);
    this.blackboard.lastDamageTime = this.currentElapsed;

    const remaining = this.health.applyDamage(amount);
    this.eventBus.emit("npc.damaged", {
      id: this.id,
      characterId: this.definition.id,
      amount,
      health: remaining,
    });
    this.animation.notifyHit(
      dir,
      MathUtils.clamp(amount / this.definition.health.maxHealth, 0.2, 1),
    );

    if (remaining <= 0) {
      this.die(dir, hitPartName);
    }
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.deadHandled) return;
    this.deadHandled = true;
    this.wantsMove = false;
    this.currentThreat = null;
    this.lastMotorTarget = null;
    this.navigator.reset();
    this.fsm.setState("dead", "die() invocado");

    const rangedWeaponId = this.definition.attack.ranged?.weaponId;
    if (this.weaponAttachment && rangedWeaponId) {
      const dropPos = new Vector3();
      this.weaponAttachment.getWorldPosition(dropPos);
      this.eventBus.emit("npc.weapon.dropped", {
        npcId: this.id,
        weaponId: rangedWeaponId,
        position: dropPos,
      });
    }
    this.animation.notifyDeath(
      hitDirection,
      this.motor.getVelocity(),
      hitPartName,
    );
    this.eventBus.emit("npc.killed", {
      id: this.id,
      characterId: this.definition.id,
    });
    this.eventBus.emit("dialogue.show", Dialogue.npcKilled);
    this.dispose();
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.blackboard.currentCoverId && this.currentCtx) {
      this.currentCtx.tacticalMap.release(this.blackboard.currentCoverId, this.id);
      this.blackboard.currentCoverId = null;
    }
    this.weaponAttachment?.detach();
    this.motor.disable();
    this.animation.disable();
  }

  getState(): string {
    const ammo = this.combat.snapshot(this.currentElapsed);
    return `alyx:${this.fsm.getState()} mag:${ammo.magazine}${ammo.isReloading ? "R" : ""}`;
  }

  getAiDebugSnapshot(): NpcAiDebugSnapshot {
    const alive = this.isAlive();
    const combat = this.combat.snapshot(this.currentElapsed);
    const perception = this.perception.getDebugSnapshot();
    const motor = this.lastMotorSnapshot;
    const lastDamageAgo =
      this.blackboard.lastDamageTime === -Infinity
        ? Infinity
        : Math.max(0, this.currentElapsed - this.blackboard.lastDamageTime);
    const aimSettleDuration =
      this.definition.attack.ranged?.aimSettleDuration ?? 1.2;
    return {
      id: this.id,
      state: this.getState(),
      stateKey: `alyx:${this.fsm.getState()}`,
      lastTransitionReason: this.fsm.getLastTransitionReason(),
      position: this.mesh.position.clone(),
      isAlive: alive,
      health: this.health.current,
      maxHealth: this.definition.health.maxHealth,
      wantsMove: alive && this.wantsMove,
      target: alive && this.wantsMove ? this.desiredTarget.clone() : null,
      threatId: alive ? this.currentThreat?.id ?? null : null,
      threatPosition:
        alive && this.currentThreat ? this.currentThreat.position.clone() : null,
      coverId: alive ? this.blackboard.currentCoverId : null,
      path: this.navigator.getDebugSnapshot(),
      perception: {
        ...perception,
        timeSinceLastSeen: this.blackboard.timeSinceLastSeen,
      },
      locomotion: motor
        ? {
            velocity: motor.velocity.clone(),
            desiredVelocity: motor.desiredVelocity.clone(),
            speed: motor.velocity.length(),
            desiredSpeed: motor.desiredVelocity.length(),
            grounded: motor.grounded,
            distanceToTarget: motor.distanceToTarget,
            yaw: motor.yaw,
            targetYaw: motor.targetYaw,
          }
        : undefined,
      navigation: {
        motorTarget: alive ? this.lastMotorTarget?.clone() ?? null : null,
      },
      combat: {
        magazine: combat.magazine,
        reserve: combat.reserve,
        isReloading: combat.isReloading,
        isFiringBurst: combat.isFiringBurst,
        canStartBurst: combat.canStartBurst,
        cooldownRemaining: combat.cooldownRemaining,
        reloadRemaining: combat.reloadRemaining,
        burstShotsLeft: combat.burstShotsLeft,
        nextShotIn: combat.nextShotIn,
        aimSettleProgress:
          aimSettleDuration > 0
            ? Math.min(1, this.aimSettleTime / aimSettleDuration)
            : 1,
        aimRequired: this.definition.attack.ranged?.aimTime ?? 0,
      },
      tactical: {
        suppressionLevel: this.blackboard.suppressionLevel,
        lastDamageAgo,
        timeInCover: this.blackboard.timeInCover,
      },
      brain: this.brain.snapshot(this.currentElapsed),
    };
  }

  // ---------------------------------------------------------------------------
  // FSM
  // ---------------------------------------------------------------------------

  private buildFsm(): StateMachine<AlyxState> {
    const fsm = new StateMachine<AlyxState>("follow");

    fsm.addState("follow", {
      update: () => {
        if (this.currentThreat) {
          fsm.setState("combat", "threat detectado");
        }
      },
    });

    fsm.addState("combat", {
      update: () => {
        if (!this.currentThreat) {
          fsm.setState("follow", "sin threat");
          return;
        }
        const healthRatio = this.health.current / this.definition.health.maxHealth;
        if (healthRatio < 0.4) {
          fsm.setState("takeCover", `hp=${healthRatio.toFixed(2)}<0.40`);
          return;
        }

        if (this.combat.needsReload()) {
          const reloadDuration = this.combat.startReload(this.currentElapsed);
          if (reloadDuration > 0) {
            this.animation.notifyReload(reloadDuration);
            this.animation.setActivity("reloading");
          }
        }
        if (!this.combat.isReloading(this.currentElapsed)) {
          this.animation.setActivity("none");
        }

        if (
          this.perception.isVisibleNow() &&
          !this.combat.isReloading(this.currentElapsed) &&
          this.canStartAimedBurst()
        ) {
          this.aimTarget.copy(this.currentThreat.position);
          this.combat.startBurst(this.currentElapsed);
        }
      },
    });

    fsm.addState("takeCover", {
      update: () => {
        if (!this.currentThreat) {
          fsm.setState("follow", "sin threat en takeCover");
          return;
        }
        const healthRatio = this.health.current / this.definition.health.maxHealth;
        if (healthRatio >= 0.65) {
          fsm.setState("combat", `hp=${healthRatio.toFixed(2)} recuperado`);
        }
      },
    });

    fsm.addState("regroup", {
      enter: () => {
        this.wantsMove = true;
      },
      update: () => {},
    });

    fsm.addState("dead", {
      enter: () => {
        this.wantsMove = false;
      },
    });

    return fsm;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private updateBrain(ctx: AiFrameContext): void {
    const conditions: NpcCondition[] = [];
    const visible = this.perception.isVisibleNow();
    const hasMemory = this.perception.hasRecentMemory();
    const healthRatio = this.health.current / this.definition.health.maxHealth;
    const distanceToPlayer = this.mesh.position.distanceTo(ctx.player.position);
    const path = this.navigator.getDebugSnapshot();

    if (!this.isAlive()) conditions.push("EnemyDead");
    if (visible) conditions.push("SeeEnemy");
    if (!visible && hasMemory) conditions.push("LostEnemy");
    if (healthRatio < 0.4) conditions.push("LowHealth");
    if (this.combat.needsReload()) conditions.push("NeedsReload");
    if (this.blackboard.currentCoverId) conditions.push("HasCover");
    if (this.navigator.isDestinationUnreachable()) conditions.push("PathFailed");
    if (path.lastRepathReason === "stuck-reset") conditions.push("Stuck");
    if (distanceToPlayer > this.tooFarFromPlayer) {
      conditions.push("TooFarFromLeader");
    }

    this.brain.update({
      delta: ctx.delta,
      elapsed: ctx.elapsed,
      conditions,
      threatId: this.currentThreat?.id ?? null,
      threatPosition:
        this.currentThreat?.position ?? this.perception.getLastKnown(),
      threatVisible: visible,
      threatMemoryAge: this.perception.getMemoryAge(),
      squadRole: null,
      coverId: this.blackboard.currentCoverId,
      tacticalTarget: this.wantsMove ? this.desiredTarget : null,
      stuckReason:
        path.lastRepathReason === "stuck-reset" ? "stuck-reset" : null,
    });
  }

  private updateAimingPose(): void {
    const threat = this.currentThreat;
    const state = this.fsm.getState();
    if (!threat || state !== "combat") {
      this.animation.setAiming(null);
      return;
    }
    if (this.combat.isReloading(this.currentElapsed)) {
      this.animation.setAiming(null);
      return;
    }
    this.animation.setAiming(threat.position, this.weaponHandedness);
  }

  private canStartAimedBurst(): boolean {
    const aimTime = this.definition.attack.ranged?.aimTime ?? 0;
    return (
      this.aimSettleTime >= aimTime &&
      this.combat.canStartBurst(this.currentElapsed)
    );
  }

  private pickThreat(ctx: AiFrameContext): ActorSnapshot | null {
    let best: ActorSnapshot | null = null;
    let bestDist = Infinity;
    for (const other of ctx.npcs) {
      if (!other.isAlive) continue;
      if (!isHostileTo(this.faction, other.faction)) continue;
      const d = this.mesh.position.distanceTo(other.position);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  private computeSteeredTarget(ctx: AiFrameContext): Vector3 {
    const playerPos = ctx.player.position;
    const state = this.fsm.getState();
    const distanceToPlayer = this.mesh.position.distanceTo(playerPos);

    this.motor.setSpeedMultiplier(
      this.computeCatchUpMultiplier(state, distanceToPlayer),
    );

    if (distanceToPlayer > this.tooFarFromPlayer) {
      this.desiredTarget.copy(playerPos);
      this.wantsMove = true;
    } else if (state === "follow") {
      if (distanceToPlayer > this.followDistance + 1) {
        this.tmpDir
          .copy(playerPos)
          .sub(this.mesh.position)
          .setY(0)
          .normalize();
        this.desiredTarget
          .copy(playerPos)
          .addScaledVector(this.tmpDir, -this.followDistance);
        this.wantsMove = true;
      } else {
        this.wantsMove = false;
      }
    } else if (state === "combat") {
      if (!this.perception.isVisibleNow() && this.currentThreat) {
        this.tmpDir
          .copy(this.currentThreat.position)
          .sub(this.mesh.position)
          .setY(0)
          .normalize();
        this.desiredTarget
          .copy(this.mesh.position)
          .addScaledVector(this.tmpDir, 2.0);
        this.wantsMove = true;
      } else {
        this.wantsMove = false;
      }
    } else if (state === "takeCover" && this.currentThreat) {
      if (!this.blackboard.currentCoverId) {
        const best = ctx.tacticalMap.findBestCover(
          this.id,
          this.mesh.position,
          this.currentThreat.position,
          25,
          (position) => ctx.navGraph.pathDistance(this.mesh.position, position),
        );
        if (best) {
          ctx.tacticalMap.claim(best.id, this.id);
          this.blackboard.currentCoverId = best.id;
          this.desiredTarget.copy(best.position);
          this.wantsMove = true;
        }
      } else {
        const cover = ctx.tacticalMap.getCoverPosition(
          this.blackboard.currentCoverId,
        );
        if (cover) {
          this.desiredTarget.copy(cover);
          const d = this.mesh.position.distanceTo(cover);
          if (d < 0.8) this.wantsMove = false;
          else this.wantsMove = true;
        }
      }
    }

    if (!this.wantsMove) {
      return this.mesh.position;
    }

    this.tmpNeighbors.length = 0;
    this.tmpNeighbors.push({ position: playerPos, radius: 0.5 });
    for (const other of ctx.npcs) {
      if (other.isAlive) {
        this.tmpNeighbors.push({ position: other.position, radius: other.radius });
      }
    }
    const nav = this.navigator.resolve(
      ctx.navGraph,
      this.mesh.position,
      this.desiredTarget,
      this.tmpNeighbors,
      ctx.elapsed,
    );
    if (!nav.shouldMove) {
      this.wantsMove = false;
      return this.mesh.position;
    }
    return nav.target;
  }

  private computeCatchUpMultiplier(
    state: AlyxState,
    distanceToPlayer: number,
  ): number {
    if (state !== "follow" && distanceToPlayer <= this.tooFarFromPlayer) {
      return 1;
    }
    const t = MathUtils.clamp(
      (distanceToPlayer - this.catchUpStartDistance) /
        (this.catchUpFullDistance - this.catchUpStartDistance),
      0,
      1,
    );
    return 1 + (this.catchUpMaxMultiplier - 1) * t;
  }

  private eyePosition(): Vector3 {
    this.tmpEye.copy(this.mesh.position);
    this.tmpEye.y += this.definition.perception.eyeHeight;
    return this.tmpEye;
  }

  private getForwardDirection(): Vector3 {
    if (this.lastMotorSnapshot) {
      return this.tmpForward.copy(this.lastMotorSnapshot.forward).normalize();
    }
    return this.tmpForward
      .set(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y))
      .normalize();
  }

}
