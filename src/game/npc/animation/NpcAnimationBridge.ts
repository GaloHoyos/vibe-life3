import { Object3D, Vector3 } from "three";
import { HitReactionAnimator } from "@engine/animation/HitReactionAnimator";
import { ProceduralCharacterAnimator } from "@engine/animation/procedural/ProceduralCharacterAnimator";
import type {
  AnimationActivity,
  AnimationInput,
  GestureId,
  WeaponHandedness,
} from "@engine/animation/AnimationInput";
import type { CharacterDefinition } from "@engine/characters/CharacterDefinition";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Damageable } from "@shared/types/lifecycle";
import { NpcDebugFlags } from "@game/npc/core/NpcDebugFlags";
import type {
  AnimationFrame,
  NpcAnimator,
  PhysicalBodyPullSettings,
} from "./NpcAnimator";

export type { AnimationFrame } from "./NpcAnimator";

const FORCED_AIM_DIRECTION = new Vector3(0, 0, 1);

/**
 * Puente entre el motor cinemÃ¡tico y el `ProceduralCharacterAnimator`.
 *
 * Responsabilidades:
 *  - Convierte el snapshot del motor en un `AnimationInput` (rotando la
 *    velocity al frame local del personaje para feedear strafe en F2).
 *  - Lleva el estado externo del NPC (apuntando? activity? crouch? lean?)
 *    que las capas leen via input.
 *  - Mantiene el `HitReactionAnimator` legacy (sway/turn-lag del root).
 */
export class NpcAnimationBridge implements NpcAnimator {
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
  /** Mientras >0, un gesto `crouch` fuerza la flexión sobre el estado del motor. */
  private gestureCrouchTimer = 0;
  private targetLeanSide = 0;
  private currentLeanSide = 0;
  private targetSeated = 0;
  private currentSeated = 0;
  private seatedControls = 0;
  /** Mirada impuesta desde afuera (asiento de vehículo), en espacio local. */
  private lookOverride: Vector3 | null = null;
  private activity: AnimationActivity = "none";
  private aimActive = false;
  private weaponPose: WeaponHandedness = "none";
  private aimWeight = 0;
  private shotJustFired = false;
  private disposed = false;

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
    if (this.disposed) return;
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

