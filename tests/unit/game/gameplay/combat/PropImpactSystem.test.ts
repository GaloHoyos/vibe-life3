import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import { recordEvents } from "@tests/support/events";

beforeAll(async () => {
  await RAPIER.init();
});

async function setup() {
  const physics = new PhysicsWorld();
  await physics.init();
  const raycast = new Raycast(physics);
  const bus = new EventBus<GameEventMap>();
  const system = new PropImpactSystem(physics, raycast, bus);

  const applyDamage = vi.fn();
  const npcBody = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(2, 1, 0),
  );
  const npcCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.35),
    npcBody,
  );
  physics.registerCollider(npcCollider, {
    id: "npc-1",
    kind: "npc",
    damageable: { applyDamage, isAlive: () => true },
  });

  // Prop dinámico pegado al NPC volando hacia él a 20 m/s (el cast es corto:
  // max(0.6, speed·delta·2) ≈ 0.67 m desde el centro del prop).
  const prop = physics.createDynamicBox(
    { id: "crate", position: new Vector3(1.2, 1, 0), size: new Vector3(0.4, 0.4, 0.4), mass: 1 },
    new Object3D(),
  );
  prop.setLinvel({ x: 20, y: 0, z: 0 }, true);

  physics.updateQueryPipeline();
  return {
    physics,
    system,
    bus,
    prop,
    applyDamage,
    hits: recordEvents(bus, "weapon.hit"),
    impacts: recordEvents(bus, "prop.impact"),
  };
}

describe("PropImpactSystem", () => {
  it("un prop rápido daña al NPC con la fórmula speed × masa (sin atribución)", async () => {
    const { system, applyDamage, hits, impacts } = await setup();

    system.update(1 / 60, 1);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    // damage = clamp(20 × (1 + 1×0.5) × 1.8, 15, 150) = 54 (masa ≈ 1).
    const damage = applyDamage.mock.calls[0][0] as number;
    expect(damage).toBeGreaterThan(45);
    expect(damage).toBeLessThan(65);
    // Sin registerLaunch: atacante undefined y sin weapon.hit (no es del player).
    expect(applyDamage.mock.calls[0][3]).toBeUndefined();
    expect(impacts).toHaveLength(1);
    expect(impacts[0].sourceId).toBeUndefined();
    expect(hits).toHaveLength(0);
  });

  it("con registerLaunch atribuye al player y emite weapon.hit", async () => {
    const { system, prop, applyDamage, hits } = await setup();
    system.registerLaunch(prop, "player", "Gravity Gun", 1);

    system.update(1 / 60, 1);

    expect(applyDamage.mock.calls[0][3]).toBe("player");
    expect(hits).toHaveLength(1);
    expect(hits[0].weaponName).toBe("Gravity Gun");
    expect(hits[0].targetId).toBe("npc-1");
  });

  it("la atribución expira pasado attributionDuration", async () => {
    const { system, prop, applyDamage } = await setup();
    system.registerLaunch(prop, "player", "Gravity Gun", 1);

    // 3 s de atribución: a elapsed = 5 ya venció.
    system.update(1 / 60, 5);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(applyDamage.mock.calls[0][3]).toBeUndefined();
  });

  it("el cooldown evita daño duplicado en frames consecutivos", async () => {
    const { system, applyDamage } = await setup();

    system.update(1 / 60, 1);
    system.update(1 / 60, 1.016);

    expect(applyDamage).toHaveBeenCalledTimes(1);
  });

  it("un prop sostenido por un grab controller no daña", async () => {
    const { physics, system, prop, applyDamage } = await setup();
    physics.markHeld(prop, true);

    system.update(1 / 60, 1);

    expect(applyDamage).not.toHaveBeenCalled();
  });

  it("un prop lento no daña", async () => {
    const { system, prop, applyDamage } = await setup();
    prop.setLinvel({ x: 2, y: 0, z: 0 }, true);

    system.update(1 / 60, 1);

    expect(applyDamage).not.toHaveBeenCalled();
  });
});
