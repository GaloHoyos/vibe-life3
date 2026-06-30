import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import { AssetManifest } from "@engine/assets/AssetManifest";
import { ActionOrder, DefaultBindings, NonRebindableActions } from "@game/config/controls.config";
import { PlayerConfig } from "@game/config/gameplay.config";
import { ChargerTypes, ItemDefinitions } from "@game/config/items.config";
import {
  EnemyAudio,
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

  it("keeps audio maps pointing at catalog clips", () => {
    for (const soundId of collectWeaponSoundIds(WeaponAudio)) {
      expect(AudioClipCatalog[soundId]).toBeDefined();
    }

    for (const soundId of collectEnemySoundIds(EnemyAudio)) {
      expect(AudioClipCatalog[soundId]).toBeDefined();
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
    ...defined([sounds.shot, sounds.reload, sounds.empty, sounds.altShot, sounds.cock]),
    ...defined(Object.values(sounds.hit ?? {})),
  ]);
}

function collectEnemySoundIds(audio: Record<string, EnemySoundMap>): string[] {
  return Object.values(audio).flatMap((sounds) =>
    defined([sounds.alert, sounds.attack, sounds.damaged, sounds.killed]),
  );
}

function defined(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string");
}
