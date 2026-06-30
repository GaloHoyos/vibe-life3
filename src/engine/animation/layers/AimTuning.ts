/**
 * Valores tunables del `AimLayer`. Se exponen mutables para que el panel
 * de debug pueda ajustarlos en runtime. Una vez encontrados los valores
 * correctos, copiar los números acá como defaults y borrar el panel.
 */
export interface AimPoseTuning {
  rightUpperArmX: number;
  rightUpperArmY: number;
  rightUpperArmZ: number;
  rightForearmX: number;
  rightForearmY: number;
  rightForearmZ: number;
  leftUpperArmX: number;
  leftUpperArmY: number;
  leftUpperArmZ: number;
  leftForearmX: number;
  leftForearmY: number;
  leftForearmZ: number;
  spinePitchFactor: number;
  chestPitchFactor: number;
}

export interface AimTuningStore {
  twoHanded: AimPoseTuning;
  oneHanded: AimPoseTuning;
}

export const AimTuning: AimTuningStore = {
  twoHanded: {
    rightUpperArmX: 0.58,
    rightUpperArmY: 0.09,
    rightUpperArmZ: 0.58,
    rightForearmX: -0.65,
    rightForearmY: -0.28,
    rightForearmZ: -0.89,
    leftUpperArmX: -0.32,
    leftUpperArmY: -0.15,
    leftUpperArmZ: 0.62,
    leftForearmX: 0.1,
    leftForearmY: -1.18,
    leftForearmZ: 0.02,
    spinePitchFactor: 0.3,
    chestPitchFactor: 0.2,
  },
  oneHanded: {
    rightUpperArmX: 0.39,
    rightUpperArmY: 1.08,
    rightUpperArmZ: -1.84,
    rightForearmX: -0.45,
    rightForearmY: -0.18,
    rightForearmZ: 0.17,
    leftUpperArmX: -0.75,
    leftUpperArmY: -0.37,
    leftUpperArmZ: 0.43,
    leftForearmX: -0.05,
    leftForearmY: 0,
    leftForearmZ: 0,
    spinePitchFactor: 0.18,
    chestPitchFactor: 0.12,
  },
};

/**
 * Overrides de aim por `characterId`. El `AimTuning` de arriba es el default
 * compartido; las variantes cuyo bind pose de malla difiere (mismo esqueleto,
 * distinto rest transform — típico entre modelos Meshy) necesitan su propia
 * pose para que los offsets caigan bien. Resolución análoga a `RestPoseTuning`.
 * Override parcial: lo que no esté acá cae al default compartido.
 */
export const AimTuningOverrides: Record<string, Partial<AimTuningStore>> = {
  combineElite: {
    twoHanded: {
      rightUpperArmX: 0.61,
      rightUpperArmY: 0.18,
      rightUpperArmZ: 0.58,
      rightForearmX: -1.43,
      rightForearmY: -0.28,
      rightForearmZ: -0.89,
      leftUpperArmX: -0.32,
      leftUpperArmY: -0.15,
      leftUpperArmZ: 0.62,
      leftForearmX: 0.1,
      leftForearmY: -1.18,
      leftForearmZ: 0.02,
      spinePitchFactor: 0.3,
      chestPitchFactor: 0.2,
    },
  },
};

/** Pose de aim efectiva: override del character si existe, si no el default. */
export function getAimPose(
  characterId: string | undefined,
  pose: keyof AimTuningStore,
): AimPoseTuning {
  return AimTuningOverrides[characterId ?? ""]?.[pose] ?? AimTuning[pose];
}
