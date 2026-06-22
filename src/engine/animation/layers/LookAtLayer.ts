import { MathUtils } from "three";
import type { CharacterAnimationConfig } from "@engine/characters/CharacterDefinition";
import { applyBoneRotationOffset } from "@engine/animation/pose/BoneRotation";
import { DefaultWalkConfig } from "@engine/animation/procedural/ProceduralWalk";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

/**
 * Aplica yaw + pitch a head/neck/chest siguiendo `lookDirection`. Si
 * `lookDirection` no estÃ¡ definido o el NPC estÃ¡ muerto, no hace nada.
 *
 * Los lÃ­mites de yaw/pitch vienen de la `CharacterAnimationConfig` para que
 * presets como combine puedan girar mÃ¡s la cabeza que un zombie.
 */
export class LookAtLayer implements AnimationLayer {
  private readonly maxYaw: number;
  private readonly maxPitch: number;
  private readonly headYawAxis: "x" | "y" | "z";

  constructor(animation?: CharacterAnimationConfig) {
    this.maxYaw = animation?.maxHeadYaw ?? DefaultWalkConfig.maxHeadYaw;
    this.maxPitch = animation?.maxHeadPitch ?? DefaultWalkConfig.maxHeadPitch;
    this.headYawAxis = animation?.boneAxes.headYawAxis ?? "y";
  }

  apply(ctx: AnimationLayerContext): void {
    const direction = ctx.input.lookDirection;
    if (!direction || direction.lengthSq() <= 0.001 || ctx.input.isDead) {
      return;
    }

    const local = direction.clone().normalize();
    const yaw = MathUtils.clamp(
      Math.atan2(local.x, local.z),
      -this.maxYaw,
      this.maxYaw,
    );
    const pitch = MathUtils.clamp(
      Math.asin(MathUtils.clamp(local.y, -1, 1)),
      -this.maxPitch,
      this.maxPitch,
    );

    applyBoneRotationOffset(ctx.bones.head, this.headYawAxis, yaw);
    applyBoneRotationOffset(ctx.bones.head, "x", -pitch);
    applyBoneRotationOffset(ctx.bones.neck, this.headYawAxis, yaw * 0.35);
    applyBoneRotationOffset(ctx.bones.chest, this.headYawAxis, yaw * 0.18);
  }
}
