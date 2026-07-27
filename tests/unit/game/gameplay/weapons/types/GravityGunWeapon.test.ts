import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import {
  PhysicsWorld,
  type PhysicsMetadata,
} from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { GravityGunConfig } from "@game/config/gravitygun.config";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import { AmmoInventory } from "@game/gameplay/weapons/core/AmmoInventory";
import type { WeaponContext } from "@game/gameplay/weapons/core/Weapon";
import { createWeapon } from "@game/gameplay/weapons/core/WeaponFactory";
import { WeaponInventory } from "@game/gameplay/weapons/core/WeaponInventory";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import { recordEvents } from "@tests/support/events";

beforeAll(async () => {
  await RAPIER.init();
});

type TargetKind = "dynamicNpc" | "kinematicNpc" | "prop";

async function setup(targetKind: TargetKind = "dynamicNpc") {
  const bus = new EventBus<GameEventMap>();
  const physics = new PhysicsWorld();
  await physics.init();
  const applyDamage = vi.fn();
  const isNpc = targetKind !== "prop";
  const options = {
    id: isNpc ? "target-npc" : "target-prop",
    position: new Vector3(0, 1, -2),
    size: new Vector3(0.5, 0.5, 0.5),
    mass: 2,
    metadata: {
      kind: isNpc ? ("npc" as const) : ("dynamic" as const),
      characterId: isNpc ? "blob" : undefined,
      damageable: { applyDamage, isAlive: () => true },
      bodyPart: isNpc
        ? { name: "shell-3", damageMultiplier: 1 }
        : undefined,
    },
  };
  const body =
    targetKind === "kinematicNpc"
      ? physics.createKinematicBox(options)
      : physics.createDynamicBox(options, new Object3D());
  const collider = body.collider(0);
  const metadata = physics.getColliderMetadata(collider)!;
  const hit: RaycastHit = {
    collider,
    metadata,
    point: new Vector3(0, 1, -1.75),
    normal: new Vector3(0, 0, 1),
    toi: 2,
  };
  const raycast = { cast: vi.fn(() => hit) } as unknown as Raycast;
  const registerLaunch = vi.fn();
  const ammo = new AmmoInventory();
  const inventory = new WeaponInventory(bus, ammo);
  const context: WeaponContext = {
    eventBus: bus,
    physics,
    raycast,
    propImpacts: { registerLaunch } as unknown as PropImpactSystem,
    grenades: { spawn: vi.fn() } as unknown as GrenadeSystem,
    rockets: { spawn: vi.fn() } as unknown as RocketSystem,
    bolts: { spawn: vi.fn() } as unknown as BoltSystem,
    energyBalls: { spawn: vi.fn() } as unknown as EnergyBallSystem,
    iceGun: {} as IceGunSystem,
    portals: { pair: null } as unknown as PortalGunSystem,
    ammo,
    getInventory: () => inventory,
  };
  return {
    applyDamage,
    body,
    hit,
    metadata,
    registerLaunch,
    weapon: createWeapon("gravityGun", context),
    hits: recordEvents(bus, "weapon.hit"),
    alternateFires: recordEvents(bus, "weapon.alternate.fired"),
  };
}

function fireContext(now = 0) {
  return {
    origin: new Vector3(0, 1.6, 0),
    direction: new Vector3(0, 0, -1),
    cameraQuaternion: new Quaternion(),
    now,
  };
}

describe("GravityGunWeapon", () => {
  it("punts and damages a grabbable dynamic NPC, preserving the NPC hit event", async () => {
    const setupResult = await setup();
    const {
      applyDamage,
      body,
      hit,
      metadata,
      registerLaunch,
      weapon,
      hits,
    } = setupResult;
    applyDamage.mockImplementation(() => {
      // El Blob reclasifica una esfera desprendida dentro de applyDamage.
      metadata.kind = "dynamic";
      metadata.damageable = undefined;
    });

    expect(weapon.tryFire(fireContext())).toBe(true);

    expect(applyDamage).toHaveBeenCalledWith(
      GravityGunConfig.puntNpcDamage,
      expect.any(Vector3),
      "shell-3",
      "player",
      hit.point,
    );
    expect(registerLaunch).toHaveBeenCalledWith(
      body,
      "player",
      "Gravity Gun",
      0,
    );
    expect(body.linvel().y).toBeCloseTo(GravityGunConfig.puntLift);
    expect(body.linvel().z).toBeCloseTo(-GravityGunConfig.puntSpeed);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      weaponName: "Gravity Gun",
      targetId: "target-npc",
      surfaceKind: "npc",
      damage: GravityGunConfig.puntNpcDamage,
      sourceId: "player",
    });
  });

  it("keeps RMB grab non-damaging for a dynamic NPC", async () => {
    const {
      applyDamage,
      body,
      registerLaunch,
      weapon,
      hits,
      alternateFires,
    } = await setup();

    weapon.tryAlternateFire({
      ...fireContext(),
      pressed: true,
      held: true,
    });

    expect(applyDamage).not.toHaveBeenCalled();
    expect(registerLaunch).not.toHaveBeenCalled();
    expect(hits).toHaveLength(0);
    expect(alternateFires).toHaveLength(1);
    expect(body.gravityScale()).toBe(0);

    weapon.onUnequip();
    expect(body.gravityScale()).toBe(1);
  });

  it("keeps ordinary dynamic props non-damageable when punted", async () => {
    const { applyDamage, body, registerLaunch, weapon, hits } = await setup("prop");

    weapon.tryFire(fireContext());

    expect(applyDamage).not.toHaveBeenCalled();
    expect(registerLaunch).toHaveBeenCalledWith(
      body,
      "player",
      "Gravity Gun",
      0,
    );
    expect(hits).toHaveLength(0);
  });

  it("preserves direct punt damage for a non-grabbable NPC", async () => {
    const { applyDamage, registerLaunch, weapon, hits } = await setup("kinematicNpc");

    weapon.tryFire(fireContext());

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(registerLaunch).not.toHaveBeenCalled();
    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBe(GravityGunConfig.puntNpcDamage);
  });
});
