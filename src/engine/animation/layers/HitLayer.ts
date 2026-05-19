import { Vector3 } from "three";
import { applyBoneRotationOffset } from "../BoneRotation";
import type { AnimationInput } from "../AnimationInput";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

const HIT_DURATION = 0.22;

/**
 * Recoil corporal cuando el NPC recibe un hit. El director del hit viene de
 * `trigger()`; la curva es media-sinoide sobre `HIT_DURATION`.
 */
export class HitLayer implements AnimationLayer {
  private readonly hitDirection = new Vector3(0, 0, 1);
  private timer = 0;

  trigger(direction?: Vector3): void {
    this.timer = HIT_DURATION;
    if (direction && direction.lengthSq() > 0.001) {
      this.hitDirection.copy(direction).normalize();
    }
  }

  update(input: AnimationInput): void {
    if (this.timer > 0) {
      this.timer = Math.max(0, this.timer - input.deltaTime);
    }
  }

  apply(ctx: AnimationLayerContext): void {
    if (this.timer <= 0) {
      return;
    }

    const progress = 1 - this.timer / HIT_DURATION;
    const recoil = Math.sin(progress * Math.PI);

    applyBoneRotationOffset(ctx.bones.spine, "x", -0.28 * recoil);
    applyBoneRotationOffset(ctx.bones.chest, "x", -0.36 * recoil);
    applyBoneRotationOffset(
      ctx.bones.head,
      "y",
      this.hitDirection.x * 0.45 * recoil,
    );
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", -0.45 * recoil);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "z", 0.45 * recoil);
  }
}
