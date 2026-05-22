import { Group, MathUtils, Object3D, Vector3 } from "three";
import { isHostileTo, type Faction } from "@engine/ai/Faction";
import { StateMachine } from "@engine/ai/StateMachine";
import type { CharacterDefinition } from "@engine/characters/CharacterDefinition";
import type { Damageable } from "@shared/types/lifecycle";
import { Dialogue } from "@game/config/strings";
import type { GameEventBus } from "@game/GameEvents";
import { Health } from "@game/gameplay/Health";
import {
  CharacterMotor,
  type CharacterMotorSnapshot,
} from "@engine/physics/character/CharacterMotor";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type {
  ActorSnapshot,
  AiFrameContext,
  INpc,
  NpcAiDebugSnapshot,
} from "@game/npc/core/INpc";
import { NpcAnimationBridge } from "@game/npc/animation/NpcAnimationBridge";
import { NpcCombat } from "@game/npc/combat/NpcCombat";
import { NpcDebugFlags } from "@game/npc/core/NpcDebugFlags";
import { NpcNavigator } from "@game/npc/movement/NpcNavigator";
import { NpcBrainRuntime } from "@game/npc/ai/NpcBrainRuntime";
import { getCharacterAIProfile } from "@game/npc/ai/CharacterAIProfiles";
import type { NpcCondition } from "@game/npc/ai/NpcConditionSet";
import type { ZombieAiState, ZombieBalanceState } from "./ZombieNpcState";

export interface ZombieNpcOptions {
  id: string;
  definition: CharacterDefinition;
  position: Vector3;
  visualRoot: Object3D;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  hasSkeleton: boolean;
}

/**
 * Zombie NPC: melee chase + attack. Controlado por dos máquinas de estado
 * (`StateMachine`):
 *  - AI: `idle | alert | chase | attack | dead` — qué quiere hacer.
 *  - Balance: `balanced | stumbling | fallen | recovering | dead` — su
 *    condición física. Cuando no está balanceado, la AI queda suspendida.
 *
 * Composición de componentes:
 *  - `CharacterMotor`     — locomoción cinemática (engine).
 *  - `NpcAnimationBridge` — animación procedural + ragdoll reactivo.
 *  - `NpcCombat`          — cooldown, windup, hit-window, LOS y daño melee.
 */
export class ZombieNpc implements Damageable, INpc {
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
  private readonly navigator: NpcNavigator;
  private readonly brain: NpcBrainRuntime;
  private readonly targetPosition = new Vector3();
  private readonly heardNoisePosition = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private readonly tmpForward = new Vector3(0, 0, 1);
  private readonly tmpNeighbors: { position: Vector3; radius: number }[] = [];
  private readonly aiFsm: StateMachine<ZombieAiState>;
  private readonly balanceFsm: StateMachine<ZombieBalanceState>;

