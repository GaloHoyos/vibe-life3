import { Group, MathUtils, Object3D, Vector3 } from "three";
import { Blackboard, createBlackboard } from "@engine/ai/Blackboard";
import {
  isAlliedWith,
  isHostileTo,
  type Faction,
} from "@engine/ai/Faction";
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
  INpc,
  NpcUpdateContext,
} from "@game/npc/core/INpc";
import { NpcDebugFlags } from "@game/npc/core/NpcDebugFlags";
import { NpcAnimationBridge } from "@game/npc/animation/NpcAnimationBridge";
import { NpcBarker } from "@game/npc/voice/NpcBarker";
import { NpcPathFollower } from "@game/npc/movement/NpcPathFollower";
import { NpcRangedCombat } from "@game/npc/combat/NpcRangedCombat";
import { NpcSteering } from "@game/npc/movement/NpcSteering";
import type { WeaponAttachmentHandle } from "@game/npc/combat/NpcWeaponAttachment";
import {
  COMBINE_ROLE_TUNING,
  COVER_HIDE_BETWEEN_PEEKS_MIN,
  COVER_HIDE_BETWEEN_PEEKS_VAR,
  COVER_HIDE_DURATION_MIN,
  COVER_HIDE_DURATION_VAR,
  COVER_LEAVE_HEALTH_THRESHOLD,
  COVER_LEAVE_PROBABILITY,
  COVER_PEEK_DURATION,
} from "./CombineRoleTuning";

type CombineState =
  | "idle"
  | "alert"
  | "engage"
  | "reload"
  | "takeCover"
  | "coverFire"
  | "investigate"
  | "dead";

export interface CombineNpcOptions {
  id: string;
  definition: CharacterDefinition;
  position: Vector3;
  visualRoot: Object3D;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  weaponAttachment?: WeaponAttachmentHandle | null;
}

/**
 * NPC Combine: humanoid armado con AR3, percepciÃ³n real, cover y FSM tÃ¡ctico.
 *
 * Pipeline por frame:
 *  1. Construye lista de targets hostiles (player + NPCs hostiles).
 *  2. Selecciona el mÃ¡s cercano visible (o conserva el Ãºltimo visto vÃ­a Perception).
 *  3. FSM decide estado: engage / takeCover / reload / investigate / idle.
 *  4. Estado calcula `desiredTarget` (posiciÃ³n a la que moverse) y dispara rÃ¡fagas.
 *  5. NpcSteering aplica separaciÃ³n + obstacle avoidance al desiredTarget.
 *  6. NpcRangedCombat tickea rÃ¡faga pendiente.
 *  7. Motor camina hacia el target ajustado.
 *
 * Cuando recibe damage de un atacante no visto, suma a memoria de perception y
 * baja el threshold para buscar cover.
 */
export class CombineNpc implements Damageable, INpc {
  readonly mesh = new Group();
  readonly health: Health;
  readonly id: string;
  readonly faction: Faction;
  readonly radius: number;

  private readonly motor: CharacterMotor;
  private readonly animation: NpcAnimationBridge;
  private readonly combat: NpcRangedCombat;
  private readonly perception: Perception;
  private readonly steering: NpcSteering;
  private readonly pathFollower = new NpcPathFollower();
  private readonly barker: NpcBarker;
  private readonly weaponAttachment: WeaponAttachmentHandle | null;
  private readonly weaponHandedness: WeaponHandedness;
  private readonly raycast: Raycast;
  private readonly blackboard: Blackboard;
  private readonly definition: CharacterDefinition;
  private readonly eventBus: GameEventBus;
  private readonly fsm: StateMachine<CombineState>;

