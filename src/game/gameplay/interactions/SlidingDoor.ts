import type RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { Vector3 } from 'three';
import type { ActivatorRef } from '@game/script/ActivatorRef';
import type {
  SerializedQuaternion,
  SerializedVector3,
} from '@engine/physics/RigidBodySnapshot';

export type DoorStateChange = (open: boolean, activator: ActivatorRef) => void;

export interface SlidingDoorSaveSnapshot {
  version: 1;
  id: string;
  open: boolean;
  position: SerializedVector3;
  rotation: SerializedQuaternion;
}

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

  captureSaveState(): SlidingDoorSaveSnapshot {
    return {
      version: 1,
      id: this.id,
      open: this.open,
      position: [
        finite(this.mesh.position.x),
        finite(this.mesh.position.y),
        finite(this.mesh.position.z),
      ],
      rotation: [
        finite(this.mesh.quaternion.x),
        finite(this.mesh.quaternion.y),
        finite(this.mesh.quaternion.z),
        finite(this.mesh.quaternion.w, 1),
      ],
    };
  }

  /** Restaura sin emitir `onStateChange`, evitando repetir outputs consumidos. */
  restoreSaveState(snapshot: Readonly<SlidingDoorSaveSnapshot>): void {
    if (snapshot.id !== this.id) {
      throw new Error(`Snapshot de puerta ${snapshot.id} aplicado a ${this.id}`);
    }
    this.open = snapshot.open;
    this.mesh.position.set(...snapshot.position);
    this.mesh.quaternion.set(...snapshot.rotation).normalize();
    this.rigidBody.setTranslation(this.mesh.position, true);
    this.rigidBody.setRotation(this.mesh.quaternion, true);
    this.rigidBody.setNextKinematicTranslation(this.mesh.position);
    this.rigidBody.setNextKinematicRotation(this.mesh.quaternion);
  }

  update(delta: number): void {
    const target = this.open ? this.openPosition : this.closedPosition;
    const next = this.mesh.position.clone().lerp(target, Math.min(1, delta * this.speed));
    this.mesh.position.copy(next);
    this.rigidBody.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z });
  }
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}
