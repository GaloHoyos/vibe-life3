import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { StriderCombat } from "@game/npc/combat/StriderCombat";
import { recordEvents } from "@tests/support/events";

beforeAll(async () => {
  await RAPIER.init();
});

describe("StriderCombat", () => {
  it("telegraphs and stitches minigun fire with a per-target damage cap", async () => {
    const { combat, bus, damageable } = await setupCombatWorld(new Vector3(0, 1, 20), new Vector3(4, 4, 4));
    const fired = recordEvents(bus, "weapon.fired");
    const hits = recordEvents(bus, "weapon.hit");

    combat.tick(frame(0, new Vector3(0, 6, 0)));
    combat.aim(new Vector3(0, 0, 20));
    combat.setIntent("primary");
    expect(combat.tryFire()).toBe(false);
    expect(fired).toHaveLength(0);

    combat.tick(frame(0.36, new Vector3(0, 6, 0)));
    combat.aim(new Vector3(0, 0, 20));
    expect(combat.tryFire()).toBe(true);

    for (let i = 0; i < 36; i += 1) {
      const elapsed = 0.38 + i * 0.12;
      combat.tick(frame(elapsed, new Vector3(0, 6, 0)));
      combat.aim(new Vector3(0, 0, 20));
      combat.setIntent("primary");
      combat.tryFire();
    }

    expect(fired.filter((event) => event.weaponName === "Strider Minigun").length).toBeGreaterThan(8);
    expect(hits.filter((event) => event.weaponName === "Strider Minigun").length).toBeGreaterThan(8);
    expect(damageable.applyDamage.mock.calls.length).toBeLessThanOrEqual(6);
    expect(damageable.applyDamage.mock.calls.length).toBeGreaterThan(0);
  });

  it("charges cannon and emits a delayed impact event", async () => {
    const { combat, bus } = await setupCombatWorld(new Vector3(0, 1, 22), new Vector3(5, 5, 5));
    const impacts = recordEvents(bus, "strider.cannon.impact");

    combat.tick(frame(0, new Vector3(0, 6, 0)));
    combat.aim(new Vector3(0, 0, 22));
    combat.setIntent("secondary");
    expect(combat.tryFire()).toBe(true);

    combat.tick(frame(1.05, new Vector3(0, 6, 0)));
    combat.tick(frame(2.32, new Vector3(0, 6, 0)));
    expect(impacts).toHaveLength(0);
    combat.tick(frame(2.55, new Vector3(0, 6, 0)));

    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      damage: 180,
      radius: 5.5,
      impulse: 26,
      sourceId: "strider-1",
      sourceFaction: "combine",
    });
  });

  it("applies radial stomp damage after windup", async () => {
    const { combat, damageable } = await setupCombatWorld(new Vector3(1, 0.5, 1), new Vector3(1, 1, 1));

    combat.tick(frame(0, new Vector3(0, 6, 0), new Vector3(1, 0, 1)));
    combat.setIntent("melee");
    expect(combat.tryFire()).toBe(true);
    expect(damageable.applyDamage).not.toHaveBeenCalled();

    combat.tick(frame(0.7, new Vector3(0, 6, 0), new Vector3(1, 0, 1)));
    expect(damageable.applyDamage).toHaveBeenCalledTimes(1);
    expect(damageable.applyDamage.mock.calls[0][0]).toBeGreaterThan(60);
  });
});

async function setupCombatWorld(targetPosition: Vector3, targetSize: Vector3) {
  const physics = new PhysicsWorld();
  await physics.init();
  const bus = new EventBus<GameEventMap>();
  const owner = physics.createKinematicBox({
    id: "strider-1",
    position: new Vector3(0, 6, 0),
    size: new Vector3(2, 2, 2),
    metadata: { kind: "npc", faction: "combine" },
  });
  const damageable = {
    applyDamage: vi.fn(),
    isAlive: () => true,
  };
  physics.createStaticBox({
    id: "player",
    position: targetPosition,
    size: targetSize,
    metadata: {
      kind: "player",
      faction: "player",
      damageable,
    },
  });
  physics.updateQueryPipeline();

  return {
    bus,
    damageable,
    combat: new StriderCombat({
      id: "strider-1",
      characterId: "strider",
      faction: "combine",
      body: owner,
      physics,
      eventBus: bus,
    }),
  };
}

function frame(elapsed: number, position: Vector3, threatPosition = new Vector3(0, 0, 20)) {
  return {
    delta: 1 / 60,
    elapsed,
    position,
    facing: new Vector3(0, 0, 1),
    threat: {
      id: "player",
      position: threatPosition,
      faction: "player" as const,
      entity: {
        applyDamage: vi.fn(),
        isAlive: () => true,
      },
      isAlive: true,
      radius: 0.35,
    },
  };
}
