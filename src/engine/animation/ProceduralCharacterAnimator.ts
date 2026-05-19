import { Object3D, Vector3 } from "three";
import type { CharacterAnimationConfig } from "../characters/CharacterDefinition";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Damageable } from "../../shared/types/lifecycle";
import { AnimationDebug } from "./AnimationDebug";
import type { AnimationInput } from "./AnimationInput";
import { BoneMapper } from "./BoneMapper";
import { HumanoidRestPose } from "./HumanoidRestPose";
import { AimLayer } from "./layers/AimLayer";
import type { AnimationLayer, AnimationLayerContext } from "./layers/AnimationLayer";
import { AttackLayer } from "./layers/AttackLayer";
import { HitLayer } from "./layers/HitLayer";
import { IdleLayer } from "./layers/IdleLayer";
import { LocomotionLayer } from "./layers/LocomotionLayer";
import { LookAtLayer } from "./layers/LookAtLayer";
import { PostureLayer } from "./layers/PostureLayer";
import { ReloadLayer } from "./layers/ReloadLayer";
import { VelocityLeanLayer } from "./layers/VelocityLeanLayer";
import { PoseSnapshot } from "./PoseSnapshot";
import type { RagdollConfig } from "./RagdollDefinition";
import { RagdollSystem } from "./RagdollSystem";

/**
 * Enum heredado, mantenido para debug y para getState(). El nuevo flujo
 * usa `AnimationInput` (en lugar de un estado discreto); este string es
 * derivado on-demand a partir del estado interno + velocity.
 */
export type ProceduralAnimationState =
  | "idle"
  | "walk"
  | "run"
  | "attack"
  | "hit"
  | "dead";

export interface ProceduralAnimatorOptions {
  id: string;
  root: Object3D;
  physics: PhysicsWorld;
  ragdoll?: Partial<RagdollConfig>;
  animation?: CharacterAnimationConfig;
  /** Identificador del preset (combine, alyx, zombie). Permite que el
   *  rest pose se override desde `RestPoseTuning` para tuning visual. */
  characterId?: string;
  owner?: Damageable;
  debug?: boolean;
}

const RUN_SPEED_THRESHOLD = 4.7;
const WALK_SPEED_THRESHOLD = 0.15;

/**
 * Orquestador de animación procedural. Cada frame:
 *
 *  1. Restaura la pose snapshot (root T-pose del GLB)
 *  2. Aplica `HumanoidRestPose` (offsets fijos del preset)
 *  3. Corre los layers en orden, escribiendo offsets aditivos sobre bones/root
 *  4. Sincroniza los sensores live del ragdoll (hit detection por body part)
 *
 * Los `AnimationLayer` son responsables de su propio estado interno
 * (timers de hit/attack/reload). El animator sólo expone disparadores
 * (`hit()`, `attack()`, `reload()`) que reenvían al layer correspondiente.
 */
export class ProceduralCharacterAnimator {
  readonly mapper: BoneMapper;

  private readonly pose: PoseSnapshot;
  private readonly restPose: HumanoidRestPose;
  private readonly ragdoll: RagdollSystem;
  private readonly debug: AnimationDebug;

  private readonly locomotion: LocomotionLayer;
  private readonly posture: PostureLayer;
  private readonly idle = new IdleLayer();
  private readonly aim = new AimLayer();
  private readonly reload = new ReloadLayer();
  private readonly attack = new AttackLayer();
  private readonly hit = new HitLayer();
  private readonly lookAt: LookAtLayer;
  private readonly velocityLean = new VelocityLeanLayer();
  private readonly layers: AnimationLayer[];

  private isDead = false;

  constructor(private readonly options: ProceduralAnimatorOptions) {
    this.mapper = new BoneMapper(options.root, { debug: options.debug });
    this.pose = new PoseSnapshot(options.root);
    this.restPose = new HumanoidRestPose(options.animation, options.characterId);
    this.locomotion = new LocomotionLayer(options.animation);
    this.posture = new PostureLayer(options.animation);
    this.lookAt = new LookAtLayer(options.animation);

    this.layers = [
      this.locomotion,
      this.idle,
      this.posture,
      this.aim,
      this.reload,
      this.attack,
      this.hit,
      this.lookAt,
      this.velocityLean,
    ];

    this.ragdoll = new RagdollSystem({
      id: options.id,
      root: options.root,
      physics: options.physics,
      mapper: this.mapper,
      config: options.ragdoll,
      owner: options.owner,
    });
    if (
      (options.ragdoll?.activeWhileAlive ?? true) &&
      this.mapper.hasSkeleton()
    ) {
      this.ragdoll.ensureLiveSensors();
    }
    this.debug = new AnimationDebug(options.debug);
    this.debug.logMapping(this.mapper);
  }

  update(input: AnimationInput): void {
    if (this.isDead) {
      this.ragdoll.update(input.deltaTime);
      return;
    }

    if (input.isDead) {
      this.die();
      this.ragdoll.update(input.deltaTime);
      return;
    }

    for (const layer of this.layers) {
      layer.update?.(input);
    }

    this.pose.restore();
    this.restPose.apply(this.mapper.bones);

    const ctx: AnimationLayerContext = {
      root: this.options.root,
      bones: this.mapper.bones,
      hasSkeleton: this.mapper.hasSkeleton(),
      input,
    };
    for (const layer of this.layers) {
      layer.apply(ctx);
    }

    this.ragdoll.updateLiveSensors();
  }

  triggerHit(direction?: Vector3): void {
    this.hit.trigger(direction);
  }

  triggerAttack(): void {
    this.attack.trigger();
  }

  triggerReload(duration: number): void {
    this.reload.trigger(duration);
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.isDead) {
      return;
    }
    this.isDead = true;
    this.ragdoll.activate(hitDirection, undefined, hitPartName);
  }

  dieWithVelocity(
    hitDirection: Vector3 | undefined,
    currentVelocity: Vector3,
    hitPartName?: string,
  ): void {
    if (this.isDead) {
      return;
    }
    this.isDead = true;
    this.ragdoll.activate(hitDirection, currentVelocity, hitPartName);
  }

  isRagdollActive(): boolean {
    return this.ragdoll.isActive();
  }

  /**
   * Estado discreto derivado para debug / overlays. La animación real ya no
   * usa esto — vive en `AnimationInput`. Se mantiene como string descriptivo.
   */
  getState(input?: AnimationInput): ProceduralAnimationState {
    if (this.isDead) return "dead";
    if (!input) return "idle";
    const speed = input.locomotion.worldVelocity.length();
    if (input.activity === "meleeStrike" || input.activity === "meleeWindup") {
      return "attack";
    }
    if (speed > RUN_SPEED_THRESHOLD) return "run";
    if (speed > WALK_SPEED_THRESHOLD) return "walk";
    return "idle";
  }
}
