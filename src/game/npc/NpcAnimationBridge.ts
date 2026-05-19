import { Object3D, Vector3 } from "three";
import { HitReactionAnimator } from "../../engine/animation/HitReactionAnimator";
import { ProceduralCharacterAnimator } from "../../engine/animation/ProceduralCharacterAnimator";
import type {
  AnimationActivity,
  AnimationInput,
  WeaponHandedness,
} from "../../engine/animation/AnimationInput";
import type { CharacterDefinition } from "../../engine/characters/CharacterDefinition";
import type { CharacterMotorSnapshot } from "../../engine/physics/CharacterMotor";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import type { Damageable } from "../../shared/types/lifecycle";
import { NpcDebugFlags } from "./NpcDebugFlags";

const FORCED_AIM_DIRECTION = new Vector3(0, 0, 1);

export interface AnimationFrame {
  snapshot: CharacterMotorSnapshot;
  lookTarget: Vector3;
  balanceIsStumbling: boolean;
}

/**
 * Puente entre el motor cinemático y el `ProceduralCharacterAnimator`.
 *
 * Responsabilidades:
 *  - Convierte el snapshot del motor en un `AnimationInput` (rotando la
 *    velocity al frame local del personaje para feedear strafe en F2).
 *  - Lleva el estado externo del NPC (apuntando? activity? crouch? lean?)
 *    que las capas leen via input.
 *  - Mantiene el `HitReactionAnimator` legacy (sway/turn-lag del root).
 */
export class NpcAnimationBridge {
  private readonly animator: ProceduralCharacterAnimator;
  private readonly hitReaction: HitReactionAnimator;
  private readonly previousVelocity = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly localVelocity = new Vector3();
  private readonly desiredDirection = new Vector3();
  private readonly aimTarget = new Vector3();
  private readonly aimLocalDirection = new Vector3(0, 0, 1);
  private readonly eyeOffset = new Vector3();
  private readonly eyeHeight: number;
  private lastYaw = 0;
  private proceduralEnabled = true;
  private hitReactionEnabled = true;
  private isDead = false;
  private targetCrouch = 0;
  private currentCrouch = 0;
  private targetLeanSide = 0;
  private currentLeanSide = 0;
  private activity: AnimationActivity = "none";
  private aimActive = false;
  private weaponPose: WeaponHandedness = "none";
  private aimWeight = 0;
  private shotJustFired = false;

