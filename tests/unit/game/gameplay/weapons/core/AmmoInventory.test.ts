import { describe, expect, it } from "vitest";
import { AmmoInventory } from "@game/gameplay/weapons/core/AmmoInventory";

describe("AmmoInventory", () => {
  it("suma ammo y clampa al maximo por tipo", () => {
    const inventory = new AmmoInventory();

    expect(inventory.add("pistol", 18)).toBe(18);
    expect(inventory.get("pistol")).toBe(18);
    expect(inventory.add("pistol", 999)).toBe(72);
    expect(inventory.get("pistol")).toBe(90);
  });

  it("consume solo cuando hay suficiente reserva", () => {
    const inventory = new AmmoInventory();
    inventory.add("smg", 45);

    expect(inventory.consume("smg", 30)).toBe(true);
    expect(inventory.get("smg")).toBe(15);
    expect(inventory.consume("smg", 16)).toBe(false);
    expect(inventory.get("smg")).toBe(15);
  });

  it("restaura snapshots y consulta por WeaponId", () => {
    const inventory = new AmmoInventory();
    inventory.restore([
      { id: "rpg", amount: 2 },
      { id: "grenade", amount: 4 },
    ]);

    expect(inventory.getForWeapon("rpg")).toBe(2);
    expect(inventory.getForWeapon("grenade")).toBe(4);
    expect(inventory.getForWeapon("crowbar")).toBe(0);
    expect(inventory.capture()).toEqual(
      expect.arrayContaining([
        { id: "rpg", amount: 2 },
        { id: "grenade", amount: 4 },
      ]),
    );
  });
});
