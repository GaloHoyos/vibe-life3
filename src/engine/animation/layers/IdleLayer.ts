import { ProceduralBalance } from "../ProceduralBalance";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

const IDLE_SPEED_THRESHOLD = 0.15;

/**
 * Respiración + sway leve cuando el personaje está parado. Lee del mismo
 * `ProceduralBalance` legacy para mantener paridad visual en F1.
 */
export class IdleLayer implements AnimationLayer {
  private readonly balance = new ProceduralBalance();

  apply(ctx: AnimationLayerContext): void {
    if (ctx.input.locomotion.worldVelocity.length() > IDLE_SPEED_THRESHOLD) {
      return;
    }
    this.balance.applyIdle(ctx.root, ctx.bones, ctx.input.time, 1);
  }
}
