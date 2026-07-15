import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Bone, Group, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { CharacterPresets } from "@game/characters/CharacterPresets";
import { NpcAnimationBridge } from "@game/npc/animation/NpcAnimationBridge";
import type { Damageable } from "@shared/types/lifecycle";

beforeAll(async () => {
  await RAPIER.init();
});

describe("NpcAnimationBridge ragdoll lifecycle", () => {
  it("propaga centro fisico y cleanup idempotente hasta Rapier", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const root = skeletalRoot(new Vector3(4, 3, -2));
    const owner: Damageable = {
      applyDamage: () => undefined,
      isAlive: () => false,
    };
    const bridge = new NpcAnimationBridge(
      "bridge-corpse",
      CharacterPresets.zombie,
      root,
      physics,
      owner,
    );

    expect(bridge.getPhysicalCenter()).toBeNull();
    expect(physics.getBodyCount()).toBe(1);

    bridge.notifyDeath(undefined, new Vector3(), undefined);

    expect(bridge.getPhysicalCenter()).toEqual(new Vector3(4, 3, -2));
    expect(physics.getBodyCount()).toBe(2);

    bridge.dispose();
    bridge.dispose();

    expect(bridge.getPhysicalCenter()).toBeNull();
    expect(physics.getBodyCount()).toBe(0);
    expect(() => bridge.updateStandalone(1 / 60, { dead: true })).not.toThrow();
    expect(() => bridge.notifyDeath(undefined, new Vector3(), undefined)).not.toThrow();
  });
});

function skeletalRoot(position: Vector3): Group {
  const root = new Group();
  root.position.copy(position);
  const hips = new Bone();
  hips.name = "Hips";
  root.add(hips);
  root.updateMatrixWorld(true);
  return root;
}
