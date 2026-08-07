import { describe, expect, it } from "vitest";
import { CarryConfig } from "@game/config/gameplay.config";
import { GravityGunConfig } from "@game/config/gravitygun.config";
import {
  PROP_ARCHETYPE_IDS,
  PropArchetypes,
  type PropArchetype,
} from "@game/config/props.config";
import { SurfaceImpactMaterial } from "@game/config/audio.config";

const archetypes: PropArchetype[] = PROP_ARCHETYPE_IDS.map((id) => PropArchetypes[id]);

describe("PropArchetypes", () => {
  it("la tabla y la lista de ids no se desincronizan", () => {
    expect(Object.keys(PropArchetypes).sort()).toEqual([...PROP_ARCHETYPE_IDS].sort());
    for (const id of PROP_ARCHETYPE_IDS) {
      expect(PropArchetypes[id].id).toBe(id);
    }
  });

  it("cada arquetipo tiene nombre visible y bounds positivos", () => {
    for (const archetype of archetypes) {
      expect(archetype.displayName.length).toBeGreaterThan(0);
      for (const extent of archetype.bounds) {
        expect(extent).toBeGreaterThan(0);
      }
    }
  });

  it("toda superficie usada resuelve a un material de impacto", () => {
    for (const archetype of archetypes) {
      expect(SurfaceImpactMaterial[archetype.surface]).toBeDefined();
    }
  });

  it("lo que se rompe declara sus gibs, y lo indestructible no se rompe", () => {
    for (const archetype of archetypes) {
      if (archetype.breakReaction.kind === "shatter") {
        expect(archetype.gibs, `${archetype.id} sin gibs`).toBeDefined();
        expect(archetype.gibs!.minChunks).toBeGreaterThan(0);
        expect(archetype.gibs!.maxChunks).toBeGreaterThanOrEqual(archetype.gibs!.minChunks);
      }
      if (archetype.damage.health === false) {
        expect(archetype.breakReaction.kind, `${archetype.id} indestructible pero rompible`).toBe(
          "none",
        );
      }
    }
  });

  it("sólo la familia metálica se abolla", () => {
    for (const archetype of archetypes) {
      if (!archetype.deform) continue;
      expect(["metal", "plastic"], `${archetype.id} no debería abollarse`).toContain(
        archetype.surface,
      );
      expect(archetype.deform.maxDepth).toBeGreaterThan(archetype.deform.depth);
    }
  });

  it("las masas caen dentro de los umbrales de agarre", () => {
    for (const archetype of archetypes) {
      expect(archetype.physics.mass).toBeGreaterThan(0);
      // Un prop más pesado que el límite de la gravity gun sería decorado
      // inamovible sin que nada en la tabla lo dijera.
      expect(archetype.physics.mass).toBeLessThanOrEqual(GravityGunConfig.grabMaxMass);
    }
  });

  it("hay props livianos que se pueden levantar a mano", () => {
    const carryable = archetypes.filter(
      (archetype) => archetype.physics.grabbable && archetype.physics.mass <= CarryConfig.maxMass,
    );
    expect(carryable.length).toBeGreaterThan(3);
  });

  it("la densidad implícita de cada prop es plausible", () => {
    for (const archetype of archetypes) {
      const [x, y, z] = archetype.bounds;
      const density = archetype.physics.mass / (x * y * z);
      // Entre corcho y acero macizo: atrapa una masa tipeada con un cero de más.
      expect(density, `${archetype.id} densidad ${density.toFixed(0)}`).toBeGreaterThan(10);
      expect(density, `${archetype.id} densidad ${density.toFixed(0)}`).toBeLessThan(8000);
    }
  });

  it("los multiplicadores de daño son factores positivos", () => {
    for (const archetype of archetypes) {
      for (const value of Object.values(archetype.damage.multipliers ?? {})) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(10);
      }
    }
  });
});
