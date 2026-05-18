import { Group, MathUtils, Object3D, Vector3 } from "three";
import { isHostileTo, type Faction } from "../../engine/ai/Faction";
import { StateMachine } from "../../engine/ai/StateMachine";
import type { ProceduralAnimationState } from "../../engine/animation/ProceduralCharacterAnimator";
import type { CharacterDefinition } from "../../engine/characters/CharacterDefinition";
import type { Damageable } from "../../shared/types/lifecycle";
import { Dialogue } from "../config/strings";
import type { GameEventBus } from "../GameEvents";
import { Health } from "../gameplay/Health";
import {
  CharacterMotor,
  type CharacterMotorSnapshot,
} from "../../engine/physics/CharacterMotor";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import { Raycast } from "../../engine/physics/Raycast";
import type { ActorSnapshot, INpc, NpcUpdateContext } from "./INpc";
import { NpcAnimationBridge } from "./NpcAnimationBridge";
import { NpcCombat } from "./NpcCombat";
import type { NpcAiState, NpcBalanceState } from "./NPCState";

export interface NPCOptions {
  id: string;
  definition: CharacterDefinition;
  position: Vector3;
  visualRoot: Object3D;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  hasSkeleton: boolean;
}

/**
 * NPC controlado por dos máquinas de estado (`StateMachine`):
 *  - AI: `idle | alert | chase | attack | dead` — qué quiere hacer.
 *  - Balance: `balanced | stumbling | fallen | recovering | dead` — su
 *    condición física. Cuando no está balanceado, la AI queda suspendida.
 *
 * Composición de componentes:
 *  - `CharacterMotor`     — locomoción cinemática (engine).
 *  - `NpcAnimationBridge` — animación procedural + ragdoll reactivo.
 *  - `NpcCombat`          — cooldown, windup, hit-window, LOS y daño.
 */
export class NPC implements Damageable, INpc {
  readonly mesh = new Group();
  readonly health: Health;
  readonly id: string;
  readonly faction: Faction;
  readonly radius: number;

  private readonly motor: CharacterMotor;
  private readonly animation: NpcAnimationBridge;
  private readonly combat: NpcCombat;
  private readonly definition: CharacterDefinition;
  private readonly eventBus: GameEventBus;
  private readonly raycast: Raycast;
  private readonly targetPosition = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private readonly aiFsm: StateMachine<NpcAiState>;
  private readonly balanceFsm: StateMachine<NpcBalanceState>;

  private currentPlayer: Damageable | null = null;
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private lastHitPartName: string | undefined;
  private stumbleTimer = 0;
  private fallenTimer = 0;
  private recoverTimer = 0;
  private deadHandled = false;

  constructor(options: NPCOptions) {
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

    this.combat = new NpcCombat(
      options.id,
      options.definition,
      options.eventBus,
      this.raycast,
    );

    this.aiFsm = this.buildAiFsm();
    this.balanceFsm = this.buildBalanceFsm();
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  update(ctx: NpcUpdateContext): void {
    if (this.deadHandled) {
      this.animation.updateStandalone(ctx.delta, "dead");
      return;
    }

    const delta = ctx.delta;
    this.combat.tickCooldown(delta);

    const threat = this.pickThreat(ctx);
    if (threat) {
      this.targetPosition.copy(threat.position);
      this.currentPlayer = threat.entity;
    } else {
      this.targetPosition.copy(ctx.player.position);
      this.currentPlayer = ctx.player.entity;
    }

    this.balanceFsm.update(delta);
    if (this.balanceFsm.getState() === "balanced") {
      this.aiFsm.update(delta);
    }

    if (this.aiFsm.getState() === "attack" && this.currentPlayer) {
      const stillAttacking = this.combat.tickAttack(delta, {
        npcPosition: this.mesh.position,
        npcForward: this.getForwardDirection(),
        targetPosition: this.targetPosition,
        player: this.currentPlayer,
        balanceLocked: this.balanceLocked(),
      });
      if (!stillAttacking) {
        this.aiFsm.setState("chase");
      }
    }

    const ai = this.aiFsm.getState();
    const balance = this.balanceFsm.getState();
    const wantsMove = ai === "chase" && balance === "balanced";
    const useTarget =
      ai !== "idle" && balance !== "fallen" && balance !== "recovering";
    this.motor.update(delta, useTarget ? this.targetPosition : null, wantsMove);
  }

  syncFromPhysics(): void {
    if (this.deadHandled) {
      this.animation.updateStandalone(1 / 60, "dead");
      return;
    }

    const snapshot = this.motor.syncFromPhysics();
    this.lastMotorSnapshot = snapshot;
    this.mesh.position.copy(snapshot.position);
    this.mesh.rotation.set(0, snapshot.yaw, 0);
    this.animation.updateFromMotor({
      snapshot,
      state: this.getAnimationState(),
      lookTarget: this.targetPosition,
      balanceIsStumbling: this.balanceFsm.getState() === "stumbling",
    });
  }

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
  ): void {
    this.takeDamage(amount, hitDirection, hitPartName);
  }