  constructor(
    id: string,
    definition: CharacterDefinition,
    visualRoot: Object3D,
    physics: PhysicsWorld,
    owner: Damageable,
  ) {
    this.eyeHeight = definition.perception.eyeHeight;
    this.animator = new ProceduralCharacterAnimator({
      id,
      root: visualRoot,
      physics,
      ragdoll: definition.ragdoll,
      animation: definition.animation,
      characterId: definition.id,
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
      this.computeLocalVelocity(velocity, frame.snapshot.yaw);
      this.computeAimLocalDirection(frame.snapshot.position, frame.snapshot.yaw);
      this.tickAimWeight();
      this.desiredDirection.copy(frame.snapshot.forward);
      const lookDirection = frame.lookTarget
        .clone()
        .sub(frame.snapshot.position)
        .normalize();
      this.animator.update(this.buildInput(velocity, lookDirection));
      this.shotJustFired = false;
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

    this.tickPostureLerp();
  }

  /**
   * Crouch (0..1) y lean (-1..1) se interpolan a un target y se le pasan al
   * `PostureLayer`, que aplica flexión real de bones (hip drop + thighs +
   * shins + spine bend para crouch; rotación de spine sobre forward para
   * lean). El collider físico no cambia.
   */
  setCrouch(amount: number): void {
    this.targetCrouch = Math.max(0, Math.min(1, amount));
  }

  setLeanSide(amount: number): void {
    this.targetLeanSide = Math.max(-1, Math.min(1, amount));
  }

  /**
   * Indica al AimLayer que el NPC está apuntando a un punto world-space.
   * `pose` define qué manos van al arma. `target=null` desactiva el aim.
   */
  setAiming(target: Vector3 | null, pose: WeaponHandedness = "twoHanded"): void {
    if (!target) {
      this.aimActive = false;
      this.weaponPose = "none";
      return;
    }
    this.aimActive = true;
    this.weaponPose = pose;
    this.aimTarget.copy(target);
  }

  setActivity(activity: AnimationActivity): void {
    this.activity = activity;
  }

  /** Llamar después de cada disparo: emite un pulse de recoil corto. */
  notifyShot(): void {
    this.shotJustFired = true;
  }

  /** Llamar al iniciar reload. Disparará el ReloadLayer (F5). */
  notifyReload(duration: number): void {
    this.animator.triggerReload(duration);
  }

  private tickPostureLerp(): void {
    const lerp = 0.18;
    this.currentCrouch += (this.targetCrouch - this.currentCrouch) * lerp;
    this.currentLeanSide += (this.targetLeanSide - this.currentLeanSide) * lerp;
  }

  /**
   * Rota la velocity world-space al frame local del personaje. Con yaw=0
   * (mirando +Z), forward es +Z y right es +X. localVelocity.z > 0 = avanza,
   * localVelocity.x > 0 = strafe derecho.
   */
  private computeLocalVelocity(velocity: Vector3, yaw: number): void {
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    this.localVelocity.set(
      velocity.x * cos - velocity.z * sin,
      velocity.y,
      velocity.x * sin + velocity.z * cos,
    );
  }

  /**
   * Vector unitario desde el ojo del NPC al `aimTarget`, llevado al frame
   * local. El AimLayer lee `localDirection.y` para el pitch del torso.
   */
  private computeAimLocalDirection(position: Vector3, yaw: number): void {
    if (!this.aimActive) {
      return;
    }
    this.eyeOffset.copy(this.aimTarget);
    this.eyeOffset.x -= position.x;
    this.eyeOffset.y -= position.y + this.eyeHeight;
    this.eyeOffset.z -= position.z;
    const len = this.eyeOffset.length();
    if (len < 0.001) {
      this.aimLocalDirection.set(0, 0, 1);
      return;
    }
    this.eyeOffset.divideScalar(len);
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    this.aimLocalDirection.set(
      this.eyeOffset.x * cos - this.eyeOffset.z * sin,
      this.eyeOffset.y,
      this.eyeOffset.x * sin + this.eyeOffset.z * cos,
    );
  }

  private tickAimWeight(): void {
    const aimingOk =
      this.aimActive && this.activity !== "reloading";
    const target = aimingOk ? 1 : 0;
    const lerp = 0.12;
    this.aimWeight += (target - this.aimWeight) * lerp;
  }

  private buildInput(velocity: Vector3, lookDirection: Vector3): AnimationInput {
    const forced = NpcDebugFlags.forceAimPose;
    const aimOverride = forced !== "none";
    return {
      deltaTime: 1 / 60,
      time: performance.now() / 1000,
      locomotion: {
        worldVelocity: velocity,
        localVelocity: this.localVelocity,
        isGrounded: true,
      },
      posture: {
        crouch: this.currentCrouch,
        lean: this.currentLeanSide,
      },
      aim: {
        active: aimOverride || this.aimActive,
        weight: aimOverride ? 1 : this.aimWeight,
        localDirection: aimOverride
          ? FORCED_AIM_DIRECTION
          : this.aimLocalDirection,
        weaponPose: aimOverride ? forced : this.weaponPose,
      },
      activity: this.activity,
      events: {
        shotJustFired: this.shotJustFired,
      },
      lookDirection,
      isDead: this.isDead,
      desiredDirection: this.desiredDirection,
    };
  }

  /**
   * Mantiene al animator activo cuando no hay snapshot del motor disponible
   * (NPC muerto en ragdoll pasivo, o cualquier estado que detenga el motor).
   */
  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    const input: AnimationInput = {
      deltaTime: delta,
      time: performance.now() / 1000,
      locomotion: {
        worldVelocity: new Vector3(),
        localVelocity: new Vector3(),
        isGrounded: true,
      },
      posture: { crouch: 0, lean: 0 },
      aim: {
        active: false,
        weight: 0,
        localDirection: new Vector3(0, 0, 1),
        weaponPose: "none",
      },
      activity: "none",
      events: { shotJustFired: false },
      isDead: !!opts.dead || this.isDead,
      desiredDirection: new Vector3(),
    };
    this.animator.update(input);
  }

  notifyHit(direction: Vector3, intensityFraction: number): void {
    this.animator.triggerHit(direction);
    this.hitReaction.flinchFrom(direction, intensityFraction);
  }

  notifyAttack(): void {
    this.animator.triggerAttack();
  }

  notifyDeath(
    direction: Vector3 | undefined,
    velocity: Vector3,
    partName: string | undefined,
  ): void {
    this.isDead = true;
    this.animator.dieWithVelocity(direction, velocity, partName);
    this.disable();
  }

  /** Apaga ambos animators. Útil al morir o al hacer dispose del NPC. */
  disable(): void {
    this.proceduralEnabled = false;
    this.hitReactionEnabled = false;
  }
}
