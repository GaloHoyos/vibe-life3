import { Bone, MathUtils, Object3D, Vector3 } from 'three';
import type { BoneMap } from './BoneMapper';

export class ProceduralBalance {
  applyIdle(root: Object3D, bones: BoneMap, time: number, intensity: number): void {
    const breath = Math.sin(time * 1.7) * 0.035 * intensity;
    const sway = Math.sin(time * 0.85) * 0.025 * intensity;

    if (bones.hips) {
      bones.hips.position.y += breath * 0.35;
    } else {
      root.position.y += breath * 0.35;
    }
    root.rotation.z += sway;
    rotateX(bones.spine, breath);
    rotateX(bones.chest, breath * 1.35);
    rotateY(bones.head, Math.sin(time * 1.15) * 0.035 * intensity);
    rotateZ(bones.head, Math.sin(time * 0.9) * 0.025 * intensity);
    rotateZ(bones.leftUpperArm, 0.12);
    rotateZ(bones.rightUpperArm, -0.12);
    rotateX(bones.leftForearm, -0.18);
    rotateX(bones.rightForearm, -0.18);
  }

  applyVelocityLean(root: Object3D, velocity: Vector3, desiredDirection: Vector3, intensity: number): void {
    const speed = velocity.length();
    if (speed <= 0.01 || desiredDirection.lengthSq() <= 0.01) {
      return;
    }

    const direction = desiredDirection.clone().normalize();
    const lean = MathUtils.clamp(speed / 8, 0, 1) * 0.08 * intensity;
    root.rotation.x += direction.z * lean;
    root.rotation.z -= direction.x * lean;
  }
}

function rotateX(bone: Bone | undefined, radians: number): void {
  if (bone) {
    bone.rotation.x += radians;
  }
}

function rotateY(bone: Bone | undefined, radians: number): void {
  if (bone) {
    bone.rotation.y += radians;
  }
}

function rotateZ(bone: Bone | undefined, radians: number): void {
  if (bone) {
    bone.rotation.z += radians;
  }
}
