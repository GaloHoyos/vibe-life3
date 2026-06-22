import { ProceduralBalance } from "@engine/animation/procedural/ProceduralBalance";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

/**
 * Lean inercial: el root se inclina ligeramente en direcciÃ³n de la
 * `desiredDirection` cuando el personaje corre. No es una rotaciÃ³n de
 * bones â€” modifica `root.rotation` directamente.
 */
export class VelocityLeanLayer implements AnimationLayer {
  private readonly balance = new ProceduralBalance();

  apply(ctx: AnimationLayerContext): void {
    this.balance.applyVelocityLean(
      ctx.root,
      ctx.input.locomotion.worldVelocity,
      ctx.input.desiredDirection,
      1,
    );
  }
}
