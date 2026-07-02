import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { NormalizedBoneName } from '@engine/animation/pose/BoneMapper';
import type { RagdollConfig, RagdollPartDefinition } from './RagdollDefinition';

const UP = new Vector3(0, 1, 0);

export interface PartGeometryContext {
  /** World rotation the rigid body is created with (canonical or bone frame). */
  bodyRotation: Quaternion;
  /** World rotation of the part's bone (fallback capsule direction). */
  boneRotation: Quaternion;
  /** World position of the part's bone (== body translation). */
  bonePosition: Vector3;
  getBoneWorldPosition: (bone: NormalizedBoneName) => Vector3 | null;
  config: RagdollConfig;
}

/**
 * Derives the collider shape/placement of a part from the actual skeleton:
 * capsules span bone -> child bone, torso widths come from shoulder/thigh
 * spacing. The collider is placed with a local transform inside the body so
 * the body origin can stay at the bone origin regardless of frame choice.
 */
export function createPartCollider(part: RagdollPartDefinition, ctx: PartGeometryContext): RAPIER.ColliderDesc {
  const scale = ctx.config.colliderScale;
  const offset = part.localOffset?.clone() ?? new Vector3();

  if (part.shape === 'sphere') {
    return RAPIER.ColliderDesc.ball((part.radius ?? 0.1) * scale).setTranslation(offset.x, offset.y, offset.z);
  }

  if (part.shape === 'box') {
    const half = (part.boxHalfExtents ?? new Vector3(0.1, 0.1, 0.1)).clone().multiplyScalar(scale);
    applyDerivedTorsoWidth(part, ctx, half);
    return RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(offset.x, offset.y, offset.z);
  }

  const radius = (part.radius ?? 0.05) * scale;
  const target = part.lengthTarget ? ctx.getBoneWorldPosition(part.lengthTarget) : null;
  const segment = target
    ? target.clone().sub(ctx.bonePosition)
    : new Vector3(0, -(part.fallbackLength ?? 0.3), 0).applyQuaternion(ctx.boneRotation);
  if (segment.lengthSq() < 1e-6) {
    segment.set(0, -(part.fallbackLength ?? 0.3), 0).applyQuaternion(ctx.boneRotation);
  }
  segment.multiplyScalar(part.lengthScale ?? 1);

  const bodyRotationInverse = ctx.bodyRotation.clone().invert();
  const halfHeight = Math.max(segment.length() * 0.5 - radius, 0.01);
  const localMid = segment.clone().multiplyScalar(0.5).applyQuaternion(bodyRotationInverse);
  const localDir = segment.clone().normalize().applyQuaternion(bodyRotationInverse);
  const localRotation = new Quaternion().setFromUnitVectors(UP, localDir);

  return RAPIER.ColliderDesc.capsule(halfHeight, radius)
    .setTranslation(localMid.x + offset.x, localMid.y + offset.y, localMid.z + offset.z)
    .setRotation({ x: localRotation.x, y: localRotation.y, z: localRotation.z, w: localRotation.w });
}

function applyDerivedTorsoWidth(part: RagdollPartDefinition, ctx: PartGeometryContext, half: Vector3): void {
  if (part.id === 'hips') {
    const left = ctx.getBoneWorldPosition('leftThigh');
    const right = ctx.getBoneWorldPosition('rightThigh');
    if (left && right) {
      half.x = Math.max(half.x, left.distanceTo(right) * 0.5 + 0.05);
    }
    return;
  }
  if (part.id === 'chest') {
    const left = ctx.getBoneWorldPosition('leftUpperArm');
    const right = ctx.getBoneWorldPosition('rightUpperArm');
    if (left && right) {
      half.x = Math.max(half.x, left.distanceTo(right) * 0.45);
    }
  }
}
