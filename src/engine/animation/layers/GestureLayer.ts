import { applyBoneRotationOffset } from "@engine/animation/pose/BoneRotation";
import type { AnimationInput, GestureId } from "@engine/animation/AnimationInput";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

/**
 * Gestos procedurales one-shot sobre brazos/torso (señalar, saludar, hablar),
 * disparados por `triggerGesture(id, duration)`. Cada gesto es una pose base
 * escalada por una envolvente de entrada/salida; `talk`/`wave` agregan una
 * oscilación temporal. Cede peso cuando el NPC está apuntando (`aim.weight`)
 * para no pelear con el AimLayer.
 *
 * `crouch` NO se rinde acá: el bridge lo mapea a `setCrouch`.
 */
export class GestureLayer implements AnimationLayer {
  private gesture: Exclude<GestureId, "crouch"> | null = null;
  private duration = 0;
  private timer = 0;
  private phase = 0;

  trigger(id: GestureId, duration: number): void {
    if (id === "crouch" || duration <= 0) return;
    this.gesture = id;
    this.duration = duration;
    this.timer = duration;
    this.phase = 0;
  }

  update(input: AnimationInput): void {
    if (this.timer <= 0) return;
    this.timer = Math.max(0, this.timer - input.deltaTime);
    this.phase += input.deltaTime;
    if (this.timer <= 0) this.gesture = null;
  }

  apply(ctx: AnimationLayerContext): void {
    if (!this.gesture || this.timer <= 0 || this.duration <= 0) return;
    // El aim manda sobre los brazos: el gesto se desvanece mientras apunta.
    const weight = envelope(1 - this.timer / this.duration) * (1 - ctx.input.aim.weight);
    if (weight <= 0.001) return;

    switch (this.gesture) {
      case "point":
        this.applyPoint(ctx, weight);
        return;
      case "wave":
        this.applyWave(ctx, weight);
        return;
      case "talk":
        this.applyTalk(ctx, weight);
        return;
    }
  }

  /** Brazo derecho extendido al frente, señalando hacia adelante. */
  private applyPoint(ctx: AnimationLayerContext, w: number): void {
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", -1.1 * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", -0.15 * w);
    applyBoneRotationOffset(ctx.bones.chest, "y", -0.1 * w);
    applyBoneRotationOffset(ctx.bones.head, "y", -0.12 * w);
  }

  /** Brazo derecho arriba oscilando de lado a lado (saludo). */
  private applyWave(ctx: AnimationLayerContext, w: number): void {
    const swing = Math.sin(this.phase * 9) * 0.35;
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", -1.9 * w);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "z", -0.4 * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "z", swing * w);
    applyBoneRotationOffset(ctx.bones.head, "x", 0.05 * w);
  }

  /** Gesticulación suave de antebrazos + torso (hablar). */
  private applyTalk(ctx: AnimationLayerContext, w: number): void {
    const beat = Math.sin(this.phase * 6);
    const beatOff = Math.sin(this.phase * 6 + 1.6);
    applyBoneRotationOffset(ctx.bones.rightUpperArm, "x", (-0.35 + beat * 0.12) * w);
    applyBoneRotationOffset(ctx.bones.rightForearm, "x", (-0.6 + beat * 0.25) * w);
    applyBoneRotationOffset(ctx.bones.leftUpperArm, "x", (-0.3 + beatOff * 0.1) * w);
    applyBoneRotationOffset(ctx.bones.leftForearm, "x", (-0.55 + beatOff * 0.22) * w);
    applyBoneRotationOffset(ctx.bones.chest, "x", -0.03 * w);
  }
}

/** Ease-in/out: sube en el primer 20%, sostiene, baja en el último 20%. */
function envelope(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.2) return Math.sin((t / 0.2) * Math.PI * 0.5);
  if (t > 0.8) return Math.sin(((1 - t) / 0.2) * Math.PI * 0.5);
  return 1;
}
