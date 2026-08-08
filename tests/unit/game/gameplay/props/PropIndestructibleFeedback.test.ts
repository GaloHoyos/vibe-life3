import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PropArchetypes, type PropArchetypeId } from "@game/config/props.config";
import { PropDeformationSystem } from "@game/gameplay/props/PropDeformationSystem";
import { PropInstance } from "@game/gameplay/props/PropInstance";
import type { PropSystem } from "@game/gameplay/props/PropSystem";
import { PROP_BUILDERS } from "../../../../../tools/prop-assets/models";
import { mergeParts } from "../../../../../tools/shared/gltf/build";

/** Prop con geometría REAL del generador, listo para abollar. */
function buildProp(archetypeId: PropArchetypeId): {
  prop: PropInstance;
  mesh: Mesh;
  system: PropDeformationSystem;
  bus: EventBus<GameEventMap>;
} {
  const builder = PROP_BUILDERS[archetypeId as keyof typeof PROP_BUILDERS];
  const merged = mergeParts(builder(0, 0).parts, { bakeOcclusion: false });

  const root = new Group();
  const lod0 = new Group();
  lod0.name = "visual_lod0";
  const mesh = new Mesh(merged, new MeshStandardMaterial());
  lod0.add(mesh);
  root.add(lod0);
  root.updateMatrixWorld(true);

  const archetype = PropArchetypes[archetypeId];
  const bus = new EventBus<GameEventMap>();
  const props = { get: () => prop } as unknown as PropSystem;
  const system = new PropDeformationSystem(bus, props);
  const prop: PropInstance = new PropInstance(
    archetypeId,
    archetype,
    root,
    archetype.breakReaction,
    {
      // Es el cableado real de `PropSystem`: el daño se convierte en evento y el
      // sistema de deformación lo escucha desde ahí.
      onDamaged: (instance, event) =>
        bus.emit("prop.damaged", {
          propId: instance.id,
          archetypeId,
          damage: event.damage,
          health: instance.currentHealth(),
          maxHealth: instance.totalHealth,
          ...(event.point ? { point: event.point } : {}),
          ...(event.direction ? { direction: event.direction } : {}),
        }),
    },
  );
  return { prop, mesh, system, bus };
}

/** Cuánto se movió el vértice más desplazado respecto de la malla original. */
function maxDisplacement(mesh: Mesh, before: Float32Array): number {
  const positions = mesh.geometry.getAttribute("position");
  if (positions.count * 3 !== before.length) return Infinity;
  let most = 0;
  for (let index = 0; index < positions.count; index += 1) {
    most = Math.max(
      most,
      Math.hypot(
        positions.getX(index) - before[index * 3]!,
        positions.getY(index) - before[index * 3 + 1]!,
        positions.getZ(index) - before[index * 3 + 2]!,
      ),
    );
  }
  return most;
}

const DEFORMABLE = Object.values(PropArchetypes)
  .filter((archetype) => archetype.deform !== undefined)
  .map((archetype) => archetype.id);

describe("un prop indestructible igual se abolla", () => {
  it("recibir daño avisa aunque el prop no pueda morir", () => {
    // `applyDamage` cortaba en seco cuando el prop era indestructible, así que
    // nunca emitía `prop.damaged` y la deformación jamás se enteraba: un balde
    // de metal era inmune también a abollarse.
    const { prop, bus } = buildProp("metalBucket");
    expect(prop.destructible).toBe(false);
    let seen = 0;
    bus.on("prop.damaged", () => (seen += 1));

    prop.applyDamage(30, new Vector3(0, 0, -1), undefined, undefined, new Vector3(0, 0, 0.2), "bullet");

    expect(seen).toBe(1);
    expect(prop.isAlive()).toBe(true);
  });

  it("y sigue sin perder vida por más golpes que reciba", () => {
    const { prop } = buildProp("metalBucket");
    for (let shot = 0; shot < 50; shot += 1) {
      prop.applyDamage(60, new Vector3(0, 0, -1), undefined, undefined, undefined, "explosive");
    }
    expect(prop.isAlive()).toBe(true);
    expect(prop.pendingBreak).toBe(false);
  });

  it.each(DEFORMABLE)("%s se hunde de verdad al recibir un golpe", (archetypeId) => {
    const { prop, mesh, system } = buildProp(archetypeId);
    const archetype = PropArchetypes[archetypeId];
    // Golpe frontal desde +Z contra el centro de la cara del AABB.
    const depth = archetype.bounds[2] / 2;
    const point = new Vector3(0, 0, depth);
    const direction = new Vector3(0, 0, -1);

    system.dent(prop, point, direction, 40, 0);
    const before = Float32Array.from(
      mesh.geometry.getAttribute("position").array as ArrayLike<number>,
    );
    system.update(0);

    system.dent(prop, point, direction, 40, archetype.deform!.cooldown * 2);
    system.update(archetype.deform!.cooldown * 2);

    // Se exige que se mueva, no cuánto. El punto de impacto es el centro de una
    // cara del AABB, y en un prop de silueta cóncava —una barricada inclinada,
    // un emisor de mástil fino— eso cae varios centímetros afuera de la chapa:
    // la caída con la distancia da entonces un hundimiento chico y correcto.
    // Lo que este test cuida es que el prop pueda abollarse, que es lo que
    // estaba roto.
    expect(maxDisplacement(mesh, before)).toBeGreaterThan(1e-4);
  });
});
