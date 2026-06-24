import type RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { Vector3 } from 'three';

export class SlidingDoor {
  private readonly closedPosition: Vector3;
  private readonly openPosition: Vector3;
  private open = false;

  constructor(
    readonly id: string,
    private readonly mesh: Object3D,
    private readonly rigidBody: RAPIER.RigidBody,
    openOffset: Vector3,
    private readonly speed: number,
  ) {
    this.closedPosition = mesh.position.clone();
    this.openPosition = mesh.position.clone().add(openOffset);
  }

  toggle(): boolean {
    this.open = !this.open;
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
  }

  isOpen(): boolean {
    return this.open;
  }

  update(delta: number): void {
    const target = this.open ? this.openPosition : this.closedPosition;
    const next = this.mesh.position.clone().lerp(target, Math.min(1, delta * this.speed));
    this.mesh.position.copy(next);
    this.rigidBody.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z });
  }
}
