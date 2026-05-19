import { Group, MathUtils, Object3D, Vector3 } from "three";
import { Blackboard, createBlackboard } from "../../engine/ai/Blackboard";
import { type Faction, isHostileTo } from "../../engine/ai/Faction";
import { Perception } from "../../engine/ai/Perception";
import { StateMachine } from "../../engine/ai/StateMachine";
import type { CharacterDefinition } from "../../engine/characters/CharacterDefinition";
import { getWeaponDefinition } from "../config/weapons.config";
import type {
  WeaponHandedness,
  WeaponId,
} from "../gameplay/weapons/WeaponDefinition";
import {
  CharacterMotor,
  type CharacterMotorSnapshot,
} from "../../engine/physics/CharacterMotor";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import { Raycast } from "../../engine/physics/Raycast";
import type { Damageable } from "../../shared/types/lifecycle";
import { Dialogue } from "../config/strings";
import type { GameEventBus } from "../GameEvents";
import { Health } from "../gameplay/Health";
import type { ActorSnapshot, INpc, NpcUpdateContext } from "./INpc";
import { NpcDebugFlags } from "./NpcDebugFlags";
import { NpcAnimationBridge } from "./NpcAnimationBridge";
import { NpcPathFollower } from "./NpcPathFollower";
import { NpcRangedCombat } from "./NpcRangedCombat";
import { NpcSteering } from "./NpcSteering";
import type { WeaponAttachmentHandle } from "./NpcWeaponAttachment";

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
 *  - `follow`     — el player no está en combate. Mantiene distancia cómoda
 *                   (idealRange) del player, mira en su dirección.
 *  - `combat`     — hay hostiles visibles. Dispara ráfagas al más cercano,
 *                   se reposiciona si pierde LOS, evita estar en la línea
 *                   de tiro del player.
 *  - `takeCover`  — vida baja o sin LOS al enemigo. Busca cover cercano.
 *  - `regroup`    — el player se alejó demasiado. Corre hacia él priorizando
 *                   sobre el combate.
 *
 * No usa el player como threat (faction = player, aliada). Selecciona threats
 * combine/creatures vía `isHostileTo`.
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
  private readonly steering: NpcSteering;
  private readonly pathFollower = new NpcPathFollower();
  private readonly raycast: Raycast;
  private readonly blackboard: Blackboard;
  private readonly definition: CharacterDefinition;
  private readonly eventBus: GameEventBus;
  private readonly fsm: StateMachine<AlyxState>;

  private readonly desiredTarget = new Vector3();
  private readonly aimTarget = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private currentThreat: ActorSnapshot | null = null;
  private wantsMove = false;
  private deadHandled = false;
  private currentElapsed = 0;
  private aimSettleTime = 0;
  private readonly weaponAttachment: WeaponAttachmentHandle | null;
  private readonly weaponHandedness: WeaponHandedness;

  /** Distancia ideal al player en modo follow. */
  private readonly followDistance = 4.0;
  /** Más allá de esto, se prioriza alcanzar al player. */
  private readonly tooFarFromPlayer = 16;

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
        `AlyxNpc '${options.id}' requires definition.attack.ranged config`,
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

    this.weaponAttachment = options.weaponAttachment ?? null;
    this.fsm = this.buildFsm();
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
    this.currentThreat = this.pickThreat(ctx);
    if (this.currentThreat) {
      this.perception.sense(
        ctx.delta,
        this.mesh.position,
        this.getForwardDirection(),
        { id: this.currentThreat.id, position: this.currentThreat.position },
      );
    } else {
      this.perception.clearMemory();
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
    this.blackboard.lastDamageTime = performance.now() / 1000;

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
    this.fsm.setState("dead");
    this.motor.disable();
    this.animation.notifyDeath(
      hitDirection,
      this.motor.getVelocity(),
      hitPartName,
    );
    const rangedWeaponId = this.definition.attack.ranged?.weaponId;
    if (this.weaponAttachment && rangedWeaponId) {
      const dropPos = new Vector3();
      this.weaponAttachment.getWorldPosition(dropPos);
      this.weaponAttachment.detach();
      this.eventBus.emit("npc.weapon.dropped", {
        npcId: this.id,
        weaponId: rangedWeaponId,
        position: dropPos,
      });
    }
    this.eventBus.emit("npc.killed", {
      id: this.id,
      characterId: this.definition.id,
    });
    this.eventBus.emit("dialogue.show", Dialogue.npcKilled);
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }

  getState(): string {
    const ammo = this.combat.snapshot(0);
    return `alyx:${this.fsm.getState()} mag:${ammo.magazine}`;
  }

  // ---------------------------------------------------------------------------
  // FSM
  // ---------------------------------------------------------------------------

  private buildFsm(): StateMachine<AlyxState> {
    const fsm = new StateMachine<AlyxState>("follow");

    fsm.addState("follow", {
      update: () => {
        if (this.currentThreat) {
          fsm.setState("combat");
        }
      },
    });

    fsm.addState("combat", {
      update: () => {
        if (!this.currentThreat) {
          fsm.setState("follow");
          return;
        }
        const healthRatio = this.health.current / this.definition.health.maxHealth;
        if (healthRatio < 0.4) {
          fsm.setState("takeCover");
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
          this.combat.canStartBurst(this.currentElapsed)
        ) {
          this.aimTarget.copy(this.currentThreat.position);
          this.aimTarget.y += 1.2;
          this.combat.startBurst(this.currentElapsed);
        }
      },
    });

    fsm.addState("takeCover", {
      update: () => {
        if (!this.currentThreat) {
          fsm.setState("follow");
          return;
        }
        const healthRatio = this.health.current / this.definition.health.maxHealth;
        if (healthRatio >= 0.65) {
          fsm.setState("combat");
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

  private pickThreat(ctx: NpcUpdateContext): ActorSnapshot | null {
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

  private computeSteeredTarget(ctx: NpcUpdateContext): Vector3 {
    const playerPos = ctx.player.position;
    const state = this.fsm.getState();
    const distanceToPlayer = this.mesh.position.distanceTo(playerPos);

    if (distanceToPlayer > this.tooFarFromPlayer) {
      this.desiredTarget.copy(playerPos);
      this.wantsMove = true;
    } else if (state === "follow") {
      if (distanceToPlayer > this.followDistance + 1) {
        const dir = playerPos.clone().sub(this.mesh.position).setY(0).normalize();
        this.desiredTarget
          .copy(playerPos)
          .addScaledVector(dir, -this.followDistance);
        this.wantsMove = true;
      } else {
        this.wantsMove = false;
      }
    } else if (state === "combat") {
      if (!this.perception.isVisibleNow() && this.currentThreat) {
        const toThreat = this.currentThreat.position
          .clone()
          .sub(this.mesh.position)
          .setY(0)
          .normalize();
        this.desiredTarget
          .copy(this.mesh.position)
          .addScaledVector(toThreat, 2.0);
        this.wantsMove = true;
      } else {
        this.wantsMove = false;
      }
    } else if (state === "takeCover" && this.currentThreat) {
      if (!this.blackboard.currentCoverId) {
        const best = ctx.coverSystem.findBestCover(
          this.id,
          this.mesh.position,
          this.currentThreat.position,
        );
        if (best) {
          ctx.coverSystem.claim(best.id, this.id);
          this.blackboard.currentCoverId = best.id;
          this.desiredTarget.copy(best.position);
          this.wantsMove = true;
        }
      } else {
        const cover = ctx.coverSystem.getCoverPosition(
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

    const distanceToFinal = this.mesh.position.distanceTo(this.desiredTarget);
    const pathTarget = distanceToFinal > 5
      ? this.pathFollower.nextWaypoint(
          ctx.navGraph,
          this.mesh.position,
          this.desiredTarget,
          ctx.elapsed,
        )
      : this.desiredTarget;

    const neighbors: { position: Vector3; radius: number }[] = [
      { position: playerPos, radius: 0.5 },
    ];
    for (const other of ctx.npcs) {
      if (other.isAlive) {
        neighbors.push({ position: other.position, radius: other.radius });
      }
    }
    return this.steering.steer(this.mesh.position, pathTarget, neighbors);
  }

  private eyePosition(): Vector3 {
    const eye = this.mesh.position.clone();
    eye.y += this.definition.perception.eyeHeight;
    return eye;
  }

  private getForwardDirection(): Vector3 {
    if (this.lastMotorSnapshot) {
      return this.lastMotorSnapshot.forward.clone().normalize();
    }
    return new Vector3(
      Math.sin(this.mesh.rotation.y),
      0,
      Math.cos(this.mesh.rotation.y),
    ).normalize();
  }

}