  private readonly desiredTarget = new Vector3();
  private readonly aimTarget = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private readonly tmpToThreat = new Vector3();
  private readonly tmpLateral = new Vector3();
  private readonly tmpEye = new Vector3();
  private readonly tmpForward = new Vector3(0, 0, 1);
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private currentThreat: ActorSnapshot | null = null;
  private wantsMove = false;
  private deadHandled = false;
  private disposed = false;
  private alertReactionTimer = 0;
  private currentElapsed = 0;
  private currentCtx: NpcUpdateContext | null = null;
  private strafeDirection: 1 | -1 = 1;
  private strafeTimer = 0;
  private wasVisiblePrevFrame = false;
  private readonly unsubscribers: Array<() => void> = [];
  /** Radio (m) en el que un alert de un aliado le interesa a este NPC. */
  private readonly commsRadius = 35;
  /** Role asignado por el squad. Se refresca cada frame en update(). */
  private currentRole: "solo" | "suppressor" | "flanker" | "coverer" | "charger" =
    "solo";
  private flankSide: 1 | -1 = 1;
  private coverPhase: "hide" | "peek" = "hide";
  private coverPhaseTimer = 0;
  private peekLeanSide: 1 | -1 = 1;
  private scanArrived = false;
  private scanTimer = 0;
  private scanDirection: 1 | -1 = 1;
  private aimSettleTime = 0;
  /**
   * Tiempo (game-elapsed) hasta el cual no se intenta reclamar cover de nuevo.
   * Se setea cuando `findBestCover` devuelve null para evitar el flap engageâ†”takeCover.
   */
  private coverSearchCooldownUntil = 0;

