import type { CharacterAnimationConfig, HumanoidRestPoseConfig } from '../../characters/CharacterDefinition';
import type { BoneMap } from './BoneMapper';
import { applyBoneRotationOffsets } from './BoneRotation';

const RelaxedRestPose: HumanoidRestPoseConfig = {
  type: 'tpose_to_relaxed',
  leftUpperArm: { z: 1.05 },
  rightUpperArm: { z: -1.05 },
  leftForearm: { z: 0.2 },
  rightForearm: { z: -0.2 },
  spine: { x: 0.03 },
  chest: { x: 0.02 },
  head: { x: -0.02 },
};

const ZombieRestPose: HumanoidRestPoseConfig = {
  type: 'zombie',
  leftUpperArm: { z: 1.18, x: -0.18 },
  rightUpperArm: { z: -1.18, x: -0.18 },
  leftForearm: { z: 0.32, x: -0.42 },
  rightForearm: { z: -0.32, x: -0.42 },
  spine: { x: 0.08 },
  chest: { x: 0.06 },
  head: { x: -0.05 },
};

export class HumanoidRestPose {
  private readonly pose: HumanoidRestPoseConfig;

  constructor(animation?: CharacterAnimationConfig) {
    this.pose = mergeRestPose(animation?.restPose);
  }

  apply(bones: BoneMap): void {
    if (this.pose.type === 'none') {
      return;
    }

    applyBoneRotationOffsets(bones.leftUpperArm, this.pose.leftUpperArm);
    applyBoneRotationOffsets(bones.rightUpperArm, this.pose.rightUpperArm);
    applyBoneRotationOffsets(bones.leftForearm, this.pose.leftForearm);
    applyBoneRotationOffsets(bones.rightForearm, this.pose.rightForearm);
    applyBoneRotationOffsets(bones.spine, this.pose.spine);
    applyBoneRotationOffsets(bones.chest, this.pose.chest);
    applyBoneRotationOffsets(bones.head, this.pose.head);
  }
}

function mergeRestPose(pose?: HumanoidRestPoseConfig): HumanoidRestPoseConfig {
  if (!pose || pose.type === 'none') {
    return { type: 'none' };
  }

  if (pose.type === 'zombie') {
    return { ...ZombieRestPose, ...pose };
  }

  return { ...RelaxedRestPose, ...pose };
}
