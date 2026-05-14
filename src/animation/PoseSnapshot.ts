import { Object3D, Quaternion, Vector3 } from 'three';

interface LocalTransform {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

export class PoseSnapshot {
  private readonly transforms = new Map<Object3D, LocalTransform>();

  constructor(
    private readonly root: Object3D,
    private readonly preserveRootPosition = true,
  ) {
    root.traverse((object) => {
      this.transforms.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });
  }

  restore(): void {
    this.transforms.forEach((transform, object) => {
      if (!(this.preserveRootPosition && object === this.root)) {
        object.position.copy(transform.position);
      }
      object.quaternion.copy(transform.quaternion);
      object.scale.copy(transform.scale);
    });
  }
}
