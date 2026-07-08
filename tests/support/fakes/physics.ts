import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";

export function fakePhysicsWorld(overrides: Partial<PhysicsWorld> = {}): PhysicsWorld {
  return overrides as PhysicsWorld;
}
