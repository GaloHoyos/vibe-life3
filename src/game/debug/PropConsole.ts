import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { PROP_ARCHETYPE_IDS, PropArchetypes, type PropArchetypeId } from "@game/config/props.config";
import type { PropSystem } from "@game/gameplay/props/PropSystem";
import type { PropStructureSystem } from "@game/gameplay/props/PropStructureSystem";
import type { PropDeformationSystem } from "@game/gameplay/props/PropDeformationSystem";

declare global {
  interface Window {
    /**
     * Consola de props para debug/verificación headless (mismo espíritu que
     * `__npcs` y `__ice`). Romper un prop a mano exige apuntarle con el arma
     * correcta; esto deja hacerlo desde afuera y leer el estado.
     */
    __props?: {
      /** Ids de los arquetipos del catálogo. */
      catalog: () => readonly PropArchetypeId[];
      /** Props vivos: id, arquetipo, vida y posición. */
      list: () => Array<{
        id: string;
        archetypeId: PropArchetypeId;
        health: number;
        position: [number, number, number];
      }>;
      /** Spawnea un prop en un punto (apoyado por la base). */
      spawn: (
        archetypeId: PropArchetypeId,
        x: number,
        y: number,
        z: number,
        scale?: number,
      ) => string;
      /** Aplica daño; devuelve la vida restante o -1 si no existe. */
      damage: (id: string, amount: number) => number;
      /** Mata un prop: la rotura se resuelve en el próximo update. */
      breakProp: (id: string) => boolean;
      /** Rompe todos los props vivos de una. */
      breakAll: () => number;
      /** Cuerpos de fragmentos vivos en el mundo. */
      debrisCount: () => number;
      /** Estructuras articuladas todavía en pie. */
      structureCount: () => number;
      /** Suelta las juntas de una estructura: se viene abajo. */
      collapse: (structureId: string) => boolean;
      /** Props con geometría abollada viva (techo en PropDeformConfig). */
      deformedCount: () => number;
    };
  }
}

export function installPropConsole(
  getProps: () => PropSystem,
  getPhysics: () => PhysicsWorld,
  getStructures: () => PropStructureSystem,
  getDeformation: () => PropDeformationSystem,
): () => void {
  let spawned = 0;

  const api: NonNullable<Window["__props"]> = {
    catalog: () => PROP_ARCHETYPE_IDS,
    list: () =>
      getProps()
        .all()
        .map((prop) => {
          const position = prop.position();
          return {
            id: prop.id,
            archetypeId: prop.archetype.id,
            health: prop.currentHealth(),
            position: [position.x, position.y, position.z] as [number, number, number],
          };
        }),
    spawn: (archetypeId, x, y, z, scale) => {
      if (!PropArchetypes[archetypeId]) return `arquetipo desconocido: ${archetypeId}`;
      const id = `debug-prop-${(spawned += 1)}`;
      const prop = getProps().spawn({
        id,
        archetypeId,
        position: [x, y, z],
        ...(scale === undefined ? {} : { scale }),
      });
      return prop ? id : "no se pudo spawnear";
    },
    damage: (id, amount) => {
      const prop = getProps().get(id);
      if (!prop) return -1;
      prop.applyDamage(amount, undefined, undefined, "player", undefined, "bullet");
      return prop.currentHealth();
    },
    breakProp: (id) => {
      const prop = getProps().get(id);
      if (!prop) return false;
      prop.applyDamage(Number.MAX_SAFE_INTEGER, undefined, undefined, "player", undefined, "melee");
      return !prop.isAlive();
    },
    breakAll: () => {
      const alive = [...getProps().all()];
      for (const prop of alive) {
        prop.applyDamage(
          Number.MAX_SAFE_INTEGER,
          undefined,
          undefined,
          "player",
          undefined,
          "melee",
        );
      }
      return alive.filter((prop) => !prop.isAlive()).length;
    },
    debrisCount: () =>
      getPhysics()
        .getBodiesByKind("prop")
        .filter((body) => getPhysics().getBodyMetadata(body)?.propKind === "debris").length,
    structureCount: () => getStructures().count(),
    collapse: (structureId) => {
      const before = getStructures().count();
      getStructures().collapse(structureId);
      return getStructures().count() < before;
    },
    deformedCount: () => getDeformation().count(),
  };

  window.__props = api;
  return () => {
    if (window.__props === api) {
      delete window.__props;
    }
  };
}
