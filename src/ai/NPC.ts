import {
  Group,
  MathUtils,
  Object3D,
  Vector3,
} from "three";
import { ActiveRagdollController } from "../animation/ActiveRagdollController";
import {
  ProceduralCharacterAnimator,
  type ProceduralAnimationState,
} from "../animation/ProceduralCharacterAnimator";
import type { CharacterDefinition } from "../characters/CharacterDefinition";
import type { Damageable } from "../engine/GameObject";
import type { GameEventBus } from "../engine/GameEvents";
import { Health } from "../gameplay/Health";
import {
  CharacterMotor,
  type CharacterMotorSnapshot,
} from "../physics/CharacterMotor";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { NPCBalanceState, NPCState } from "./NPCState";

export interface NPCOptions {
  id: string;
  definition: CharacterDefinition;
  position: Vector3;
  visualRoot: Object3D;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  hasSkeleton: boolean;
}

export class NPC implements Damageable {
  readonly mesh = new Group();
  readonly health: Health;
  readonly id: string;

  private readonly motor: CharacterMotor;
  private readonly animator: ProceduralCharacterAnimator;
  private readonly activeRagdoll: ActiveRagdollController;
  private readonly visualRoot: Object3D;
  private readonly definition: CharacterDefinition;
  private readonly eventBus: GameEventBus;
  private readonly previousVelocity = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly lastHitDirection = new Vector3(0, 0, 1);
  private lastMotorSnapshot: CharacterMotorSnapshot | null = null;
  private lastHitPartName: string | undefined;
  private state: NPCState = "idle";
  private balanceState: NPCBalanceState = "balanced";
  private attackCooldown = 0;
  private stumbleTimer = 0;
  private fallenTimer = 0;
  private recoverTimer = 0;
  private lastYaw = 0;
  private deadHandled = false;
  private aiEnabled = true;
  private locomotionEnabled = true;
  private proceduralAnimationEnabled = true;
  private activeRagdollEnabled = true;

  constructor(options: NPCOptions) {
    this.id = options.id;
    this.definition = options.definition;
    this.eventBus = options.eventBus;
    this.health = new Health(options.definition.health.maxHealth);
    this.visualRoot = options.visualRoot;
    this.mesh.name = options.id;
    this.mesh.position.copy(options.position);
    this.mesh.add(this.visualRoot);

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

    this.animator = new ProceduralCharacterAnimator({
      id: options.id,
      root: this.visualRoot,
      physics: options.physics,
      walk: options.definition.animation.walk,
      ragdoll: options.definition.ragdoll,
      animation: options.definition.animation,
      owner: this,
      debug: options.definition.debug,
    });
    this.activeRagdoll = new ActiveRagdollController(this.visualRoot, {
      swayStrength: 1,
      turnLagStrength: 0.08,
      flinchStrength: 0.42,
      stumbleLean: 0.16,
    });
  }

  update(delta: number, playerPosition: Vector3): void {
    if (this.state === "dead") {
      this.animator.update(this.createAnimationUpdate(delta, "dead"));
      return;
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.targetPosition.copy(playerPosition);
    this.updateState(delta);

    const wantsMove =
      this.locomotionEnabled &&
      this.state === "chase" &&
      this.balanceState === "balanced";
    const target =
      this.aiEnabled &&
      this.state !== "idle" &&
      this.state !== "fallen" &&
      this.state !== "recovering"
        ? this.targetPosition
        : null;
    this.motor.update(delta, target, wantsMove);
  }

  syncFromPhysics(): void {
    if (this.state === "dead") {
      this.animator.update(this.createAnimationUpdate(1 / 60, "dead"));
      return;
    }

    const snapshot = this.motor.syncFromPhysics();
    this.lastMotorSnapshot = snapshot;
    this.mesh.position.copy(snapshot.position);
    this.mesh.rotation.set(0, snapshot.yaw, 0);
    this.updateAnimationFromMotor(snapshot);
  }

  applyDamage(amount: number, hitDirection?: Vector3, hitPartName?: string): void {
    this.takeDamage(amount, hitDirection, hitPartName);
  }

  takeDamage(amount: number, hitDirection = new Vector3(0, 0.2, 1), hitPartName?: string): void {
    if (!this.health.isAlive() || this.state === "dead") {
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
      amount,
      health: currentHealth,
    });
    this.animator.hit(this.lastHitDirection);
    this.activeRagdoll.flinchFrom(
      this.lastHitDirection,
      MathUtils.clamp(amount / this.definition.health.maxHealth, 0.2, 1),
    );

    if (currentHealth <= 0) {
      this.die(this.lastHitDirection, this.lastHitPartName);
      return;
    }

    const hitStrength = amount / this.definition.health.maxHealth;
    if (hitStrength >= this.definition.stumble.stumbleImpulseThreshold) {
      this.enterStumble(hitStrength);
    }

    if (this.state === "idle") {
      this.state = "alert";
    }
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.deadHandled) {
      return;
    }

