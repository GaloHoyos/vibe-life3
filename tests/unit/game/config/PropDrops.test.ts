import { describe, expect, it } from "vitest";
import { AmmoDefinitions } from "@game/config/ammo.config";
import { ItemDefinitions } from "@game/config/items.config";
import { PropArchetypes } from "@game/config/props.config";

const archetypes = Object.values(PropArchetypes);

describe("props que sueltan pickups", () => {
  it("todo lo que un prop deja existe en su catalogo", () => {
    // El id de un item o de una munición no lo verifica el compilador contra la
    // tabla real: la union lo acepta y recién en runtime el pickup sale vacío.
    for (const archetype of archetypes) {
      if (archetype.breakReaction.kind !== "spawnItem") continue;
      for (const drop of archetype.breakReaction.drops) {
        if ("item" in drop) {
          expect(ItemDefinitions[drop.item], `${archetype.id} suelta un item inexistente`).toBeDefined();
        } else {
          expect(
            AmmoDefinitions[drop.ammo],
            `${archetype.id} suelta una municion inexistente`,
          ).toBeDefined();
        }
      }
    }
  });

  it("un prop que suelta cosas tambien deja pedazos", () => {
    for (const archetype of archetypes) {
      if (archetype.breakReaction.kind !== "spawnItem") continue;
      // `spawnItem` no reemplaza a la rotura: el cajón se parte igual, y sin
      // fragmentos desaparecería de golpe dejando los pickups flotando.
      expect(archetype.gibs, `${archetype.id} se abre sin romperse`).toBeDefined();
      expect(archetype.breakReaction.drops.length).toBeGreaterThan(0);
    }
  });

  it("las cantidades son enteros positivos", () => {
    for (const archetype of archetypes) {
      if (archetype.breakReaction.kind !== "spawnItem") continue;
      for (const drop of archetype.breakReaction.drops) {
        if (drop.count === undefined) continue;
        expect(Number.isInteger(drop.count)).toBe(true);
        expect(drop.count).toBeGreaterThan(0);
        // Un cajón que escupe veinte botiquines de una es una bomba de física.
        expect(drop.count).toBeLessThanOrEqual(4);
      }
    }
  });

  it("hay al menos un prop de cada tipo de suministro", () => {
    const kinds = new Set<string>();
    for (const archetype of archetypes) {
      if (archetype.breakReaction.kind !== "spawnItem") continue;
      for (const drop of archetype.breakReaction.drops) {
        kinds.add("item" in drop ? "item" : "ammo");
      }
    }
    expect(kinds.has("item")).toBe(true);
    expect(kinds.has("ammo")).toBe(true);
  });
});
