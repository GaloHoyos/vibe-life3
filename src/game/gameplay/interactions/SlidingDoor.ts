import type RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { Vector3 } from 'three';
import type { ActivatorRef } from '@game/script/ActivatorRef';

export type DoorStateChange = (open: boolean, activator: ActivatorRef) => void;

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
    private readonly onStateChange?: DoorStateChange,
  ) {
    this.closedPosition = mesh.position.clone();
    this.openPosition = mesh.position.clone().add(openOffset);
  }

  toggle(activator: ActivatorRef = { kind: 'none' }): boolean {
    this.setOpen(!this.open, activator);
    return this.open;
  }

  setOpen(open: boolean, activator: ActivatorRef = { kind: 'none' }): void {
    if (this.open === open) return;
    this.open = open;
    this.onStateChange?.(open, activator);
  }

  isOpen(): boolean {
    return this.open;
  }

  isPassable(): boolean {
    return this.open && this.mesh.position.distanceToSquared(this.openPosition) <= 0.04;
  }

  update(delta: number): void {
    const target = this.open ? this.openPosition : this.closedPosition;
    const next = this.mesh.position.clone().lerp(target, Math.min(1, delta * this.speed));
    this.mesh.position.copy(next);
    this.rigidBody.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z });
  }
}