  takeDamage(
    amount: number,
    hitDirection = new Vector3(0, 0.2, 1),
    hitPartName?: string,
  ): void {
    if (!this.health.isAlive() || this.deadHandled) {
      return;
    }

    this.lastHitDirection.copy(
      hitDirection.lengthSq() > 0.001
        ? hitDirection.clone().normalize()
        : new Vector3(0, 0.2, 1),
    );
    this.lastHitPartName = hitPartName;
    const currentHealth = this.health.applyDamage(amount);
    this.eventBus.emit("npc.damaged", {
      id: this.mesh.name,
      characterId: this.definition.id,
      amount,
      health: currentHealth,
    });
    this.animation.notifyHit(
      this.lastHitDirection,
      MathUtils.clamp(amount / this.definition.health.maxHealth, 0.2, 1),
    );

    if (currentHealth <= 0) {
      this.die(this.lastHitDirection, this.lastHitPartName);
      return;
    }

    const hitStrength = amount / this.definition.health.maxHealth;
    if (hitStrength >= this.definition.stumble.stumbleImpulseThreshold) {
      const fell =
        hitStrength > this.definition.stumble.fallAngleThreshold;
      this.balanceFsm.setState(fell ? "fallen" : "stumbling");
    }

    if (this.aiFsm.getState() === "idle") {
      this.aiFsm.setState("alert");
    }
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.deadHandled) {
      return;
    }

    this.deadHandled = true;
    this.aiFsm.setState("dead");
    this.balanceFsm.setState("dead");
    this.motor.disable();
    this.animation.notifyDeath(
      hitDirection,
      this.motor.getVelocity(),
      hitPartName,
    );
    this.eventBus.emit("npc.killed", {
      id: this.mesh.name,
      characterId: this.definition.id,
    });
    this.eventBus.emit("dialogue.show", Dialogue.npcKilled);
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }

  getState(): string {
    const ai = this.aiFsm.getState();
    const balance = this.balanceFsm.getState();
    if (this.definition.debug && this.lastMotorSnapshot) {
      const m = this.lastMotorSnapshot;
      return `${ai}/${balance} d:${m.distanceToTarget.toFixed(1)} v:${m.velocity.length().toFixed(2)} dv:${m.desiredVelocity.length().toFixed(2)} g:${m.grounded ? "1" : "0"}`;
    }
    return `${ai}/${balance}`;
  }

  // ---------------------------------------------------------------------------
  // State machines
  // ---------------------------------------------------------------------------

  private buildAiFsm(): StateMachine<NpcAiState> {
    const fsm = new StateMachine<NpcAiState>("idle");
    const distSq = () => this.mesh.position.distanceToSquared(this.targetPosition);
    const detectSq = () =>
      this.definition.ai.detectionRange * this.definition.ai.detectionRange;
    const attackSq = () =>
      this.definition.attack.range * this.definition.attack.range;

    fsm.addState("idle", {
      update: () => {
        if (distSq() <= detectSq()) {
          fsm.setState("chase");
        }
      },
    });

    fsm.addState("alert", {
      enter: () =>
        this.eventBus.emit("npc.alert", {
          id: this.mesh.name,
          characterId: this.definition.id,
        }),
      update: () => fsm.setState("chase"),
    });

    fsm.addState("chase", {
      update: () => {
        const player = this.currentPlayer;
        const dSq = distSq();
        if (dSq > detectSq()) {
          fsm.setState("idle");
          return;
        }
        if (
          this.combat.isReady() &&
          player &&
          player.isAlive() &&
          dSq <= attackSq()
        ) {
          fsm.setState("attack");
        }
      },
    });

    fsm.addState("attack", {
      enter: () => {
        if (!this.combat.start()) {
          fsm.setState("chase");
          return;
        }
        this.animation.notifyAttack();
      },
    });

    fsm.addState("dead", {});

    return fsm;
  }

  private buildBalanceFsm(): StateMachine<NpcBalanceState> {
    const fsm = new StateMachine<NpcBalanceState>("balanced");

    fsm.addState("balanced", {});

    fsm.addState("stumbling", {
      enter: () => {
        this.stumbleTimer = this.definition.stumble.stumbleDuration;
        this.interruptAttack();
      },
      update: (delta) => {
        this.stumbleTimer -= delta;
        if (this.stumbleTimer <= 0) {
          fsm.setState("balanced");
          this.aiFsm.setState("chase");
        }
      },
    });

    fsm.addState("fallen", {
      enter: () => {
        this.fallenTimer = this.definition.stumble.getUpDelay;
        this.interruptAttack();
      },
      update: (delta) => {
        this.fallenTimer -= delta;
        if (this.fallenTimer <= 0) {
          fsm.setState("recovering");
        }
      },
    });

    fsm.addState("recovering", {
      enter: () => {
        this.recoverTimer = this.definition.stumble.recoverDuration;
      },
      update: (delta) => {
        this.recoverTimer -= delta;
        if (this.recoverTimer <= 0) {
          fsm.setState("balanced");
          this.aiFsm.setState("chase");
        }
      },
    });

    fsm.addState("dead", {});

    return fsm;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private balanceLocked(): boolean {
    const state = this.balanceFsm.getState();
    return state === "fallen" || state === "recovering";
  }

  private interruptAttack(): void {
    if (this.aiFsm.getState() === "attack") {
      this.combat.cancel();
      this.aiFsm.setState("chase");
    }
  }

  private getAnimationState(): ProceduralAnimationState {
    const ai = this.aiFsm.getState();
    const balance = this.balanceFsm.getState();

    if (ai === "dead") return "dead";
    if (ai === "attack") return "attack";
    if (balance === "stumbling") return "hit";
    if (ai === "chase") return "walk";
    return "idle";
  }

  private pickThreat(ctx: NpcUpdateContext): ActorSnapshot | null {
    const candidates: ActorSnapshot[] = [];
    if (ctx.player.isAlive && isHostileTo(this.faction, ctx.player.faction)) {
      candidates.push(ctx.player);
    }
    for (const other of ctx.npcs) {
      if (!other.isAlive) continue;
      if (!isHostileTo(this.faction, other.faction)) continue;
      candidates.push(other);
    }
    if (candidates.length === 0) return null;

    let best: ActorSnapshot | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = this.mesh.position.distanceToSquared(c.position);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
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
