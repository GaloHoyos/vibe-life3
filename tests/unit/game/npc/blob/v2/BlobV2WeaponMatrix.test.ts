import { describe, expect, it } from "vitest";
import {
  BLOB_V2_FIXED_STEP_SECONDS,
  BlobOrganismController,
  type BlobDamageResult,
} from "@engine/blob/v2";
import { WeaponDefinitions } from "@game/config/weapons.config";

describe("Blob V2 live weapon matrix", () => {
  it.each([
    ["revolver", 1],
    ["pistol", 8],
    ["smg", 9],
    ["crossbow", 1],
  ] as const)("opens a focused breach with %s in %i hit(s)", (weaponId, hitCount) => {
    const weapon = WeaponDefinitions[weaponId];
    const controller = new BlobOrganismController();
    let result: BlobDamageResult | null = null;

    for (let shot = 0; shot < hitCount; shot += 1) {
      result = focusedImpact(controller, weapon.damage, false);
      if (shot + 1 < hitCount) advance(controller, 1 / weapon.fireRate);
    }

    expect(result).toMatchObject({
      target: "skin",
      openedBreach: true,
      coreDamage: 0,
    });
    expect(controller.core.health).toBe(150);
  });

  it("opens with one close shotgun trigger while the opening pellet cannot damage the core", () => {
    const weapon = WeaponDefinitions.shotgun;
    const controller = new BlobOrganismController();
    const pellets = weapon.pelletsPerShot ?? 1;
    let opening: BlobDamageResult | null = null;

    for (let pellet = 0; pellet < pellets && !opening?.openedBreach; pellet += 1) {
      const result = focusedImpact(controller, weapon.damage, false);
      if (result.openedBreach) opening = result;
    }

    expect(pellets).toBeGreaterThanOrEqual(5);
    expect(opening).toMatchObject({ openedBreach: true, coreDamage: 0 });
    expect(controller.core.health).toBe(150);
  });

  it.each(["rpg", "grenade"] as const)(
    "%s opens a large breach but needs a later impact to damage the brain",
    (weaponId) => {
      const controller = new BlobOrganismController();
      const opening = focusedImpact(controller, WeaponDefinitions[weaponId].damage, true);

      expect(opening).toMatchObject({ openedBreach: true, coreDamage: 0 });
      expect(controller.core.health).toBe(150);

      const followUp = focusedImpact(controller, WeaponDefinitions.pistol.damage, false);
      expect(followUp).toMatchObject({ target: "core", coreDamage: 12.5 });
      expect(controller.core.health).toBe(137.5);
    },
  );
});

function focusedImpact(
  controller: BlobOrganismController,
  damage: number,
  explosive: boolean,
): BlobDamageResult {
  return controller.applyImpact({
    point: { x: 1, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    impulse: { x: -Math.min(12, damage * 0.1), y: 0, z: 0 },
    damage,
    explosive,
  });
}

function advance(controller: BlobOrganismController, seconds: number): void {
  const steps = Math.ceil(seconds / BLOB_V2_FIXED_STEP_SECONDS);
  for (let step = 0; step < steps; step += 1) {
    controller.step(BLOB_V2_FIXED_STEP_SECONDS);
  }
}