  constructor(options: CombineNpcOptions) {
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
    this.steering = new NpcSteering(this.raycast);

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
        `CombineNpc '${options.id}' requires definition.attack.ranged config`,
      );
    }
    this.combat = new NpcRangedCombat(
      options.id,
      rangedConfig,
      this.raycast,
      options.eventBus,
      () => this.animation.notifyShot(),
    );
    this.weaponHandedness = getWeaponDefinition(
      rangedConfig.weaponId as WeaponId,
    ).handedness;

    this.barker = new NpcBarker("Combine", options.eventBus);
    this.weaponAttachment = options.weaponAttachment ?? null;

    this.fsm = this.buildFsm();

    this.unsubscribers.push(
      options.eventBus.on("npc.threat.spotted", (payload) => {
        if (payload.spotterId === this.id) return;
        if (!isAlliedWith(this.faction, payload.spotterFaction)) return;
        const distance = this.mesh.position.distanceTo(payload.spotterPosition);
        if (distance > this.commsRadius) return;
        this.perception.notifyAlert(payload.threatPosition);
      }),
    );
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  update(ctx: NpcUpdateContext): void {
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
    const visibleNow = this.perception.isVisibleNow();
    if (visibleNow) {
      this.aimSettleTime = Math.min(
        this.aimSettleTime + ctx.delta,
        this.definition.attack.ranged?.aimSettleDuration ?? 1.5,
      );
      this.blackboard.timeSinceLastSeen = 0;
      if (!this.wasVisiblePrevFrame && this.currentThreat) {
        this.eventBus.emit("npc.threat.spotted", {
          spotterId: this.id,
          spotterFaction: this.faction,
          threatId: this.currentThreat.id,
          threatPosition: this.currentThreat.position.clone(),
          spotterPosition: this.mesh.position.clone(),
        });
        this.barker.say("spotted", ctx.elapsed);
      }
    }
    if (this.wasVisiblePrevFrame && !visibleNow && this.currentThreat) {
      this.barker.say("lostSight", ctx.elapsed);
    }
    if (!visibleNow && this.blackboard.timeSinceLastSeen > 0.5) {
      this.aimSettleTime = Math.max(0, this.aimSettleTime - ctx.delta * 0.8);
    }
    this.wasVisiblePrevFrame = visibleNow;

    ctx.squad.report({
      id: this.id,
      position: this.mesh.position,
      health01: this.health.current / this.definition.health.maxHealth,
      hasLineOfSight: visibleNow,
      inCover: this.blackboard.currentCoverId !== null,
      isFlankerCandidate: !this.combat.needsReload(),
    });
    const prevRole = this.currentRole;
    this.currentRole = ctx.squad.getRole(this.id);
    this.flankSide = ctx.squad.getFlankSide(this.id);
    if (prevRole !== this.currentRole) {
      if (this.currentRole === "flanker") {
        this.barker.say("flanking", ctx.elapsed);
      } else if (this.currentRole === "charger") {
        this.barker.say("advancing", ctx.elapsed);
      }
    }
    this.blackboard.timeInCover += ctx.delta;
    this.blackboard.suppressionLevel = Math.max(
      0,
      this.blackboard.suppressionLevel - ctx.delta * 0.5,
    );

    this.fsm.update(ctx.delta);
    this.updateAimingPose();
    this.updateAnimationActivity();

    if (this.combat.isFiringBurst() && this.currentThreat) {
      this.aimTarget.copy(this.currentThreat.position);
    }
    const settleDuration =
      this.definition.attack.ranged?.aimSettleDuration ?? 1.5;
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
    const frozen = NpcDebugFlags.freezeMovement;
    this.motor.update(
      ctx.delta,
      frozen ? null : targetForMotor,
      frozen ? false : this.wantsMove,
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
    this.blackboard.suppressionLevel = Math.min(
      3,
      this.blackboard.suppressionLevel + 0.6,
    );

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
      return;
    }

    if (!this.perception.hasRecentMemory()) {
      const guessed = this.mesh.position
        .clone()
        .addScaledVector(dir, -6);
      this.perception.notifyAlert(guessed);
    }
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.deadHandled) return;
    this.deadHandled = true;

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
    this.fsm.setState("dead");
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
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.releaseCover();
    this.currentCtx?.squad.unregister(this.id);
    this.weaponAttachment?.detach();
    this.motor.disable();
    this.animation.disable();
  }

  getState(): string {
    const ammo = this.combat.snapshot(0);
    return `${this.fsm.getState()} mag:${ammo.magazine}${ammo.isReloading ? "R" : ""}`;
  }

  // ---------------------------------------------------------------------------
  // FSM
  // ---------------------------------------------------------------------------

  private buildFsm(): StateMachine<CombineState> {
    const fsm = new StateMachine<CombineState>("idle");

    fsm.addState("idle", {
      enter: () => {
        this.wantsMove = false;
      },
      update: () => {
        if (this.perception.isVisibleNow() || this.perception.hasRecentMemory()) {
          fsm.setState("alert");
        }
      },
    });

    fsm.addState("alert", {
      enter: () => {
        this.wantsMove = false;
        this.alertReactionTimer = 0;
        this.eventBus.emit("npc.alert", {
          id: this.id,
          characterId: this.definition.id,
        });
      },
      update: (delta) => {
        this.alertReactionTimer += delta;
        const reaction = this.definition.attack.ranged?.reactionTime ?? 0.4;
        if (this.alertReactionTimer >= reaction) {
          fsm.setState("engage");
        }
      },
    });

    fsm.addState("engage", {
      enter: () => {
        this.releaseCover();
        this.wantsMove = false;
        this.strafeDirection = Math.random() < 0.5 ? 1 : -1;
        this.strafeTimer = 0;
        this.animation.setCrouch(0);
        this.animation.setLeanSide(0);
      },
      update: (delta) => {
        const threat = this.currentThreat;
        if (!threat) {
          if (this.perception.hasRecentMemory()) {
            fsm.setState("investigate");
          } else {
            fsm.setState("idle");
          }
          return;
        }

        if (this.combat.needsReload()) {
          fsm.setState("reload");
          return;
        }

        const healthRatio = this.health.current / this.definition.health.maxHealth;
        const recentlyHit =
          this.currentElapsed - this.blackboard.lastDamageTime < 1.2;

        const role = this.currentRole;
        const tuning = COMBINE_ROLE_TUNING[role];
        const wantsCover =
          !tuning.preferOpenCombat &&
          (healthRatio < tuning.coverHealthThreshold ||
            this.blackboard.suppressionLevel > 0.8 ||
            recentlyHit ||
            !this.perception.isVisibleNow());
        const coverSearchAllowed =
          this.currentElapsed >= this.coverSearchCooldownUntil;
        if (
          wantsCover &&
          coverSearchAllowed &&
          this.blackboard.currentCoverId === null
        ) {
          fsm.setState("takeCover");
          return;
        }

        if (role === "flanker") {
          const distToThreat = this.mesh.position.distanceTo(threat.position);
          if (distToThreat > 4) {
            this.tmpToThreat
              .copy(threat.position)
              .sub(this.mesh.position)
              .setY(0)
              .normalize();
            this.tmpLateral
              .set(-this.tmpToThreat.z, 0, this.tmpToThreat.x)
              .multiplyScalar(this.flankSide * 9);
            this.desiredTarget.copy(threat.position).add(this.tmpLateral);
            this.wantsMove = true;
          } else {
            this.wantsMove = false;
          }
          if (
            this.perception.isVisibleNow() &&
            this.combat.canStartBurst(this.currentElapsed)
          ) {
            this.aimTarget.copy(threat.position);
            this.combat.startBurst(this.currentElapsed);
          }
          return;
        }

        const distance = this.mesh.position.distanceTo(threat.position);
        const idealRange = this.definition.attack.range;

        if (distance > idealRange * tuning.chargeFactor) {
          this.desiredTarget.copy(threat.position);
          this.wantsMove = true;
        } else if (distance < idealRange * 0.35) {
          this.strafeTimer -= delta;
          if (this.strafeTimer <= 0) {
            this.strafeDirection = -this.strafeDirection as 1 | -1;
            this.strafeTimer = 0.9 + Math.random() * 0.7;
          }
          this.tmpToThreat
            .copy(threat.position)
            .sub(this.mesh.position)
            .setY(0)
            .normalize();
          this.tmpLateral
            .set(-this.tmpToThreat.z, 0, this.tmpToThreat.x)
            .multiplyScalar(this.strafeDirection * 2.5);
          this.desiredTarget.copy(this.mesh.position).add(this.tmpLateral);
          this.wantsMove = true;
        } else {
          this.strafeTimer -= delta;
          if (this.strafeTimer <= 0) {
            this.strafeDirection = -this.strafeDirection as 1 | -1;
            this.strafeTimer = 1.4 + Math.random() * 1.0;
          }
          if (Math.random() < 0.5) {
            this.tmpToThreat
              .copy(threat.position)
              .sub(this.mesh.position)
              .setY(0)
              .normalize();
            this.tmpLateral
              .set(-this.tmpToThreat.z, 0, this.tmpToThreat.x)
              .multiplyScalar(this.strafeDirection * 1.5);
            this.desiredTarget.copy(this.mesh.position).add(this.tmpLateral);
            this.wantsMove = true;
          } else {
            this.wantsMove = false;
          }
        }

        if (
          this.perception.isVisibleNow() &&
          this.combat.canStartBurst(this.currentElapsed)
        ) {
          this.aimTarget.copy(threat.position);
          this.combat.startBurst(this.currentElapsed);
        }
      },
    });

    fsm.addState("reload", {
      enter: () => {
        this.wantsMove = false;
        const reloadDuration = this.combat.startReload(this.currentElapsed);
        this.animation.notifyReload(reloadDuration);
        this.barker.say("reloading", this.currentElapsed);
      },
      update: () => {
        if (!this.combat.isReloading(this.currentElapsed)) {
          fsm.setState(
            this.blackboard.currentCoverId !== null ? "coverFire" : "engage",
          );
        }
      },
    });

    fsm.addState("takeCover", {
      enter: () => {
        this.wantsMove = true;
        this.combat.abortBurst();
        this.barker.say("covering", this.currentElapsed);
      },
      update: () => {
        const threat = this.currentThreat;
        if (!threat) {
          fsm.setState("engage");
          return;
        }
        if (!this.blackboard.currentCoverId) {
          fsm.setState("engage");
          return;
        }
        const distance = this.mesh.position.distanceTo(this.desiredTarget);
        if (distance < 0.9) {
          this.wantsMove = false;
          this.blackboard.timeInCover = 0;
          this.blackboard.timeSincePeek = 0;
          fsm.setState("coverFire");
        }
      },
    });

    fsm.addState("coverFire", {
      enter: () => {
        this.wantsMove = false;
        this.coverPhase = "hide";
        this.coverPhaseTimer =
          COVER_HIDE_DURATION_MIN + Math.random() * COVER_HIDE_DURATION_VAR;
        this.animation.setCrouch(1);
        this.animation.setLeanSide(0);
      },
      update: (delta) => {
        const threat = this.currentThreat;
        if (!threat) {
          this.releaseCover();
          this.animation.setCrouch(0);
          this.animation.setLeanSide(0);
          fsm.setState(
            this.perception.hasRecentMemory() ? "investigate" : "idle",
          );
          return;
        }
        if (this.combat.needsReload()) {
          this.animation.setCrouch(1);
          this.animation.setLeanSide(0);
          fsm.setState("reload");
          return;
        }

        const coverStillBlocks =
          this.blackboard.currentCoverId !== null &&
          this.currentCtx !== null &&
          this.currentCtx.coverSystem.isStillValid(
            this.blackboard.currentCoverId,
            this.id,
            threat.position,
          );

        if (!coverStillBlocks) {
          this.releaseCover();
          this.animation.setCrouch(0);
          this.animation.setLeanSide(0);
          fsm.setState("takeCover");
          return;
        }

        this.coverPhaseTimer -= delta;
        if (this.coverPhaseTimer <= 0) {
          if (this.coverPhase === "hide") {
            this.coverPhase = "peek";
            this.coverPhaseTimer = COVER_PEEK_DURATION;
            this.peekLeanSide = Math.random() < 0.5 ? 1 : -1;
            this.animation.setCrouch(0);
            this.animation.setLeanSide(this.peekLeanSide);
            if (
              this.perception.isVisibleNow() &&
              this.combat.canStartBurst(this.currentElapsed)
            ) {
              this.aimTarget.copy(threat.position);
              this.combat.startBurst(this.currentElapsed);
            }
          } else {
            this.coverPhase = "hide";
            this.coverPhaseTimer =
              COVER_HIDE_BETWEEN_PEEKS_MIN +
              Math.random() * COVER_HIDE_BETWEEN_PEEKS_VAR;
            this.combat.abortBurst();
            this.animation.setCrouch(1);
            this.animation.setLeanSide(0);
          }
        }

        const healthRatio = this.health.current / this.definition.health.maxHealth;
        const coverTuning = COMBINE_ROLE_TUNING[this.currentRole];
        const wantsLeaveCover =
          coverTuning.preferOpenCombat ||
          (healthRatio > COVER_LEAVE_HEALTH_THRESHOLD &&
            Math.random() < COVER_LEAVE_PROBABILITY);
        if (wantsLeaveCover && this.coverPhase === "hide") {
          this.releaseCover();
          this.animation.setCrouch(0);
          this.animation.setLeanSide(0);
          fsm.setState("engage");
        }
      },
    });

    fsm.addState("investigate", {
      enter: () => {
        const lkp = this.perception.getLastKnown();
        if (lkp) {
          this.desiredTarget.copy(lkp);
          this.wantsMove = true;
        }
        this.scanArrived = false;
        this.scanTimer = 0;
        this.scanDirection = 1;
        this.barker.say("investigating", this.currentElapsed);
      },
      update: (delta) => {
        if (this.perception.isVisibleNow()) {
          fsm.setState("engage");
          return;
        }
        const distance = this.mesh.position.distanceTo(this.desiredTarget);
        if (!this.scanArrived) {
          if (distance < 1.5) {
            this.scanArrived = true;
            this.wantsMove = false;
            this.scanTimer = 0;
          }
        } else {
          this.scanTimer += delta;
          const sweep = Math.sin(this.scanTimer * 1.4) * 1.1;
          const lkp = this.perception.getLastKnown() ?? this.desiredTarget;
          this.tmpToThreat
            .copy(lkp)
            .sub(this.mesh.position)
            .setY(0)
            .normalize();
          this.tmpLateral.set(-this.tmpToThreat.z, 0, this.tmpToThreat.x);
          this.aimTarget
            .copy(this.mesh.position)
            .addScaledVector(this.tmpToThreat, 5)
            .addScaledVector(this.tmpLateral, sweep * 4);
          if (this.scanTimer > 4.5 || !this.perception.hasRecentMemory()) {
            fsm.setState("idle");
          }
        }
      },
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

  /**
   * Decide si el NPC estÃ¡ actualmente "apuntando con el arma" (manos
   * agarrando, body alineado con el threat) y se lo dice al bridge para
   * que el AimLayer levante los brazos.
   */
  private updateAimingPose(): void {
    const threat = this.currentThreat;
    const state = this.fsm.getState();
    if (
      !threat ||
      state === "reload" ||
      state === "idle" ||
      state === "investigate" ||
      state === "takeCover" ||
      state === "dead"
    ) {
      this.animation.setAiming(null);
      return;
    }
    if (state === "coverFire" && this.coverPhase === "hide") {
      this.animation.setAiming(null);
      return;
    }
    this.animation.setAiming(threat.position, this.weaponHandedness);
  }

  private updateAnimationActivity(): void {
    const state = this.fsm.getState();
    if (state === "reload") {
      this.animation.setActivity("reloading");
    } else {
      this.animation.setActivity("none");
    }
  }

  private releaseCover(): void {
    if (this.blackboard.currentCoverId && this.currentCtx) {
      this.currentCtx.coverSystem.release(this.blackboard.currentCoverId, this.id);
    }
    this.blackboard.currentCoverId = null;
  }

  private pickThreat(ctx: NpcUpdateContext): ActorSnapshot | null {
    const candidates: ActorSnapshot[] = [];
    if (
      !NpcDebugFlags.ignorePlayer &&
      ctx.player.isAlive &&
      isHostileTo(this.faction, ctx.player.faction)
    ) {
      candidates.push(ctx.player);
    }
    for (const other of ctx.npcs) {
      if (!other.isAlive) continue;
      if (!isHostileTo(this.faction, other.faction)) continue;
      candidates.push(other);
    }
    if (candidates.length === 0) return null;

    let best: ActorSnapshot | null = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const distance = this.mesh.position.distanceTo(candidate.position);
      const score = -distance;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private computeSteeredTarget(ctx: NpcUpdateContext): Vector3 {
    const fsmState = this.fsm.getState();
    const threat = this.currentThreat;

    if (
      fsmState === "takeCover" &&
      this.blackboard.currentCoverId === null &&
      threat
    ) {
      const best = ctx.coverSystem.findBestCover(
        this.id,
        this.mesh.position,
        threat.position,
      );
      if (best) {
        ctx.coverSystem.claim(best.id, this.id);
        this.blackboard.currentCoverId = best.id;
        this.desiredTarget.copy(best.position);
      } else {
        this.coverSearchCooldownUntil = this.currentElapsed + 2;
      }
    }

    if (
      (fsmState === "takeCover" || fsmState === "coverFire") &&
      this.blackboard.currentCoverId
    ) {
      const cover = ctx.coverSystem.getCoverPosition(this.blackboard.currentCoverId);
      if (cover) this.desiredTarget.copy(cover);
    }

    const distanceToFinal = this.mesh.position.distanceTo(this.desiredTarget);
    const pathTarget = distanceToFinal > 5
      ? this.pathFollower.nextWaypoint(
          ctx.navGraph,
          this.mesh.position,
          this.desiredTarget,
          ctx.elapsed,
        )
      : this.desiredTarget;

    const neighbors = ctx.npcs
      .filter((n) => n.isAlive)
      .map((n) => ({ position: n.position, radius: n.radius }));
    return this.steering.steer(this.mesh.position, pathTarget, neighbors);
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
