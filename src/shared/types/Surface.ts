/**
 * Tipo de superficie física, usado para elegir el pool de pasos y el feedback
 * de impacto. Agnóstico del render: lo derivan los builders/loader desde el
 * material visual y lo lee el `FootstepSoundSystem` vía un raycast al suelo.
 */
export type SurfaceType =
  | "concrete"
  | "metal"
  | "wood"
  | "dirt"
  | "grass"
  | "sand"
  | "gravel"
  | "snow"
  | "tile"
  | "mud"
  | "glass"
  | "plastic"
  | "cardboard"
  | "rubber"
  /** Tapizado, colchones, bolsas: absorbe en vez de devolver. */
  | "fabric";
