import type { Object3D } from "three";
import type { AnimationInput } from "../AnimationInput";
import type { BoneMap } from "../BoneMapper";

export interface AnimationLayerContext {
  root: Object3D;
  bones: BoneMap;
  hasSkeleton: boolean;
  input: AnimationInput;
}

/**
 * Una capa procedural. El animator corre los layers en orden sobre la
 * rest-pose: cada layer escribe offsets aditivos en bones (o root) según
 * lo que indique `AnimationInput`.
 *
 * Layers con timers internos (Attack, Hit, Reload) los avanzan en `update`.
 * `apply` se llama después y rinde la pose final.
 */
export interface AnimationLayer {
  /** Avanza el estado interno del layer (timers, fases). */
  update?(input: AnimationInput): void;
  /** Aplica offsets sobre los bones / root. */
  apply(ctx: AnimationLayerContext): void;
}