    if (this.gestureCrouchTimer > 0) {
      this.gestureCrouchTimer = Math.max(0, this.gestureCrouchTimer - frame.delta);
    }
    this.tickPostureLerp();
  }

  /**
   * Crouch (0..1) y lean (-1..1) se interpolan a un target y se le pasan al
   * `PostureLayer`, que aplica flexiÃ³n real de bones (hip drop + thighs +
   * shins + spine bend para crouch; rotaciÃ³n de spine sobre forward para
   * lean). El collider fÃ­sico no cambia.
   */
  setCrouch(amount: number): void {
    if (this.disposed) return;
    const base = Math.max(0, Math.min(1, amount));
    // Un gesto crouch activo pisa el estado de crouch del motor.
    this.targetCrouch = this.gestureCrouchTimer > 0 ? 1 : base;
  }

  /**
   * Dispara un gesto procedural. `crouch` se rinde vía `setCrouch` (flexión del
   * PostureLayer) por `duration` segundos; el resto van al `GestureLayer`.
   */
  playGesture(id: GestureId, duration: number): void {
    if (this.disposed || duration <= 0) return;
    if (id === "crouch") {
      this.gestureCrouchTimer = duration;
      this.targetCrouch = 1;
      return;
    }
    this.animator.triggerGesture(id, duration);
  }

  setLeanSide(amount: number): void {
    if (this.disposed) return;
    this.targetLeanSide = Math.max(-1, Math.min(1, amount));
  }

  /**
   * Pose de asiento. El peso lo maneja quien sienta al personaje (transición de
   * subida/bajada), así que acá se toma sin lerpeo propio: el blend ya viene
   * resuelto y un segundo suavizado retrasaría la pose respecto del cuerpo.
   */
  setSeated(amount: number, handsOnControls: boolean): void {
    if (this.disposed) return;
    this.targetSeated = Math.max(0, Math.min(1, amount));
    this.currentSeated = this.targetSeated;
    this.seatedControls = handsOnControls ? 1 : 0;
  }

  setLookDirection(direction: Vector3 | null): void {
    if (this.disposed) return;
    if (!direction) {
      this.lookOverride = null;
      return;
    }
    this.lookOverride ??= new Vector3();
    this.lookOverride.copy(direction);
  }

  /**
   * Indica al AimLayer que el NPC estÃ¡ apuntando a un punto world-space.
   * `pose` define quÃ© manos van al arma. `target=null` desactiva el aim.
   */
  setAiming(target: Vector3 | null, pose: WeaponHandedness = "twoHanded"): void {
    if (this.disposed) return;
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
    if (this.disposed) return;
    this.activity = activity;
  }

  /** Llamar despuÃ©s de cada disparo: emite un pulse de recoil corto. */
  notifyShot(): void {
    if (this.disposed) return;
    this.shotJustFired = true;
  }

  /** Llamar al iniciar reload. DispararÃ¡ el ReloadLayer (F5). */
  notifyReload(duration: number): void {
    if (this.disposed) return;
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
        seated: this.currentSeated,
        seatedControls: this.seatedControls,
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
   * (NPC muerto en ragdoll pasivo, sentado en un vehículo, o cualquier estado
   * que detenga el motor). Conserva la pose de asiento para que el ocupante no
   * pierda la flexión al no haber velocity que alimente las capas.
   */
  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    if (this.disposed) return;
    const input: AnimationInput = {
      deltaTime: delta,
      time: performance.now() / 1000,
      locomotion: {
        worldVelocity: new Vector3(),
        localVelocity: new Vector3(),
        isGrounded: true,
      },
      posture: {
        crouch: 0,
        lean: 0,
        seated: this.currentSeated,
        seatedControls: this.seatedControls,
      },
      aim: {
        active: false,
        weight: 0,
        localDirection: new Vector3(0, 0, 1),
        weaponPose: "none",
      },
      activity: "none",
      events: { shotJustFired: false },
      ...(this.lookOverride ? { lookDirection: this.lookOverride } : {}),
      isDead: !!opts.dead || this.isDead,
      desiredDirection: new Vector3(),
    };
    this.animator.update(input);
  }

  notifyHit(direction: Vector3, intensityFraction: number): void {
    if (this.disposed) return;
    this.animator.triggerHit(direction);
    this.hitReaction.flinchFrom(direction, intensityFraction);
  }

  notifyAttack(): void {
    if (this.disposed) return;
    this.animator.triggerAttack();
  }

  notifyDeath(
    direction: Vector3 | undefined,
    velocity: Vector3,
    partName: string | undefined,
  ): void {
    if (this.disposed) return;
    this.isDead = true;
    this.animator.dieWithVelocity(direction, velocity, partName);
    this.disable();
  }

  /** Apaga ambos animators. Ãštil al morir o al hacer dispose del NPC. */
  disable(): void {
    this.proceduralEnabled = false;
    this.hitReactionEnabled = false;
  }

  /** Centro de masa del ragdoll, no la posicion congelada del motor. */
  getPhysicalCenter(): Vector3 | null {
    return this.animator.getPhysicalCenter();
  }

  pullPhysicalBodyToward(
    target: Vector3,
    delta: number,
    settings: PhysicalBodyPullSettings,
  ): void {
    this.animator.pullPhysicalBodyToward(
      target,
      delta,
      settings.positionGain,
      settings.maxSpeed,
      settings.acceleration,
    );
  }

  /** Propaga el cleanup fisico completo. Seguro ante llamadas repetidas. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disable();
    this.animator.dispose();
  }
}
