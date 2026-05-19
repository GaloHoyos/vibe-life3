/**
 * Override mutable del rest pose por character. Si el `characterId` que
 * recibe `HumanoidRestPose` coincide con una entrada acá, se usan estos
 * valores en lugar del rest pose declarado en el preset. Útil para tunear
 * en runtime via el panel de debug.
 *
 * Una vez encontrados los valores correctos, copiar acá como defaults y
 * actualizar los presets en `game/characters/CharacterPresets.ts`.
 */
export interface RestPoseValues {
  leftUpperArmX: number;
  leftUpperArmY: number;
  leftUpperArmZ: number;
  rightUpperArmX: number;
  rightUpperArmY: number;
  rightUpperArmZ: number;
  leftForearmX: number;
  leftForearmY: number;
  leftForearmZ: number;
  rightForearmX: number;
  rightForearmY: number;
  rightForearmZ: number;
  spineX: number;
  chestX: number;
  headX: number;
}

export const RestPoseTuning: Record<"combine" | "alyx" | "zombie", RestPoseValues> = {
  combine: {
    rightUpperArmX: 0.29,
    rightUpperArmY: -0.29,
    rightUpperArmZ: -0.79,
    rightForearmX: 0.76,
    rightForearmY: -0.87,
    rightForearmZ: -1.07,
    leftUpperArmX: 0.7,
    leftUpperArmY: 0.37,
    leftUpperArmZ: 0.43,
    leftForearmX: 0.68,
    leftForearmY: 0.42,
    leftForearmZ: 0.76,
    spineX: 0.1,
    chestX: 0.01,
    headX: -0.02,
  },
  alyx: {
    rightUpperArmX: -0.3,
    rightUpperArmY: -1.35,
    rightUpperArmZ: -0.65,
    rightForearmX: 0.53,
    rightForearmY: -0.25,
    rightForearmZ: -0.93,
    leftUpperArmX: -0.12,
    leftUpperArmY: 1.25,
    leftUpperArmZ: 1.14,
    leftForearmX: 0.08,
    leftForearmY: -0.19,
    leftForearmZ: 0.85,
    spineX: 0.02,
    chestX: 0.01,
    headX: -0.02,
  },
  zombie: {
    leftUpperArmX: -0.18,
    leftUpperArmY: 0,
    leftUpperArmZ: 1.18,
    rightUpperArmX: -0.18,
    rightUpperArmY: 0,
    rightUpperArmZ: -1.18,
    leftForearmX: -0.42,
    leftForearmY: 0,
    leftForearmZ: 0.32,
    rightForearmX: -0.42,
    rightForearmY: 0,
    rightForearmZ: -0.32,
    spineX: 0.08,
    chestX: 0.06,
    headX: -0.05,
  },
};

export type RestPoseTuningKey = keyof typeof RestPoseTuning;

export function getRestPoseTuning(
  characterId: string | undefined,
): RestPoseValues | undefined {
  if (!characterId) {
    return undefined;
  }
  return (RestPoseTuning as Record<string, RestPoseValues | undefined>)[
    characterId
  ];
}
