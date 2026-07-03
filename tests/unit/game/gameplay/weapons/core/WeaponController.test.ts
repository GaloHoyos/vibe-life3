import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { WeaponController } from "@game/gameplay/weapons/core/WeaponController";
import { recordEvents } from "@tests/support/events";

function setup() {
  const bus = new EventBus<GameEventMap>();
  const controller = new WeaponController(
    bus,
    { cast: () => null } as unknown as Raycast,
    fakeAssets(),
    new Scene(),
    { spawn: vi.fn() } as unknown as GrenadeSystem,
    {
      spawn: vi.fn(() => "rocket-test"),
      hasRocket: vi.fn(() => false),
      updateLaser: vi.fn(),
      hideLaser: vi.fn(),
    } as unknown as RocketSystem,
    { spawn: vi.fn() } as unknown as BoltSystem,
    { spawn: vi.fn() } as unknown as EnergyBallSystem,
    { fire: vi.fn(), surf: vi.fn(), stopSurf: vi.fn() } as unknown as IceGunSystem,
    {
      fire: vi.fn(() => true),
      throughRaycast: {
        cast: () => null,
        castSegments: () => ({ hit: null, segments: [] }),
      },
    } as unknown as PortalGunSystem,
  );
  return {
    controller,
    ammoPickup: recordEvents(bus, "player.pickup.ammo"),
    ammoChanged: recordEvents(bus, "weapon.ammo.changed"),
  };
}

describe("WeaponController ammo inventory", () => {
  it("permite levantar municion antes de tener el arma y la preserva", () => {
    const { controller, ammoPickup } = setup();

    expect(controller.pickupAmmo("pistol")).toBe(true);
    expect(controller.inventory.hasWeapon("pistol")).toBe(false);
    expect(controller.ammo.get("pistol")).toBe(18);

    expect(controller.pickupWeapon("pistol")).toBe(true);
    const pistol = controller.inventory.getWeapon("pistol");
    expect(pistol?.getAmmo()).toBe(18);
    expect(pistol?.getReserveAmmo()).toBe(36);
    expect(ammoPickup).toHaveLength(1);
  });

  it("convierte un pickup duplicado de arma en municion global", () => {
    const { controller, ammoChanged } = setup();

    expect(controller.pickupWeapon("smg")).toBe(true);
    expect(controller.ammo.get("smg")).toBe(45);

    expect(controller.pickupWeapon("smg")).toBe(true);
    expect(controller.ammo.get("smg")).toBe(90);
    expect(ammoChanged.at(-1)).toMatchObject({
      weaponId: "smg",
      current: 45,
      reserve: 90,
    });
  });

  it("recarga consumiendo reserva global", () => {
    const { controller } = setup();
    controller.pickupWeapon("pistol");
    const pistol = controller.inventory.getWeapon("pistol");
    expect(pistol).not.toBeNull();

    for (let i = 0; i < 3; i += 1) {
      pistol?.tryFire({
        origin: new Vector3(0, 1, 0),
        direction: new Vector3(0, 0, -1),
        cameraQuaternion: new Quaternion(),
        now: i * 0.4,
      });
    }

    expect(pistol?.getAmmo()).toBe(15);
    expect(controller.ammo.get("pistol")).toBe(18);

    expect(pistol?.tryReload(2)).toBe(true);
    expect(pistol?.getAmmo()).toBe(18);
    expect(controller.ammo.get("pistol")).toBe(15);
  });

  it("captura y restaura ammo global aunque no exista el arma", () => {
    const { controller } = setup();
    controller.pickupAmmo("rpg");
    controller.pickupWeapon("pistol");

    const snapshot = controller.captureLoadout();
    const restored = setup().controller;
    restored.restoreLoadout(snapshot.entries, snapshot.activeId, snapshot.ammo);

    expect(restored.inventory.hasWeapon("pistol")).toBe(true);
    expect(restored.inventory.hasWeapon("rpg")).toBe(false);
    expect(restored.ammo.get("rpg")).toBe(1);
  });

  it("migra snapshots viejos de grenade desde magazine", () => {
    const restored = setup().controller;

    restored.restoreLoadout(
      [{ id: "grenade", magazine: 3, reserve: 0 }],
      "grenade",
    );

    expect(restored.ammo.get("grenade")).toBe(3);
    expect(restored.inventory.getWeapon("grenade")?.getAmmo()).toBe(3);
  });
});

function fakeAssets(): AssetManager {
  const fallbackAsset = (id: ModelAssetId) => ({
    id,
    path: "",
    type: "prop" as const,
    debug: false,
  });
  return {
    instantiateModel: vi.fn(async (id: ModelAssetId): Promise<ModelInstance> => ({
      asset: fallbackAsset(id),
      root: new Mesh(
        new BoxGeometry(0.1, 0.1, 0.1),
        new MeshBasicMaterial(),
      ),
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    })),
  } as unknown as AssetManager;
}
