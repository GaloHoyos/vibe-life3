import { applyBoneRotationOffset } from "@engine/animation/pose/BoneRotation";
import type { AnimationInput } from "@engine/animation/AnimationInput";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

const MELEE_DURATION = 0.4;
const MELEE_WINDUP = 0.15;
const RECOIL_DURATION = 0.13;

/**
 * Capa de ataque:
 *
 *  - Melee: ciclo windup (brazo atrÃ¡s) â†’ strike (extensiÃ³n rÃ¡pida) â†’
 *    recovery (vuelve a rest). Curva 3-fases, no media-sinoide naive.
 *  - Recoil de disparo: pulse corto sobre torso + brazo derecho cada vez
 *    que `events.shotJustFired` es true. Decay lineal, no acumula.
 *
 * Ambas modalidades co-existen: un mismo frame puede haber recibido un
 * `triggerAttack()` (melee) y un `shotJustFired` (e.g. NPC tira tackle
 * mientras dispara), aunque en la prÃ¡ctica los presets actuales se
 * comportan como melee XOR ranged.
 */
export class AttackLayer implements AnimationLayer {
  private meleeTimer = 0;
  private recoilTimer = 0;

  trigger(): void {
    this.meleeTimer = MELEE_DURATION;
  }

  update(input: AnimationInput): void {
    if (this.meleeTimer > 0) {
      this.meleeTimer = Math.max(0, this.meleeTimer - input.deltaTime);
    }
    if (input.events.shotJustFired) {
      this.recoilTimer = RECOIL_DURATION;
    }
    if (this.recoilTimer > 0) {
      this.recoilTimer = Math.max(0, this.recoilTimer - input.deltaTime);
    }
  }

  apply(ctx: AnimationLayerContext): void {
    if (this.meleeTimer > 0) {
      this.applyMelee(ctx);
    }
    if (this.recoilTimer > 0) {
      this.applyRecoil(ctx);
    }
  }

  private applyMelee(ctx: AnimationLayerContext): void {
    const elapsed = MELEE_DURATION - this.meleeTimer;
    const windupT = MELEE_WINDUP;
    let phase: "windup" | "strike" | "recovery";
    let p: number;
    if (elapsed < windupT) {
      phase = "windup";
      p = elapsed / windupT;
    } else if (elapsed < MELEE_DURATION * 0.55) {
      phase = "strike";
      p = (elapsed - windupT) / (MELEE_DURATION * 0.55 - windupT);
    } else {
      phase = "recovery";
      p = (elapsed - MELEE_DURATION * 0.55) /
        (MELEE_DURATION - MELEE_DURATION * 0.55);
    }

    let armForward = 0;
    let forearmBend = 0;
    let chestTwist = 0;
    if (phase === "windup") {
      armForward = 0.35 * easeOut(p);
      forearmBend = 0.7 * easeOut(p);
      chestTwist = -0.18 * easeOut(p);
    } else if (phase === "strike") {
      armForward = 0.35 + -1.55 * easeIn(p);
      forearmBend = 0.7 + -1.25 * easeIn(p);
      chestTwist = -0.18 + 0.4 * easeIn(p);
    } else {
      armForward = (-1.2) * (1 - p);
      forearmBend = -0.55 * (1 - p);
      chestTwist = 0.22 * (1 - p);
    }

    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", armForward);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", forearmBend);
    applyBoneRotationOffset(ctx.bones.chest, "y", chestTwist);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "z", 0.18 * (1 - p));
  }

  private applyRecoil(ctx: AnimationLayerContext): void {
    const t = this.recoilTimer / RECOIL_DURATION;
    const kick = t;

    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", 0.18 * kick);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", 0.12 * kick);
    applyBoneRotationOffset(ctx.bones.chest, "x", -0.08 * kick);
    applyBoneRotationOffset(ctx.bones.spine, "x", -0.04 * kick);
    applyBoneRotationOffset(ctx.bones.head, "x", -0.05 * kick);
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}
