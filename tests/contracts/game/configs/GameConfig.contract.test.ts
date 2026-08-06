import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import { AssetManifest } from "@engine/assets/AssetManifest";
import { ActionOrder, DefaultBindings, NonRebindableActions } from "@game/config/controls.config";
import { PlayerConfig } from "@game/config/gameplay.config";
import { ChargerTypes, ItemDefinitions } from "@game/config/items.config";
import { AmmoDefinitions } from "@game/config/ammo.config";
import {
	  EnemyAudio,
	  HevSuitAudio,
	  Soundscapes,
	  UiAudio,
	  WeaponAudio,
  type EnemySoundMap,
  type WeaponSoundMap,
} from "@game/config/audio.config";
import {
  getAllWeaponDefinitions,
  getSlotForWeapon,
  SlotByCategory,
  WEAPON_ORDER,
  WEAPON_SLOT_COUNT,
  WeaponDefinitions,
} from "@game/config/weapons.config";
import { getWeaponIcon } from "@game/ui/hud/HudIcons";

describe("game config contracts", () => {
  it("keeps weapon order, slots and asset references valid", () => {
    const weaponIds = Object.keys(WeaponDefinitions);
    const modelIds = new Set(Object.keys(AssetManifest.models));

    expect(new Set(WEAPON_ORDER).size).toBe(WEAPON_ORDER.length);
    expect([...WEAPON_ORDER].sort()).toEqual([...weaponIds].sort());
    expect(getAllWeaponDefinitions().map((weapon) => weapon.id)).toEqual(WEAPON_ORDER);

    for (const weapon of getAllWeaponDefinitions()) {
      expect(weapon.id).toBe(WeaponDefinitions[weapon.id].id);
      expect(modelIds.has(weapon.modelId)).toBe(true);
      expect(modelIds.has(weapon.pickupModelId)).toBe(true);
      expect(getSlotForWeapon(weapon.id)).toBeGreaterThanOrEqual(1);
      expect(getSlotForWeapon(weapon.id)).toBeLessThanOrEqual(WEAPON_SLOT_COUNT);
      expect(SlotByCategory[weapon.category]).toBe(getSlotForWeapon(weapon.id));
      expect(weapon.fireRate).toBeGreaterThan(0);
      expect(weapon.damage).toBeGreaterThanOrEqual(0);
      expect(weapon.pickupScale).toBeGreaterThan(0);
      expect(weapon.pickupScale).toBeGreaterThanOrEqual(0.05);
      expect(weapon.pickupScale).toBeLessThanOrEqual(0.55);
      expect(weapon.viewModelScale).toBeGreaterThanOrEqual(0.05);
      expect(weapon.viewModelScale).toBeLessThanOrEqual(0.6);
      expectVectorWithin(weapon.pickupCollider, 0.02, 1.2);
      expect(getWeaponIcon(weapon.id)).toContain("<svg");

      if (weapon.hasAmmo) {
        expect(weapon.reserveAmmoMax + weapon.magazineSize).toBeGreaterThan(0);
      } else {
        expect(weapon.reserveAmmoMax).toBe(0);
      }
    }
  });

  it("keeps item and charger asset references valid", () => {
    const modelIds = new Set(Object.keys(AssetManifest.models));

    for (const item of Object.values(ItemDefinitions)) {
      expect(modelIds.has(item.modelId)).toBe(true);
      expect(item.amount).toBeGreaterThan(0);
      expect(item.pickupRadius).toBeGreaterThan(0);
      expect(item.pickupScale).toBeGreaterThan(0);
    }

    for (const charger of Object.values(ChargerTypes)) {
      expect(modelIds.has(charger.modelId)).toBe(true);
      expect(charger.capacity).toBeGreaterThan(0);
      expect(charger.rate).toBeGreaterThan(0);
      expect(charger.maxDistance).toBeGreaterThan(0);
    }
  });

  it("keeps ammo definitions aligned with weapons and assets", () => {
    const modelIds = new Set(Object.keys(AssetManifest.models));

    for (const ammo of Object.values(AmmoDefinitions)) {
      const weapon = WeaponDefinitions[ammo.weaponId];
      expect(weapon).toBeDefined();
      expect(weapon.hasAmmo).toBe(true);
      expect(modelIds.has(ammo.modelId)).toBe(true);
      if (ammo.id === "energyBall") {
        expect(ammo.weaponId).toBe("ar3");
      } else {
        expect(ammo.amount).toBe(weapon.ammoPerPickup);
        expect(ammo.max).toBe(weapon.reserveAmmoMax);
      }
      expect(ammo.amount).toBeGreaterThan(0);
      expect(ammo.max).toBeGreaterThanOrEqual(ammo.amount);
      expect(ammo.pickupRadius).toBeGreaterThan(0);
      expect(ammo.pickupScale).toBeGreaterThan(0);
      expect(ammo.pickupScale).toBeGreaterThanOrEqual(0.05);
      expect(ammo.pickupScale).toBeLessThanOrEqual(0.35);
    }
  });

  it("keeps audio maps pointing at catalog clips", () => {
    const clipIds = Object.keys(AudioClipCatalog);
    expect(new Set(clipIds).size).toBe(clipIds.length);
    for (const [id, clip] of Object.entries(AudioClipCatalog)) {
      expect(clip.id).toBe(id);
    }

    for (const soundId of collectWeaponSoundIds(WeaponAudio)) {
      expect(AudioClipCatalog[soundId]).toBeDefined();
    }

    for (const soundId of collectEnemySoundIds(EnemyAudio)) {
      expect(AudioClipCatalog[soundId]).toBeDefined();
    }

	    for (const soundId of flattenSoundRefs(Object.values(UiAudio))) {
	      expect(AudioClipCatalog[soundId]).toBeDefined();
	      expect(AudioClipCatalog[soundId].bus).toBe("ui");
	    }

	    for (const soundId of flattenSoundRefs(Object.values(HevSuitAudio))) {
	      expect(AudioClipCatalog[soundId]).toBeDefined();
	      expect(["voice", "ui"]).toContain(AudioClipCatalog[soundId].bus);
	    }
	  });

  it("keeps soundscapes pointing at ambience clips", () => {
    for (const soundscape of Object.values(Soundscapes)) {
      const ambiences = "ambiences" in soundscape ? soundscape.ambiences : [];
      for (const soundId of ambiences) {
        expect(AudioClipCatalog[soundId]).toBeDefined();
      }
    }
  });

  it("keeps control bindings and gameplay constants coherent", () => {
    expect(new Set(ActionOrder).size).toBe(ActionOrder.length);
    expect([...ActionOrder].sort()).toEqual(Object.keys(DefaultBindings).sort());

    for (const action of ActionOrder) {
      expect(DefaultBindings[action].length).toBeGreaterThan(0);
    }

    for (const action of NonRebindableActions) {
      expect(ActionOrder).toContain(action);
    }

    expect(PlayerConfig.collider.radius).toBeGreaterThan(0);
    expect(PlayerConfig.collider.standingHalfHeight).toBeGreaterThan(
      PlayerConfig.collider.crouchHalfHeight,
    );
    expect(PlayerConfig.vitals.maxHealth).toBeGreaterThan(0);
    expect(PlayerConfig.vitals.armorMax).toBeGreaterThan(0);
    expect(PlayerConfig.stamina.max).toBeGreaterThan(0);
    expect(PlayerConfig.stamina.rechargeUnlockPercent).toBeGreaterThan(0);
    expect(PlayerConfig.stamina.rechargeUnlockPercent).toBeLessThan(PlayerConfig.stamina.max);
  });
});

function collectWeaponSoundIds(audio: Record<string, WeaponSoundMap>): string[] {
  return Object.values(audio).flatMap((sounds) => [
    ...flattenSoundRefs([sounds.shot, sounds.reload, sounds.empty, sounds.altShot, sounds.cock]),
    ...flattenSoundRefs(Object.values(sounds.hit ?? {})),
  ]);
}

function collectEnemySoundIds(audio: Record<string, EnemySoundMap>): string[] {
  return Object.values(audio).flatMap((sounds) =>
    flattenSoundRefs([
      sounds.alert,
      sounds.attack,
      sounds.charge,
      sounds.damaged,
      sounds.killed,
      sounds.footstep,
      sounds.flightLoop,
    ]),
  );
}

function flattenSoundRefs(values: Array<string | readonly string[] | undefined>): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") {
      return [value];
    }
    return value ? [...value] : [];
  });
}

function expectVectorWithin(
  vector: { x: number; y: number; z: number },
  min: number,
  max: number,
): void {
  for (const value of [vector.x, vector.y, vector.z]) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  }
}
