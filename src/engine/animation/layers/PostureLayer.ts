import type {
  CharacterAnimationConfig,
  HumanoidBoneAxesConfig,
} from "@engine/characters/CharacterDefinition";
import { DefaultWalkOptions } from "@engine/animation/procedural/ProceduralWalk";
import { applyBoneRotationOffset } from "@engine/animation/pose/BoneRotation";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

const CROUCH_HIP_DROP = 0.35;
const CROUCH_THIGH_TUCK = 1.0;
const CROUCH_KNEE_BEND = 1.6;
const CROUCH_SPINE_BEND = 0.15;
const CROUCH_CHEST_BEND = 0.1;

const LEAN_SPINE = 0.2;
const LEAN_CHEST = 0.15;
const LEAN_HEAD_COUNTER = 0.1;

/**
 * Pose sentada: muslos casi horizontales, rodillas en L y torso levemente
 * reclinado. A diferencia del crouch no baja las caderas — quien sienta al
 * personaje (asiento de vehiculo) ya coloca el root a la altura del asiento.
 */
const SIT_THIGH_LIFT = 1.42;
const SIT_KNEE_BEND = 1.34;
const SIT_THIGH_SPREAD = 0.13;
const SIT_SPINE_RECLINE = 0.07;
const SIT_CHEST_RECLINE = 0.05;
/** Brazos apoyados sobre los muslos (pasajero). */
const SIT_REST_UPPER_ARM = 0.28;
const SIT_REST_FOREARM = -0.42;
/** Manos a los controles: codos flexionados al frente del pecho. */
const SIT_CONTROLS_UPPER_ARM = 0.62;
const SIT_CONTROLS_FOREARM = -0.72;
const SIT_CONTROLS_ARM_TUCK = 0.22;

/**
 * Crouch + lean + sentado por flexiÃ³n real de bones (no translate del visualRoot).
 *
 *  - Crouch (0..1) baja `hips` y dobla muslos/shins/spine simulando squat.
 *    El collider fÃ­sico no cambia: Ã©se sigue siendo full-height (lo decide
 *    el motor). AcÃ¡ sÃ³lo se ve la silueta de cuclillas.
 *  - Lean (-1..1) rota spine + chest sobre el eje "forward" del cuerpo
 *    (axis Z local). La cabeza counter-rota un poco para no quedar
 *    bizarramente inclinada.
 *  - Seated (0..1) arma la pose de asiento y, si no hay aim activo, apoya los
 *    brazos o los lleva a los controles segun `seatedControls`.
 *
 * Los valores `posture.crouch` / `posture.lean` los maneja el bridge con
 * lerping; este layer solo los lee.
 */
export class PostureLayer implements AnimationLayer {
  private readonly axes: HumanoidBoneAxesConfig;

  constructor(animation?: CharacterAnimationConfig) {
    this.axes = animation?.boneAxes ?? DefaultWalkOptions.boneAxes;
  }

  apply(ctx: AnimationLayerContext): void {
    if (!ctx.hasSkeleton) {
      return;
    }
    const { crouch, lean, seated } = ctx.input.posture;

    if (seated > 0.001) {
      this.applySeated(ctx, seated);
    }

    if (crouch > 0.001) {
      if (ctx.bones.hips) {
        ctx.bones.hips.position.y -= crouch * CROUCH_HIP_DROP;
      }
      applyBoneRotationOffset(
        ctx.bones.leftThigh,
        this.axes.legSwingAxis,
        -crouch * CROUCH_THIGH_TUCK,
      );
      applyBoneRotationOffset(
        ctx.bones.rightThigh,
        this.axes.legSwingAxis,
        -crouch * CROUCH_THIGH_TUCK,
      );
      applyBoneRotationOffset(
        ctx.bones.leftShin,
        this.axes.kneeBendAxis,
        crouch * CROUCH_KNEE_BEND,
      );
      applyBoneRotationOffset(
        ctx.bones.rightShin,
        this.axes.kneeBendAxis,
        crouch * CROUCH_KNEE_BEND,
      );
      const footCounter = -crouch * (CROUCH_KNEE_BEND - CROUCH_THIGH_TUCK);
      applyBoneRotationOffset(
        ctx.bones.leftFoot,
        this.axes.kneeBendAxis,
        footCounter,
      );
      applyBoneRotationOffset(
        ctx.bones.rightFoot,
        this.axes.kneeBendAxis,
        footCounter,
      );
      applyBoneRotationOffset(
        ctx.bones.spine,
        this.axes.spineLeanAxis,
        crouch * CROUCH_SPINE_BEND,
      );
      applyBoneRotationOffset(
        ctx.bones.chest,
        this.axes.spineLeanAxis,
        crouch * CROUCH_CHEST_BEND,
      );
    }

    if (Math.abs(lean) > 0.001) {
      applyBoneRotationOffset(ctx.bones.spine, "z", -lean * LEAN_SPINE);
      applyBoneRotationOffset(ctx.bones.chest, "z", -lean * LEAN_CHEST);
      applyBoneRotationOffset(ctx.bones.head, "z", lean * LEAN_HEAD_COUNTER);
    }
  }

