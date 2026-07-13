/**
 * Flags globales para deshabilitar comportamientos de NPCs en runtime.
 * Útil para tuneo visual del `AimLayer` / `RestPoseTuning` sin que la AI
 * interfiera (no te disparan, no se mueven, fuerza pose de aim, etc.).
 */
export type ForcedAimPose = "none" | "twoHanded" | "oneHanded";

export const NpcDebugFlags = {
  /** Los NPCs no consideran al player como threat (lo dejan en paz). */
  ignorePlayer: false,
  freezeMovement: false,
  /**
   * Free-for-all de debug: cada NPC trata a todos los demas como hostiles,
   * sin importar la faccion. Para testear matchups entre criaturas del mismo
   * bando (manhack vs headcrab/zombie) sin cambiar el juego.
   */
  infighting: false,
  forceAimPose: "none" as ForcedAimPose,
  /**
   * Dibuja las partículas individuales del organismo blob (rol por color,
   * chunks desprendidos tintados) a través de la piel de metaballs.
   */
  showBlobParticles: false,
};
