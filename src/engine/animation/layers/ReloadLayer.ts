import { applyBoneRotationOffset } from "../BoneRotation";
import type { AnimationInput } from "../AnimationInput";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

/**
 * Clip procedural de recarga, autoritativo sobre los brazos durante
 * `triggerReload(duration)`. El bridge se ocupa de bajar el aimWeight a
 * 0 mientras `activity === 'reloading'`, para que las dos capas no
 * peleen por la pose.
 *
 * twoHanded (rifle/smg/ar3): drop → grab → slap → rack.
 * oneHanded (pistol): swap del cargador del lado contrario.
 *
 * Cada fase es un "bump" centrado en un t∈[0,1] con ancho propio. La suma
 * de bumps esculpe la pose visual.
 */
export class ReloadLayer implements AnimationLayer {
  private duration = 0;
  private timer = 0;

  trigger(duration: number): void {
    if (duration <= 0) {
      return;
    }
    this.duration = duration;
    this.timer = duration;
  }

  update(input: AnimationInput): void {
    if (this.timer > 0) {
      this.timer = Math.max(0, this.timer - input.deltaTime);
    }
  }

  apply(ctx: AnimationLayerContext): void {
    if (this.timer <= 0 || this.duration <= 0) {
      return;
    }
    const t = 1 - this.timer / this.duration;
    const pose = ctx.input.aim.weaponPose;

    if (pose === "twoHanded") {
      this.applyTwoHanded(ctx, t);
    } else if (pose === "oneHanded") {
      this.applyOneHanded(ctx, t);
    } else {
      this.applyTwoHanded(ctx, t);
    }
  }

  private applyTwoHanded(ctx: AnimationLayerContext, t: number): void {
    const drop = bump(t, 0.25, 0.25);
    const grab = bump(t, 0.55, 0.2);
    const slap = bump(t, 0.78, 0.12);
    const rack = bump(t, 0.92, 0.08);

    const leftUpDown = drop * 0.9 + grab * 0.4;
    const leftBack = grab * 0.6;
    const leftForward = slap * 1.1;
    const leftForearmBend = drop * 0.5 + slap * 0.4;

    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", -leftUpDown * 0.7);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "x", leftBack * 0.35);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "x", -leftForward * 0.5);
    applyBoneRotationOffset(ctx.bones.leftForearm, "x", -leftForearmBend * 0.8);

    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", -rack * 0.3);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", -rack * 0.25);

    applyBoneRotationOffset(ctx.bones.chest, "x", -drop * 0.08 - slap * 0.04);
    applyBoneRotationOffset(ctx.bones.head, "x", drop * 0.06);
  }

  private applyOneHanded(ctx: AnimationLayerContext, t: number): void {
    const reach = bump(t, 0.25, 0.2);
    const swap = bump(t, 0.55, 0.2);
    const insert = bump(t, 0.8, 0.18);

    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", -reach * 0.5);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "x", reach * 0.4 - insert * 0.7);
    applyBoneRotationOffset(ctx.bones.leftForearm, "x", -(reach + swap) * 0.5);

    applyBoneRotationOffset(ctx.bones.rightForearm, "x", swap * 0.15);

    applyBoneRotationOffset(ctx.bones.chest, "x", -swap * 0.05);
    applyBoneRotationOffset(ctx.bones.head, "x", reach * 0.04);
  }
}

/**
 * Bump triangular suavizado centrado en `center` con ancho total `width`.
 * Devuelve 0 fuera del rango y un coseno-half que asciende a 1 al centro.
 */
function bump(t: number, center: number, width: number): number {
  const dist = Math.abs(t - center);
  if (dist > width) {
    return 0;
  }
  return Math.cos((dist / width) * Math.PI * 0.5);
}
