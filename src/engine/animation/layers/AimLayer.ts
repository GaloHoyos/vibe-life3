import { MathUtils } from "three";
import { applyBoneRotationOffset } from "@engine/animation/pose/BoneRotation";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";
import { AimTuning, type AimPoseTuning } from "./AimTuning";

const MAX_PITCH = Math.PI * 0.35;

/**
 * Lleva los brazos a la pose de tiro y pitchea el torso hacia el target.
 * Lee los valores de `AimTuning` para permitir tuneo en runtime via la
 * pestania NPCs del DebugMenu (F3).
 */
export class AimLayer implements AnimationLayer {
  apply(ctx: AnimationLayerContext): void {
    const aim = ctx.input.aim;
    if (!aim.active || aim.weaponPose === "none" || aim.weight <= 0.001) {
      return;
    }

    const w = aim.weight;
    const pitch = MathUtils.clamp(
      Math.asin(MathUtils.clamp(aim.localDirection.y, -1, 1)),
      -MAX_PITCH,
      MAX_PITCH,
    );

    const t: AimPoseTuning =
      aim.weaponPose === "twoHanded" ? AimTuning.twoHanded : AimTuning.oneHanded;

    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", t.rightUpperArmX * w);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "y", t.rightUpperArmY * w);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "z", t.rightUpperArmZ * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", t.rightForearmX * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "y", t.rightForearmY * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "z", t.rightForearmZ * w);

    applyBoneRotationOffset(ctx.bones.leftUpperArm, "x", t.leftUpperArmX * w);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "y", t.leftUpperArmY * w);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", t.leftUpperArmZ * w);
    applyBoneRotationOffset(ctx.bones.leftForearm, "x", t.leftForearmX * w);
    applyBoneRotationOffset(ctx.bones.leftForearm, "y", t.leftForearmY * w);
    applyBoneRotationOffset(ctx.bones.leftForearm, "z", t.leftForearmZ * w);

    applyBoneRotationOffset(ctx.bones.spine, "x", -pitch * t.spinePitchFactor * w);
    applyBoneRotationOffset(ctx.bones.chest, "x", -pitch * t.chestPitchFactor * w);
  }
}
