import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { ExplosiveBarrel } from "@game/gameplay/hazards/ExplosiveBarrel";

describe("ExplosiveBarrel", () => {
  it("tracks lethal damage, attacker and pending explosion once", () => {
    const barrel = new ExplosiveBarrel("barrel-1", new Object3D(), {
      health: 25,
      damage: 90,
      radius: 4.5,
      impulse: 14,
    });

    barrel.applyDamage(10, undefined, undefined, "npc-1");
    expect(barrel.isAlive()).toBe(true);
    expect(barrel.pendingExplosion).toBe(false);
    expect(barrel.lastAttackerId).toBe("npc-1");

    barrel.applyDamage(20, undefined, undefined, "player");
    barrel.applyDamage(20, undefined, undefined, "late");

    expect(barrel.isAlive()).toBe(false);
    expect(barrel.pendingExplosion).toBe(true);
    expect(barrel.lastAttackerId).toBe("player");
  });

  it("reads position from attached body and falls back to origin", () => {
    const barrel = new ExplosiveBarrel("barrel-1", new Object3D(), {
      health: 25,
      damage: 90,
      radius: 4.5,
      impulse: 14,
    });

    expect(barrel.position().toArray()).toEqual([0, 0, 0]);

    barrel.attachBody({ translation: () => ({ x: 1, y: 2, z: 3 }) } as never);

    expect(barrel.position().toArray()).toEqual([1, 2, 3]);
  });
});
