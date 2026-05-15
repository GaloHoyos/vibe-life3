import { MathUtils, Vector3 } from 'three';
import type { ArmsMode, HumanoidBoneAxesConfig } from '../characters/CharacterDefinition';
import type { BoneMap } from './BoneMapper';
import { applyBoneRotationOffset } from './BoneRotation';

export type WalkStyle = 'normal' | 'staggered' | 'heavy' | 'creature';

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
  style: 'normal',
};

export const DefaultWalkOptions: ProceduralWalkOptions = {
  boneAxes: {
    legSwingAxis: 'x',
    armSwingAxis: 'x',
    kneeBendAxis: 'x',
    elbowBendAxis: 'x',
    spineLeanAxis: 'x',
    headYawAxis: 'y',
  },
  armsMode: 'relaxed',
};

export class ProceduralWalk {
  constructor(
    private readonly config: ProceduralWalkConfig = DefaultWalkConfig,
    private readonly options: ProceduralWalkOptions = DefaultWalkOptions,
  ) {}

  apply(bones: BoneMap, velocity: Vector3, time: number, intensity: number, runMultiplier = 1): number {
    const speed = velocity.length();
    const styleMultiplier = getStyleMultiplier(this.config.style);
    const normalizedSpeed = MathUtils.clamp(speed / 3.2, 0, 1.25);
    const phase = time * this.config.stepFrequency * Math.max(0.25, normalizedSpeed) * runMultiplier * styleMultiplier;
    const leftStep = Math.sin(phase);
    const rightStep = Math.sin(phase + Math.PI);
    const leftLift = Math.max(0, Math.cos(phase)) * this.config.stepHeight * intensity;
    const rightLift = Math.max(0, Math.cos(phase + Math.PI)) * this.config.stepHeight * intensity;
    const stride = clamp(this.config.strideLength * intensity * runMultiplier, this.config.maxLegSwing);
    const armSwing = clamp(this.config.armSwing * intensity * runMultiplier * getArmSwingMultiplier(this.options.armsMode), this.config.maxArmSwing);
    const kneeBend = MathUtils.clamp(stride * 0.55, 0, this.config.maxKneeBend);
    const torsoLean = clamp(this.config.torsoLean * intensity * runMultiplier, this.config.maxTorsoLean);
    const side = MathUtils.clamp(Math.sin(phase) * this.config.sideToSide * intensity, -this.config.maxSideSwing, this.config.maxSideSwing);
    const staggerNoise = this.config.style === 'staggered' ? Math.sin(time * 2.1) * this.config.randomness : 0;

    applyBoneRotationOffset(bones.leftThigh, this.options.boneAxes.legSwingAxis, MathUtils.clamp(leftStep * stride + staggerNoise * 0.25, -this.config.maxLegSwing, this.config.maxLegSwing));
    applyBoneRotationOffset(bones.rightThigh, this.options.boneAxes.legSwingAxis, MathUtils.clamp(rightStep * stride - staggerNoise * 0.25, -this.config.maxLegSwing, this.config.maxLegSwing));
    applyBoneRotationOffset(bones.leftShin, this.options.boneAxes.kneeBendAxis, MathUtils.clamp(Math.max(0, -leftStep) * kneeBend + leftLift, 0, this.config.maxKneeBend));
    applyBoneRotationOffset(bones.rightShin, this.options.boneAxes.kneeBendAxis, MathUtils.clamp(Math.max(0, -rightStep) * kneeBend + rightLift, 0, this.config.maxKneeBend));
    applyBoneRotationOffset(bones.leftFoot, this.options.boneAxes.kneeBendAxis, MathUtils.clamp(-leftStep * 0.08, -this.config.maxFootRotation, this.config.maxFootRotation));
    applyBoneRotationOffset(bones.rightFoot, this.options.boneAxes.kneeBendAxis, MathUtils.clamp(-rightStep * 0.08, -this.config.maxFootRotation, this.config.maxFootRotation));

    applyBoneRotationOffset(bones.leftUpperArm, this.options.boneAxes.armSwingAxis, rightStep * armSwing * 0.55);
    applyBoneRotationOffset(bones.rightUpperArm, this.options.boneAxes.armSwingAxis, leftStep * armSwing * 0.55);
    applyBoneRotationOffset(bones.leftForearm, this.options.boneAxes.elbowBendAxis, getForearmBend(this.options.armsMode, leftStep, intensity));
    applyBoneRotationOffset(bones.rightForearm, this.options.boneAxes.elbowBendAxis, getForearmBend(this.options.armsMode, rightStep, intensity));

    applyBoneRotationOffset(bones.spine, this.options.boneAxes.spineLeanAxis, torsoLean);
    applyBoneRotationOffset(bones.chest, this.options.boneAxes.spineLeanAxis, torsoLean * 0.45);
    applyBoneRotationOffset(bones.chest, 'z', side);

    return Math.abs(Math.sin(phase * 2)) * this.config.torsoBob * intensity * runMultiplier;
  }
}

function clamp(value: number, max: number): number {
  return MathUtils.clamp(value, -max, max);
}

function getStyleMultiplier(style: WalkStyle): number {
  if (style === 'staggered') {
    return 0.74;
  }

  if (style === 'heavy') {
    return 0.72;
  }

  if (style === 'creature') {
    return 1.15;
  }

  return 1;
}

function getArmSwingMultiplier(mode: ArmsMode): number {
  if (mode === 'zombieForward') {
    return 0.55;
  }

  if (mode === 'weaponAim') {
    return 0.25;
  }

  return 1;
}

function getForearmBend(mode: ArmsMode, step: number, intensity: number): number {
  if (mode === 'zombieForward') {
    return -0.08 * intensity + Math.max(0, step) * 0.035;
  }

  if (mode === 'weaponAim') {
    return -0.18 * intensity;
  }

  return -0.1 * intensity + Math.max(0, step) * 0.055;
}
