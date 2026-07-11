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
 * Crouch + lean por flexiÃ³n real de bones (no translate del visualRoot).
 *
 *  - Crouch (0..1) baja `hips` y dobla muslos/shins/spine simulando squat.
 *    El collider fÃ­sico no cambia: Ã©se sigue siendo full-height (lo decide
 *    el motor). AcÃ¡ sÃ³lo se ve la silueta de cuclillas.
 *  - Lean (-1..1) rota spine + chest sobre el eje "forward" del cuerpo
 *    (axis Z local). La cabeza counter-rota un poco para no quedar
 *    bizarramente inclinada.
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
    const { crouch, lean } = ctx.input.posture;

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
}
