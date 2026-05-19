/**
 * Flags globales para deshabilitar comportamientos de NPCs en runtime.
 * Útil para tuneo visual del `AimLayer` / `RestPoseTuning` sin que la AI
 * interfiera (no te disparan, no se mueven, fuerza pose de aim, etc.).
 */
export type ForcedAimPose = "none" | "twoHanded" | "oneHanded";

export const NpcDebugFlags = {
  ignorePlayer: false,
  freezeMovement: false,
  forceAimPose: "none" as ForcedAimPose,
};
