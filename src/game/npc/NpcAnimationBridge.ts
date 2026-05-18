import { Object3D, Vector3 } from "three";
import { HitReactionAnimator } from "../../engine/animation/HitReactionAnimator";
import {
  ProceduralCharacterAnimator,
  type ProceduralAnimationState,
} from "../../engine/animation/ProceduralCharacterAnimator";
import type { CharacterDefinition } from "../../engine/characters/CharacterDefinition";
import type { CharacterMotorSnapshot } from "../../engine/physics/CharacterMotor";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import type { Damageable } from "../../shared/types/lifecycle";

export interface AnimationFrame {
  snapshot: CharacterMotorSnapshot;
  state: ProceduralAnimationState;
  lookTarget: Vector3;
  balanceIsStumbling: boolean;
}

/**
 * Puente entre el motor cinemático y los sistemas de animación.
 *
 * Es dueño del `ProceduralCharacterAnimator` (animación bone-based) y del
 * `HitReactionAnimator` (deformación reactiva del root). Conoce la
 * derivada de velocidad y la rotación previa que esos sistemas necesitan.
 */
export class NpcAnimationBridge {
  private readonly animator: ProceduralCharacterAnimator;
  private readonly hitReaction: HitReactionAnimator;
  private readonly previousVelocity = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly visualRoot: Object3D;
  private readonly baseVisualY: number;
  private readonly baseVisualX: number;
  private lastYaw = 0;
  private proceduralEnabled = true;
  private hitReactionEnabled = true;
  private targetCrouch = 0;
  private currentCrouch = 0;
  private targetLeanSide = 0;
  private currentLeanSide = 0;

  constructor(
    id: string,
    definition: CharacterDefinition,
    visualRoot: Object3D,
    physics: PhysicsWorld,
    owner: Damageable,
  ) {
    this.visualRoot = visualRoot;
    this.baseVisualY = visualRoot.position.y;
    this.baseVisualX = visualRoot.position.x;
    this.animator = new ProceduralCharacterAnimator({
      id,
      root: visualRoot,
      physics,
      walk: definition.animation.walk,
      ragdoll: definition.ragdoll,
      animation: definition.animation,
      owner,
      debug: definition.debug,
    });
    this.hitReaction = new HitReactionAnimator(visualRoot, {
      swayStrength: 1,
      turnLagStrength: 0.08,
      flinchStrength: 0.42,
      stumbleLean: 0.16,
    });
  }

  /** Actualiza animator + active ragdoll usando un snapshot del motor. */
  updateFromMotor(frame: AnimationFrame): void {
    const velocity = frame.snapshot.velocity;
    this.acceleration.copy(velocity).sub(this.previousVelocity);
    this.previousVelocity.copy(velocity);

    const yawDelta = Math.atan2(
      Math.sin(frame.snapshot.yaw - this.lastYaw),
      Math.cos(frame.snapshot.yaw - this.lastYaw),
    );
    this.lastYaw = frame.snapshot.yaw;

    if (this.proceduralEnabled) {
      this.animator.update({
        velocity,
        desiredDirection: frame.snapshot.forward,
        isGrounded: frame.snapshot.grounded,
        state: frame.state,
        deltaTime: 1 / 60,
        time: performance.now() / 1000,
        lookDirection: frame.lookTarget
          .clone()
          .sub(frame.snapshot.position)
          .normalize(),
      });
    }

    if (this.hitReactionEnabled) {
      this.hitReaction.update({
        velocity,
        acceleration: this.acceleration,
        yawDelta,
        balanceIntensity: frame.balanceIsStumbling ? 1 : 0,
        deltaTime: 1 / 60,
      });
    }

    this.applyCrouchAndLean();
  }

  /**
   * Crouch (0..1) baja el visual ~0.55m, simula que el NPC se agacha detrás
   * de la cobertura. Lean (-1..1) lo desplaza lateralmente para "asomarse"
   * por un lado. Ambas transiciones se interpolan en `applyCrouchAndLean`.
   */
  setCrouch(amount: number): void {
    this.targetCrouch = Math.max(0, Math.min(1, amount));
  }

  setLeanSide(amount: number): void {
    this.targetLeanSide = Math.max(-1, Math.min(1, amount));
  }

  private applyCrouchAndLean(): void {
    const lerp = 0.18;
    this.currentCrouch += (this.targetCrouch - this.currentCrouch) * lerp;
    this.currentLeanSide += (this.targetLeanSide - this.currentLeanSide) * lerp;
    this.visualRoot.position.y = this.baseVisualY - this.currentCrouch * 0.55;
    this.visualRoot.position.x = this.baseVisualX + this.currentLeanSide * 0.35;
  }

  /**
   * Mantiene al animator activo cuando no hay snapshot del motor disponible
   * (NPC muerto en ragdoll pasivo, o cualquier estado que detenga el motor).
   */
  updateStandalone(delta: number, state: ProceduralAnimationState): void {
    this.animator.update({
      velocity: new Vector3(),
      desiredDirection: new Vector3(),
      isGrounded: true,
      state,
      deltaTime: delta,
      time: performance.now() / 1000,
    });
  }

  notifyHit(direction: Vector3, intensityFraction: number): void {
    this.animator.hit(direction);
    this.hitReaction.flinchFrom(direction, intensityFraction);
  }

  notifyAttack(): void {
    this.animator.attack();
  }

  notifyDeath(
    direction: Vector3 | undefined,
    velocity: Vector3,
    partName: string | undefined,
  ): void {
    this.animator.dieWithVelocity(direction, velocity, partName);
    this.disable();
  }

  /** Apaga ambos animators. Útil al morir o al hacer dispose del NPC. */
  disable(): void {
    this.proceduralEnabled = false;
    this.hitReactionEnabled = false;
  }
}
