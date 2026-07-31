import type RAPIER from "@dimforge/rapier3d-compat";
import type { Object3D, Scene } from "three";
import {
  captureRigidBodySnapshot,
  restoreRigidBodySnapshot,
  type RigidBodySnapshot,
} from "@engine/physics/RigidBodySnapshot";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";

export interface PhysicalPickupSaveSnapshot {
  version: 1;
  id: string;
  available: boolean;
  body: RigidBodySnapshot;
}

export function capturePhysicalPickupSaveState(
  id: string,
  available: boolean,
  body: RAPIER.RigidBody,
): PhysicalPickupSaveSnapshot {
  return {
    version: 1,
    id,
    available,
    body: captureRigidBodySnapshot(body),
  };
}

export function restorePhysicalPickupSaveState(
  snapshot: Readonly<PhysicalPickupSaveSnapshot>,
  expectedId: string,
  scene: Scene,
  physics: PhysicsWorld,
  object: Object3D,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
): void {
  if (snapshot.id !== expectedId) {
    throw new Error(
      `Snapshot de pickup ${snapshot.id} aplicado a ${expectedId}`,
    );
  }

  restoreRigidBodySnapshot(body, snapshot.body);
  const physicalEnabled = snapshot.available && snapshot.body.enabled;
  body.setEnabled(physicalEnabled);
  collider.setEnabled(physicalEnabled);
  object.position.set(...snapshot.body.position);
  object.quaternion.set(...snapshot.body.rotation);
  object.visible = snapshot.available;

  if (snapshot.available) {
    scene.add(object);
    physics.setBodyVisual(body, object);
  } else {
    object.removeFromParent();
    physics.clearBodyVisual(body);
  }
}
