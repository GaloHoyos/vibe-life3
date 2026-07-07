import type { AimPoseTuning } from "@engine/animation/layers/AimTuning";
import type {
  WeaponAttachmentKey,
  WeaponAttachmentPose,
} from "@game/npc/combat/WeaponAttachmentTuning";
import type {
  PlayerModelPreviewOptions,
  PlayerModelSystem,
} from "@game/gameplay/player/PlayerModelSystem";

declare global {
  interface Window {
    /** Consola del playermodel para debug/verificación headless (mismo espíritu que __npcs). */
    __playerModel?: {
      status: () => ReturnType<PlayerModelSystem["getDebugStatus"]> | null;
      /** Planta el modelo frente a la cámara para calibrar poses; null desactiva. */
      preview: (options: PlayerModelPreviewOptions | null) => string;
      /** Tuning en vivo de la pose de arma del modelo actual (twoHanded/oneHanded). */
      tuneAim: (
        pose: "twoHanded" | "oneHanded",
        values: Partial<AimPoseTuning>,
      ) => AimPoseTuning | null;
      /** Tuning en vivo del attachment de un arma en la mano (rotación/posición). */
      tuneAttach: (
        key: WeaponAttachmentKey,
        values: Partial<WeaponAttachmentPose>,
      ) => WeaponAttachmentPose | null;
    };
  }
}

export function installPlayerModelConsole(
  get: () => PlayerModelSystem | null,
): () => void {
  const api: NonNullable<Window["__playerModel"]> = {
    status: () => get()?.getDebugStatus() ?? null,
    preview: (options) => {
      const system = get();
      if (!system) {
        return "sin playermodel cargado";
      }
      system.setPreview(options);
      return options ? "preview activo" : "preview desactivado";
    },
    tuneAim: (pose, values) => get()?.tuneAim(pose, values) ?? null,
    tuneAttach: (key, values) => get()?.tuneAttach(key, values) ?? null,
  };
  window.__playerModel = api;
  return () => {
    if (window.__playerModel === api) {
      delete window.__playerModel;
    }
  };
}
