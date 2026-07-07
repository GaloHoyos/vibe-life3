import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { CharacterAnimationConfig } from "@engine/characters/CharacterDefinition";

/**
 * Modelos de jugador disponibles. El playermodel se elige por nivel
 * (`LevelDefinition.playerModel`, editable en el editor) y se renderiza solo
 * en las vistas de portal: en primera persona el cuerpo no se dibuja.
 */
export type PlayerModelId = "gordon" | "postHumanGordon";

export interface PlayerModelDefinition {
  modelId: ModelAssetId;
  /** Nombre visible en el selector del editor. */
  label: string;
  visualScale: number;
  visualRotationY: number;
  animation: CharacterAnimationConfig;
}

/**
 * Animación humanoide del jugador con arma en mano (misma base que alyx/combine
 * en `CharacterPresets`): brazos a la pose de tiro (`weaponAim` + `AimLayer`),
 * walk procedural default. `useStumble` apagado — el jugador no se tropieza, su
 * knockback lo maneja el controller. El rest pose es la base sobre la que el
 * `AimLayer` suma la pose de arma; los offsets finos por modelo van en
 * `RestPoseTuning`/`AimTuningOverrides` (el bind pose de cada GLB difiere).
 */
const weaponHumanoidAnimation: CharacterAnimationConfig = {
  mode: "procedural",
  ignoreBakedAnimations: true,
  restPose: {
    type: "tpose_to_relaxed",
    leftUpperArm: { z: 1.05 },
    rightUpperArm: { z: -1.05 },
    leftForearm: { z: 0.2 },
    rightForearm: { z: -0.2 },
    spine: { x: 0.03 },
    chest: { x: 0.02 },
    head: { x: -0.02 },
  },
  armsMode: "weaponAim",
  boneAxes: {
    legSwingAxis: "x",
    armSwingAxis: "x",
    kneeBendAxis: "x",
    elbowBendAxis: "x",
    spineLeanAxis: "x",
    headYawAxis: "y",
  },
  walkStyle: "normal",
  useLookAt: true,
  useStumble: false,
  walk: {},
  maxHeadYaw: 0.65,
  maxHeadPitch: 0.35,
};

export const DefaultPlayerModelId: PlayerModelId = "gordon";

export const PlayerModels: Record<PlayerModelId, PlayerModelDefinition> = {
  gordon: {
    modelId: "gordon",
    label: "Gordon",
    visualScale: 1,
    visualRotationY: 0,
    animation: weaponHumanoidAnimation,
  },
  postHumanGordon: {
    modelId: "postHumanGordon",
    label: "Gordon post-humano",
    visualScale: 1,
    visualRotationY: 0,
    animation: weaponHumanoidAnimation,
  },
};

export const PLAYER_MODEL_IDS = Object.keys(
  PlayerModels,
) as readonly PlayerModelId[];

/**
 * Valida un id que puede venir de datos externos (mapas del Workshop, drafts
 * viejos): cualquier valor desconocido cae al default en vez de romper la carga.
 */
export function resolvePlayerModel(id: string | undefined): PlayerModelId {
  if (id !== undefined && Object.prototype.hasOwnProperty.call(PlayerModels, id)) {
    return id as PlayerModelId;
  }
  return DefaultPlayerModelId;
}