  private currentPlayer: Damageable | null = null;
  private currentThreatSnapshot: ActorSnapshot | null = null;
  private currentThreatId: string | null = null;
  private currentThreatDetected = false;
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private lastMotorTarget: Vector3 | null = null;
  private lastHitPartName: string | undefined;
  private stumbleTimer = 0;
  private fallenTimer = 0;
  private recoverTimer = 0;
  private deadHandled = false;
  private disposed = false;
  private currentElapsed = 0;
  private lastWantsMove = false;
  private heardNoiseAge = Infinity;
  private readonly threatScanInterval = 0.18 + Math.random() * 0.12;
  private nextThreatScanAt = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: ZombieNpcOptions) {
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
    this.navigator = new NpcNavigator(this.raycast, {
      repathInterval: 1.2,
      repathDistance: 3,
      arriveDistance: 1.2,
      stuckRepathTime: 2,
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

    this.combat = new NpcCombat(
      options.id,
      options.definition,
      options.eventBus,
      this.raycast,
    );

    this.aiFsm = this.buildAiFsm();
    this.balanceFsm = this.buildBalanceFsm();

    this.unsubscribers.push(
      options.eventBus.on("world.noise", (payload) => {
        if (payload.sourceId === this.id) return;
        if (
          payload.sourceFaction &&
          !isHostileTo(this.faction, payload.sourceFaction)
        ) {
          return;
        }
        const hearingRadius = Math.min(
          payload.radius,
          this.definition.perception.hearingRadius,
        );
        if (
          this.mesh.position.distanceToSquared(payload.position) >
          hearingRadius * hearingRadius
        ) {
          return;
        }
        this.heardNoisePosition.copy(payload.position);
        this.heardNoiseAge = 0;
        if (this.aiFsm.getState() === "idle") {
          this.aiFsm.setState("alert");
        }
      }),
    );
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  update(ctx: AiFrameContext): void {
    if (this.deadHandled) {
      this.animation.updateStandalone(ctx.delta, { dead: true });
      return;
    }

    const delta = ctx.delta;
    this.currentElapsed = ctx.elapsed;
    this.tickNoiseMemory(delta);
    this.combat.tickCooldown(delta);

    const threat = this.updateThreat(ctx);
    if (threat) {
      this.targetPosition.copy(threat.position);
      this.currentPlayer = threat.entity;
      this.currentThreatId = threat.id;
      this.currentThreatDetected =
        this.mesh.position.distanceToSquared(threat.position) <=
        this.definition.ai.detectionRange * this.definition.ai.detectionRange;
    } else if (this.hasNoiseMemory()) {
      this.targetPosition.copy(this.heardNoisePosition);
      this.currentPlayer = null;
      this.currentThreatId = null;
      this.currentThreatDetected = false;
    } else {
      this.targetPosition.copy(this.mesh.position);
      this.currentPlayer = null;
      this.currentThreatId = null;
      this.currentThreatDetected = false;
    }

    this.balanceFsm.update(delta);
    this.updateBrain(ctx);
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
    const wantsMove =
      (ai === "chase" || ai === "investigate") && balance === "balanced";
    this.lastWantsMove = wantsMove;
    const useTarget =
      ai !== "idle" && balance !== "fallen" && balance !== "recovering";
    const motorTarget = wantsMove
      ? this.computeSteeredTarget(ctx)
      : useTarget
        ? this.targetPosition
        : null;
    this.lastMotorTarget = motorTarget?.clone() ?? null;
    const frozen = NpcDebugFlags.freezeMovement;
    this.motor.update(
      delta,
      frozen ? null : motorTarget,
      frozen ? false : wantsMove,
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
    this.animation.updateFromMotor({
      snapshot,
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
    this.lastWantsMove = false;
    this.currentPlayer = null;
    this.currentThreatSnapshot = null;
    this.currentThreatId = null;
    this.currentThreatDetected = false;
    this.lastMotorTarget = null;
    this.navigator.reset();
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
    this.dispose();
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.motor.disable();
    this.animation.disable();
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

  getAiDebugSnapshot(): NpcAiDebugSnapshot {
    const alive = this.isAlive();
    const state = `${this.aiFsm.getState()}/${this.balanceFsm.getState()}`;
    const aiReason = this.aiFsm.getLastTransitionReason();
    const balReason = this.balanceFsm.getLastTransitionReason();
    let lastTransitionReason: string | null;
    if (aiReason && balReason) lastTransitionReason = `${aiReason} | ${balReason}`;
    else lastTransitionReason = aiReason ?? balReason;
    const motor = this.lastMotorSnapshot;
    const combat = this.combat.snapshot();
    const candidateDistance = this.currentThreatSnapshot
      ? this.mesh.position.distanceTo(this.currentThreatSnapshot.position)
      : Infinity;
    const activeThreatId =
      alive && this.currentThreatDetected ? this.currentThreatId : null;
    const hasNoiseMemory = alive && this.hasNoiseMemory();
    return {
      id: this.id,
      state,
      stateKey: state,
      lastTransitionReason,
      position: this.mesh.position.clone(),
      isAlive: alive,
      health: this.health.current,
      maxHealth: this.definition.health.maxHealth,
      wantsMove: alive && this.lastWantsMove,
      target: alive && this.lastWantsMove ? this.targetPosition.clone() : null,
      threatId: activeThreatId,
      threatPosition: activeThreatId ? this.targetPosition.clone() : null,
      coverId: null,
      path: this.navigator.getDebugSnapshot(),
      perception: {
        visibleNow: alive && this.currentThreatDetected,
        hasMemory: hasNoiseMemory,
        memoryAge: hasNoiseMemory ? this.heardNoiseAge : Infinity,
        lastKnownPosition: hasNoiseMemory
          ? this.heardNoisePosition.clone()
          : null,
        timeSinceLastSeen: hasNoiseMemory ? this.heardNoiseAge : Infinity,
        candidateId: alive ? this.currentThreatId : null,
        candidateDistance: alive ? candidateDistance : Infinity,
        detectionRange: this.definition.ai.detectionRange,
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
        meleeReady: combat.meleeReady,
        meleeAttacking: combat.meleeAttacking,
        cooldownRemaining: combat.cooldownRemaining,
      },
      brain: this.brain.snapshot(this.currentElapsed),
    };
  }

  // ---------------------------------------------------------------------------
  // State machines
  // ---------------------------------------------------------------------------

  private buildAiFsm(): StateMachine<ZombieAiState> {
    const fsm = new StateMachine<ZombieAiState>("idle");
    const distSq = () => this.mesh.position.distanceToSquared(this.targetPosition);
    const detectSq = () =>
      this.definition.ai.detectionRange * this.definition.ai.detectionRange;
    const attackSq = () =>
      this.definition.attack.range * this.definition.attack.range;

    fsm.addState("idle", {
      update: () => {
        if (this.currentThreatId !== null && distSq() <= detectSq()) {
          fsm.setState("chase");
        } else if (this.hasNoiseMemory()) {
          fsm.setState("alert");
        }
      },
    });

    fsm.addState("alert", {
      enter: () =>
        this.eventBus.emit("npc.alert", {
          id: this.mesh.name,
          characterId: this.definition.id,
        }),
      update: () => fsm.setState(this.currentThreatId ? "chase" : "investigate"),
    });

    fsm.addState("chase", {
      update: () => {
        const player = this.currentPlayer;
        const dSq = distSq();
        if (!this.currentThreatId) {
          fsm.setState(this.hasNoiseMemory() ? "investigate" : "idle");
          return;
        }
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

    fsm.addState("investigate", {
      update: () => {
        if (this.currentThreatId !== null) {
          fsm.setState("chase");
          return;
        }
        if (!this.hasNoiseMemory()) {
          fsm.setState("idle");
          return;
        }
        if (distSq() < 2.25) {
          this.clearNoiseMemory();
          fsm.setState("idle");
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

  private buildBalanceFsm(): StateMachine<ZombieBalanceState> {
    const fsm = new StateMachine<ZombieBalanceState>("balanced");

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

  private tickNoiseMemory(delta: number): void {
    if (!this.hasNoiseMemory()) {
      return;
    }
    this.heardNoiseAge += delta;
    if (this.heardNoiseAge > this.definition.perception.memoryDuration) {
      this.clearNoiseMemory();
    }
  }

  private hasNoiseMemory(): boolean {
    return this.heardNoiseAge <= this.definition.perception.memoryDuration;
  }

  private clearNoiseMemory(): void {
    this.heardNoiseAge = Infinity;
  }

  private updateBrain(ctx: AiFrameContext): void {
    const conditions: NpcCondition[] = [];
    const attackRangeSq =
      this.definition.attack.range * this.definition.attack.range;
    const seesEnemy =
      this.currentThreatId !== null &&
      this.currentThreatDetected &&
      this.mesh.position.distanceToSquared(this.targetPosition) <=
        this.definition.ai.detectionRange * this.definition.ai.detectionRange;
    const path = this.navigator.getDebugSnapshot();

    if (!this.isAlive()) conditions.push("EnemyDead");
    if (seesEnemy) conditions.push("SeeEnemy");
    if (this.hasNoiseMemory()) conditions.push("HeardDanger");
    if (
      this.currentThreatId !== null &&
      this.mesh.position.distanceToSquared(this.targetPosition) <= attackRangeSq
    ) {
      conditions.push("InMeleeRange");
    }
    if (this.navigator.isDestinationUnreachable()) conditions.push("PathFailed");
    if (path.lastRepathReason === "stuck-reset") conditions.push("Stuck");

    this.brain.update({
      delta: ctx.delta,
      elapsed: ctx.elapsed,
      conditions,
      threatId: this.currentThreatId,
      threatPosition:
        this.currentThreatId !== null || this.hasNoiseMemory()
          ? this.targetPosition
          : null,
      threatVisible: seesEnemy,
      threatMemoryAge: this.hasNoiseMemory() ? this.heardNoiseAge : Infinity,
      squadRole: null,
      coverId: null,
      tacticalTarget: this.lastWantsMove ? this.targetPosition : null,
      stuckReason:
        path.lastRepathReason === "stuck-reset" ? "stuck-reset" : null,
    });
  }

  /**
   * Calcula el target real que persigue el motor: A* sobre el NavGraph para
   * rodear paredes/edificios + steering (separación entre zombies y sidestep
   * por raycast frontal para los últimos metros). Mismo pipeline que Combine
   * y Alyx — los zombies no son tácticos, solo dejan de chocarse contra todo.
   */
  private computeSteeredTarget(ctx: AiFrameContext): Vector3 {
    if (!this.lastWantsMove) {
      return this.mesh.position;
    }

    this.tmpNeighbors.length = 0;
    for (const other of ctx.npcs) {
      if (other.isAlive) {
        this.tmpNeighbors.push({ position: other.position, radius: other.radius });
      }
    }
    const nav = this.navigator.resolve(
      ctx.navGraph,
      this.mesh.position,
      this.targetPosition,
      this.tmpNeighbors,
      ctx.elapsed,
    );
    if (!nav.shouldMove) {
      this.lastWantsMove = false;
      return this.mesh.position;
    }
    return nav.target;
  }

  private pickThreat(ctx: AiFrameContext): ActorSnapshot | null {
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

  private updateThreat(ctx: AiFrameContext): ActorSnapshot | null {
    this.currentThreatSnapshot = this.refreshThreatSnapshot(
      ctx,
      this.currentThreatSnapshot,
    );
    const needsScan =
      ctx.elapsed >= this.nextThreatScanAt ||
      this.currentThreatSnapshot === null ||
      !this.currentThreatSnapshot.isAlive;
    if (!needsScan) {
      return this.currentThreatSnapshot;
    }

    const lodMultiplier =
      ctx.aiLod === "far" ? 4 : ctx.aiLod === "mid" ? 2 : 1;
    this.nextThreatScanAt =
      ctx.elapsed +
      this.threatScanInterval * lodMultiplier +
      Math.random() * 0.05;
    this.currentThreatSnapshot = this.pickThreat(ctx);
    return this.currentThreatSnapshot;
  }

  private refreshThreatSnapshot(
    ctx: AiFrameContext,
    threat: ActorSnapshot | null,
  ): ActorSnapshot | null {
    if (!threat) {
      return null;
    }
    if (threat.id === ctx.player.id) {
      return ctx.player.isAlive ? ctx.player : null;
    }
    return ctx.npcs.find((npc) => npc.id === threat.id && npc.isAlive) ?? null;
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
