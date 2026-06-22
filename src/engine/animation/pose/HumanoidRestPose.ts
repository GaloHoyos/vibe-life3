import type { CharacterAnimationConfig, HumanoidRestPoseConfig } from '@engine/characters/CharacterDefinition';
import type { BoneMap } from './BoneMapper';
import { applyBoneRotationOffsets } from './BoneRotation';
import { getRestPoseTuning } from './RestPoseTuning';

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
  private readonly characterId?: string;

  constructor(animation?: CharacterAnimationConfig, characterId?: string) {
    this.pose = mergeRestPose(animation?.restPose);
    this.characterId = characterId;
  }

  apply(bones: BoneMap): void {
    const tuned = getRestPoseTuning(this.characterId);
    if (tuned) {
      applyBoneRotationOffsets(bones.leftUpperArm, {
        x: tuned.leftUpperArmX,
        y: tuned.leftUpperArmY,
        z: tuned.leftUpperArmZ,
      });
      applyBoneRotationOffsets(bones.rightUpperArm, {
        x: tuned.rightUpperArmX,
        y: tuned.rightUpperArmY,
        z: tuned.rightUpperArmZ,
      });
      applyBoneRotationOffsets(bones.leftForearm, {
        x: tuned.leftForearmX,
        y: tuned.leftForearmY,
        z: tuned.leftForearmZ,
      });
      applyBoneRotationOffsets(bones.rightForearm, {
        x: tuned.rightForearmX,
        y: tuned.rightForearmY,
        z: tuned.rightForearmZ,
      });
      applyBoneRotationOffsets(bones.spine, { x: tuned.spineX });
      applyBoneRotationOffsets(bones.chest, { x: tuned.chestX });
      applyBoneRotationOffsets(bones.head, { x: tuned.headX });
      return;
    }

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
