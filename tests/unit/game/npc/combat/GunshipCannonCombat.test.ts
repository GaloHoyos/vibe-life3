import { describe, expect, it, vi } from "vitest";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { GunshipCannonCombat } from "@game/npc/combat/GunshipCannonCombat";
import { recordEvents } from "@tests/support/events";

describe("GunshipCannonCombat", () => {
  it("telegraphs, fires a stitched burst, and caps damaging hits per target", () => {
    const bus = new EventBus<GameEventMap>();
    const fired = recordEvents(bus, "weapon.fired");
    const hits = recordEvents(bus, "weapon.hit");
    const attacks = recordEvents(bus, "npc.attack");
    const damageable = {
      applyDamage: vi.fn(),
      isAlive: () => true,
    };
    const raycast = {
      cast: vi.fn(() => ({
        collider: {} as RAPIER.Collider,
        metadata: {
          id: "player",
          kind: "player",
          damageable,
        },
        point: new Vector3(0, 1, 12),
        normal: new Vector3(0, 1, 0),
        toi: 12,
      })),
    } as unknown as Raycast;
    const combat = new GunshipCannonCombat({
      id: "gunship-1",
      characterId: "gunship",
      faction: "combine",
      body: {} as RAPIER.RigidBody,
      raycast,
      eventBus: bus,
      eyeHeight: 1.35,
    });

    combat.tick(frame(0));
    combat.aim(new Vector3(0, 0, 20));
    expect(combat.tryFire()).toBe(false);
    expect(attacks).toHaveLength(1);
    expect(fired).toHaveLength(0);

    combat.tick(frame(0.46));
    combat.aim(new Vector3(0, 0, 20));
    expect(combat.tryFire()).toBe(true);

    for (let i = 0; i < 20; i += 1) {
      const elapsed = 0.47 + i * 0.075;
      combat.tick(frame(elapsed));
      combat.aim(new Vector3(0, 0, 20));
      combat.tryFire();
    }

    expect(fired).toHaveLength(15);
    expect(hits).toHaveLength(15);
    expect(damageable.applyDamage).toHaveBeenCalledTimes(5);
    expect(hits.filter((hit) => hit.damage > 0)).toHaveLength(5);
  });
});

function frame(elapsed: number) {
  return {
    delta: 1 / 60,
    elapsed,
    position: new Vector3(0, 10, 0),
    facing: new Vector3(0, 0, 1),
    threat: null,
  };
}
