import { Bone, Object3D, Quaternion, Vector3 } from 'three';
import type { BoneMapper, NormalizedBoneName } from '@engine/animation/pose/BoneMapper';
import { getBoneWorldTransform } from './PhysicsBoneLink';

/**
 * Bind-pose reference for canonical ragdoll frames. Bodies built with
 * orientation `qBoneNow * rotRelRoot^-1` all share the same world rotation
 * whenever the pose matches the bind pose, so joint zero = bind pose and
 * joint limits live in character space regardless of the rig's bone rolls.
 */
export interface RagdollRestPose {
  /** qRootWorld^-1 * qBoneWorld at capture, per mapped bone. */
  readonly boneRotRelRoot: ReadonlyMap<NormalizedBoneName, Quaternion>;
  /** Bone world position relative to the character root, in root space (meters). */
  readonly bonePosRelRoot: ReadonlyMap<NormalizedBoneName, Vector3>;
}

/**
 * Must run before the first animation frame — same contract as PoseSnapshot,
 * which already treats the load pose as the rest pose.
 */
export function captureRestPose(root: Object3D, mapper: BoneMapper): RagdollRestPose | null {
  if (!mapper.hasSkeleton()) {
    return null;
  }

  root.updateWorldMatrix(true, true);
  const rootPosition = new Vector3();
  const rootRotation = new Quaternion();
  root.getWorldPosition(rootPosition);
  root.getWorldQuaternion(rootRotation);
  const rootRotationInverse = rootRotation.clone().invert();

  const boneRotRelRoot = new Map<NormalizedBoneName, Quaternion>();
  const bonePosRelRoot = new Map<NormalizedBoneName, Vector3>();

  for (const [name, bone] of Object.entries(mapper.bones)) {
    if (!(bone instanceof Bone)) {
      continue;
    }
    const { position, rotation } = getBoneWorldTransform(bone);
    boneRotRelRoot.set(name as NormalizedBoneName, rootRotationInverse.clone().multiply(rotation));
    bonePosRelRoot.set(
      name as NormalizedBoneName,
      position.sub(rootPosition).applyQuaternion(rootRotationInverse),
    );
  }

  if (boneRotRelRoot.size === 0) {
    return null;
  }

  return { boneRotRelRoot, bonePosRelRoot };
}
