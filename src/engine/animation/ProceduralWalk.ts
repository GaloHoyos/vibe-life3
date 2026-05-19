import type {
  ArmsMode,
  HumanoidBoneAxesConfig,
} from "../characters/CharacterDefinition";

export type WalkStyle = "normal" | "staggered" | "heavy" | "creature";

/**
 * Parámetros del ciclo de paso del `LocomotionLayer`. Históricamente vivía
 * en una clase `ProceduralWalk`; quedó como datos puros más los defaults
 * (la lógica vive ahora en `layers/LocomotionLayer.ts`).
 */
export interface ProceduralWalkConfig {
  stepFrequency: number;
  strideLength: number;
  stepHeight: number;
  armSwing: number;
  torsoBob: number;
  torsoLean: number;
  smoothing: number;
  maxLegSwing: number;
  maxKneeBend: number;
  maxFootRotation: number;
  maxSideSwing: number;
  maxArmSwing: number;
  maxTorsoLean: number;
  maxHeadYaw: number;
  maxHeadPitch: number;
  sideToSide: number;
  randomness: number;
  style: WalkStyle;
}

export interface ProceduralWalkOptions {
  boneAxes: HumanoidBoneAxesConfig;
  armsMode: ArmsMode;
}

export const DefaultWalkConfig: ProceduralWalkConfig = {
  stepFrequency: 3.4,
  strideLength: 0.36,
  stepHeight: 0.04,
  armSwing: 0.22,
  torsoBob: 0.04,
  torsoLean: 0.14,
  smoothing: 10,
  maxLegSwing: 0.5,
  maxKneeBend: 0.36,
  maxFootRotation: 0.22,
  maxSideSwing: 0.06,
  maxArmSwing: 0.26,
  maxTorsoLean: 0.22,
  maxHeadYaw: 0.65,
  maxHeadPitch: 0.35,
  sideToSide: 0.015,
  randomness: 0.04,
  style: "normal",
};

export const DefaultWalkOptions: ProceduralWalkOptions = {
  boneAxes: {
    legSwingAxis: "x",
    armSwingAxis: "x",
    kneeBendAxis: "x",
    elbowBendAxis: "x",
    spineLeanAxis: "x",
    headYawAxis: "y",
  },
  armsMode: "relaxed",
};
