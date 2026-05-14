import { Bone, MathUtils, Vector3 } from 'three';
import type { BoneMap } from './BoneMapper';

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
  maxArmSwing: number;
  maxTorsoLean: number;
  maxHeadYaw: number;
  maxHeadPitch: number;
  style: WalkStyle;
}

export const DefaultWalkConfig: ProceduralWalkConfig = {
  stepFrequency: 3.9,
  strideLength: 0.34,
  stepHeight: 0.08,
  armSwing: 0.34,
  torsoBob: 0.04,
  torsoLean: 0.14,
  smoothing: 10,
  maxLegSwing: 0.46,
  maxArmSwing: 0.42,
  maxTorsoLean: 0.22,
  maxHeadYaw: 0.65,
  maxHeadPitch: 0.35,
  style: 'normal',
};

export class ProceduralWalk {
  constructor(private readonly config: ProceduralWalkConfig = DefaultWalkConfig) {}

  apply(bones: BoneMap, velocity: Vector3, time: number, intensity: number, runMultiplier = 1): number {
    const speed = velocity.length();
    const styleMultiplier = getStyleMultiplier(this.config.style);
    const normalizedSpeed = MathUtils.clamp(speed / 3.2, 0, 1.25);
    const phase = time * this.config.stepFrequency * Math.max(0.25, normalizedSpeed) * runMultiplier * styleMultiplier;
    const leftStep = Math.sin(phase);
    const rightStep = Math.sin(phase + Math.PI);
    const lift = Math.abs(Math.cos(phase)) * this.config.stepHeight * intensity;
    const stride = clamp(this.config.strideLength * intensity * runMultiplier, this.config.maxLegSwing);
    const armSwing = clamp(this.config.armSwing * intensity * runMultiplier, this.config.maxArmSwing);
    const torsoLean = clamp(this.config.torsoLean * intensity * runMultiplier, this.config.maxTorsoLean);

    rotateX(bones.leftThigh, leftStep * stride);
    rotateX(bones.rightThigh, rightStep * stride);
    rotateX(bones.leftShin, MathUtils.clamp(Math.max(0, -leftStep) * stride * 0.55 + lift, 0, this.config.maxLegSwing));
    rotateX(bones.rightShin, MathUtils.clamp(Math.max(0, -rightStep) * stride * 0.55 + lift, 0, this.config.maxLegSwing));
    rotateX(bones.leftFoot, -Math.max(0, leftStep) * 0.08);
    rotateX(bones.rightFoot, -Math.max(0, rightStep) * 0.08);

    rotateX(bones.leftUpperArm, rightStep * armSwing * 0.85);
    rotateX(bones.rightUpperArm, leftStep * armSwing * 0.85);
    rotateX(bones.leftForearm, -0.12 * intensity + Math.max(0, leftStep) * 0.08);
    rotateX(bones.rightForearm, -0.12 * intensity + Math.max(0, rightStep) * 0.08);

    rotateX(bones.spine, torsoLean);
    rotateX(bones.chest, torsoLean * 0.45);
    rotateZ(bones.chest, Math.sin(phase) * 0.03 * intensity);

    return Math.abs(Math.sin(phase * 2)) * this.config.torsoBob * intensity * runMultiplier;
  }
}

function clamp(value: number, max: number): number {
  return MathUtils.clamp(value, -max, max);
}

function getStyleMultiplier(style: WalkStyle): number {
  if (style === 'staggered') {
    return 0.82;
  }

  if (style === 'heavy') {
    return 0.72;
  }

  if (style === 'creature') {
    return 1.15;
  }

  return 1;
}

function rotateX(bone: Bone | undefined, radians: number): void {
  if (bone) {
    bone.rotation.x += radians;
  }
}

function rotateZ(bone: Bone | undefined, radians: number): void {
  if (bone) {
    bone.rotation.z += radians;
  }
}
