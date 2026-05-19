import { ProceduralBalance } from "../ProceduralBalance";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

/**
 * Lean inercial: el root se inclina ligeramente en dirección de la
 * `desiredDirection` cuando el personaje corre. No es una rotación de
 * bones — modifica `root.rotation` directamente.
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