  private applySeated(ctx: AnimationLayerContext, seated: number): void {
    const { legSwingAxis, kneeBendAxis, spineLeanAxis, armSwingAxis } = this.axes;

    applyBoneRotationOffset(
      ctx.bones.leftThigh,
      legSwingAxis,
      -seated * SIT_THIGH_LIFT,
    );
    applyBoneRotationOffset(
      ctx.bones.rightThigh,
      legSwingAxis,
      -seated * SIT_THIGH_LIFT,
    );
    applyBoneRotationOffset(ctx.bones.leftThigh, "z", seated * SIT_THIGH_SPREAD);
    applyBoneRotationOffset(
      ctx.bones.rightThigh,
      "z",
      -seated * SIT_THIGH_SPREAD,
    );
    applyBoneRotationOffset(
      ctx.bones.leftShin,
      kneeBendAxis,
      seated * SIT_KNEE_BEND,
    );
    applyBoneRotationOffset(
      ctx.bones.rightShin,
      kneeBendAxis,
      seated * SIT_KNEE_BEND,
    );
    const footCounter = -seated * (SIT_KNEE_BEND - SIT_THIGH_LIFT);
    applyBoneRotationOffset(ctx.bones.leftFoot, kneeBendAxis, footCounter);
    applyBoneRotationOffset(ctx.bones.rightFoot, kneeBendAxis, footCounter);
    applyBoneRotationOffset(
      ctx.bones.spine,
      spineLeanAxis,
      -seated * SIT_SPINE_RECLINE,
    );
    applyBoneRotationOffset(
      ctx.bones.chest,
      spineLeanAxis,
      -seated * SIT_CHEST_RECLINE,
    );

    // El AimLayer corre despues y manda sobre los brazos: cuando apunta, la
    // pose de asiento se aparta para no sumar dos rotaciones sobre el mismo hueso.
    const armWeight = seated * (1 - ctx.input.aim.weight);
    if (armWeight <= 0.001) return;
    const controls = ctx.input.posture.seatedControls;
    const upperArm =
      SIT_REST_UPPER_ARM +
      (SIT_CONTROLS_UPPER_ARM - SIT_REST_UPPER_ARM) * controls;
    const forearm =
      SIT_REST_FOREARM + (SIT_CONTROLS_FOREARM - SIT_REST_FOREARM) * controls;
    const tuck = SIT_CONTROLS_ARM_TUCK * controls * armWeight;
    applyBoneRotationOffset(
      ctx.bones.leftUpperArm,
      armSwingAxis,
      upperArm * armWeight,
    );
    applyBoneRotationOffset(
      ctx.bones.rightUpperArm,
      armSwingAxis,
      upperArm * armWeight,
    );
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", -tuck);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "z", tuck);
    applyBoneRotationOffset(
      ctx.bones.leftForearm,
      this.axes.elbowBendAxis,
      forearm * armWeight,
    );
    applyBoneRotationOffset(
      ctx.bones.rightForearm,
      this.axes.elbowBendAxis,
      forearm * armWeight,
    );
  }
}