    this.deadHandled = true;
    this.state = "dead";
    this.balanceState = "dead";
    this.aiEnabled = false;
    this.locomotionEnabled = false;
    this.proceduralAnimationEnabled = false;
    this.activeRagdollEnabled = false;
    this.motor.disable();
    this.animator.dieWithVelocity(hitDirection, this.motor.getVelocity(), hitPartName);
    this.eventBus.emit("npc.killed", { id: this.mesh.name });
    this.eventBus.emit("dialogue.show", {
      speaker: "Sistema",
      text: "Entidad hostil neutralizada.",
      duration: 2.4,
    });
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }

  getState(): string {
    if (this.definition.debug && this.lastMotorSnapshot) {
      return `${this.state}/${this.balanceState} d:${this.lastMotorSnapshot.distanceToTarget.toFixed(1)} v:${this.lastMotorSnapshot.velocity.length().toFixed(2)} dv:${this.lastMotorSnapshot.desiredVelocity.length().toFixed(2)} g:${this.lastMotorSnapshot.grounded ? '1' : '0'}`;
    }

    return `${this.state}/${this.balanceState}`;
  }

  private updateState(delta: number): void {
    if (!this.aiEnabled) {
      return;
    }

    if (this.balanceState === "stumbling") {
      this.stumbleTimer -= delta;
      if (this.stumbleTimer <= 0) {
        this.balanceState = "balanced";
        this.state = "chase";
      }
      return;
    }

    if (this.balanceState === "fallen") {
      this.fallenTimer -= delta;
      if (this.fallenTimer <= 0) {
        this.balanceState = "recovering";
        this.state = "recovering";
        this.recoverTimer = this.definition.stumble.recoverDuration;
      }
      return;
    }

    if (this.balanceState === "recovering") {
      this.recoverTimer -= delta;
      if (this.recoverTimer <= 0) {
        this.balanceState = "balanced";
        this.state = "chase";
      }
      return;
    }

    const distanceSq = this.mesh.position.distanceToSquared(
      this.targetPosition,
    );
    const detectionSq =
      this.definition.ai.detectionRange * this.definition.ai.detectionRange;
    const attackSq =
      this.definition.ai.attackRange * this.definition.ai.attackRange;

    if (distanceSq > detectionSq) {
      this.state = "idle";
      return;
    }

    if (distanceSq <= attackSq && this.attackCooldown <= 0) {
      this.state = "attack";
      this.animator.attack();
      this.attackCooldown = this.definition.ai.attackCooldown;
      return;
    }

    this.state = "chase";
  }

  private updateAnimationFromMotor(snapshot: CharacterMotorSnapshot): void {
    const velocity = snapshot.velocity;
    this.acceleration.copy(velocity).sub(this.previousVelocity);
    this.previousVelocity.copy(velocity);

    const yawDelta = Math.atan2(
      Math.sin(snapshot.yaw - this.lastYaw),
      Math.cos(snapshot.yaw - this.lastYaw),
    );
    this.lastYaw = snapshot.yaw;

    if (this.proceduralAnimationEnabled) {
      this.animator.update({
        velocity,
        desiredDirection: snapshot.forward,
        isGrounded: snapshot.grounded,
        state: this.getAnimationState(),
        deltaTime: 1 / 60,
        time: performance.now() / 1000,
        lookDirection: this.targetPosition
          .clone()
          .sub(snapshot.position)
          .normalize(),
      });
    }

    if (this.activeRagdollEnabled) {
      this.activeRagdoll.update({
        velocity,
        acceleration: this.acceleration,
        yawDelta,
        balanceIntensity: this.balanceState === "stumbling" ? 1 : 0,
        deltaTime: 1 / 60,
      });
    }
  }

  private createAnimationUpdate(
    delta: number,
    state: ProceduralAnimationState,
  ) {
    return {
      velocity: new Vector3(),
      desiredDirection: new Vector3(),
      isGrounded: true,
      state,
      deltaTime: delta,
      time: performance.now() / 1000,
    };
  }

  private getAnimationState(): ProceduralAnimationState {
    if (this.state === "dead") {
      return "dead";
    }

    if (this.state === "attack") {
      return "attack";
    }

    if (this.state === "stagger" || this.balanceState === "stumbling") {
      return "hit";
    }

    if (this.state === "chase") {
      return "walk";
    }

    return "idle";
  }

  private enterStumble(hitStrength: number): void {
    this.balanceState = "stumbling";
    this.state = "stagger";
    this.stumbleTimer = this.definition.stumble.stumbleDuration;

    if (hitStrength > this.definition.stumble.fallAngleThreshold) {
      this.balanceState = "fallen";
      this.state = "fallen";
      this.fallenTimer = this.definition.stumble.getUpDelay;
    }
  }
}
