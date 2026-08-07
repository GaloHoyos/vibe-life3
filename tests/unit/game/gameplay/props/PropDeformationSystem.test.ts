import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PropArchetypes, PropDeformConfig } from "@game/config/props.config";
import { PropDeformationSystem } from "@game/gameplay/props/PropDeformationSystem";
import { PropInstance } from "@game/gameplay/props/PropInstance";
import type { PropSystem } from "@game/gameplay/props/PropSystem";

/**
 * Malla del prop con la forma que produce `PropAssetRegistry`: la geometría es
 * COMPARTIDA por todas las instancias del arquetipo, así que deformarla sin
 * clonar corrompería a todos los barriles del nivel a la vez.
 */
function makeProp(id: string, archetypeId: "metalBarrel" | "woodenCrate", shared: BoxGeometry) {
  const root = new Group();
  const lod0 = new Group();
  lod0.name = "visual_lod0";
  const mesh = new Mesh(shared, new MeshStandardMaterial());
  lod0.add(mesh);
  root.add(lod0);
  root.updateMatrixWorld(true);

  const archetype = PropArchetypes[archetypeId];
  const prop = new PropInstance(id, archetype, root, archetype.breakReaction);
  return { prop, mesh, root };
}

function setup() {
  const bus = new EventBus<GameEventMap>();
  const props = new Map<string, PropInstance>();
  const system = new PropDeformationSystem(
    bus,
    { get: (id: string) => props.get(id) } as unknown as PropSystem,
  );
  return { bus, props, system };
}

const HIT = new Vector3(0, 0.3, 0.28);
const INWARD = new Vector3(0, 0, -1);

describe("PropDeformationSystem", () => {
  it("clona la geometria antes de escribirla: no corrompe a los demas props", () => {
    const { system } = setup();
    const shared = new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6);
    const a = makeProp("barrel-a", "metalBarrel", shared);
    const b = makeProp("barrel-b", "metalBarrel", shared);
    const before = [...(shared.getAttribute("position").array as Float32Array)];

    system.dent(a.prop, HIT, INWARD, 20, 0);

    // El clon se movió; la compartida y el otro barril quedaron intactos.
    expect(a.mesh.geometry).not.toBe(shared);
    expect(b.mesh.geometry).toBe(shared);
    expect([...(shared.getAttribute("position").array as Float32Array)]).toEqual(before);
    expect(system.count()).toBe(1);
  });

  it("hunde los vertices cercanos al golpe y deja quietos los lejanos", () => {
    const { system } = setup();
    const { prop, mesh } = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 8, 8, 8),
    );

    system.dent(prop, HIT, INWARD, 20, 0);

    const positions = mesh.geometry.getAttribute("position");
    const radius = PropArchetypes.metalBarrel.deform!.radius;
    let moved = 0;
    let farUntouched = true;
    const vertex = new Vector3();
    const original = new BoxGeometry(0.56, 0.95, 0.56, 8, 8, 8).getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(original, index);
      const distance = vertex.distanceTo(HIT);
      const dz = positions.getZ(index) - vertex.z;
      if (Math.abs(dz) > 1e-6) moved += 1;
      // Fuera del radio nadie se mueve: el abollón es local, no global.
      if (distance > radius * 1.01 && Math.abs(dz) > 1e-6) farUntouched = false;
    }
    expect(moved).toBeGreaterThan(0);
    expect(farUntouched).toBe(true);
  });

  it("golpes repetidos saturan en maxDepth en vez de dar vuelta la malla", () => {
    const { system } = setup();
    const { prop, mesh } = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 8, 8, 8),
    );
    const profile = PropArchetypes.metalBarrel.deform!;
    const reference = new BoxGeometry(0.56, 0.95, 0.56, 8, 8, 8).getAttribute("position");

    // Muy por encima de lo que hace falta para llegar al techo.
    for (let hit = 0; hit < 60; hit += 1) {
      system.dent(prop, HIT, INWARD, 20, hit * (profile.cooldown + 0.01));
    }

    const positions = mesh.geometry.getAttribute("position");
    let deepest = 0;
    for (let index = 0; index < positions.count; index += 1) {
      deepest = Math.max(deepest, Math.abs(positions.getZ(index) - reference.getZ(index)));
    }
    expect(deepest).toBeGreaterThan(0);
    expect(deepest).toBeLessThanOrEqual(profile.maxDepth + 1e-6);
  });

  it("respeta el enfriamiento entre abollones del mismo prop", () => {
    const { system } = setup();
    const { prop, mesh } = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 8, 8, 8),
    );

    system.dent(prop, HIT, INWARD, 20, 0);
    const afterFirst = [...(mesh.geometry.getAttribute("position").array as Float32Array)];
    // Dentro del enfriamiento: no debe acumular.
    system.dent(prop, HIT, INWARD, 20, 0.01);

    expect([...(mesh.geometry.getAttribute("position").array as Float32Array)]).toEqual(
      afterFirst,
    );
  });

  it("ignora arquetipos que no se abollan y golpes leves", () => {
    const { system } = setup();
    const crate = makeProp("crate", "woodenCrate", new BoxGeometry(0.86, 0.86, 0.86, 4, 4, 4));
    const barrel = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6),
    );

    // La madera se rompe, no se abolla.
    system.dent(crate.prop, HIT, INWARD, 50, 0);
    // Un rasguño tampoco deja marca.
    system.dent(barrel.prop, HIT, INWARD, PropDeformConfig.minDamage - 1, 0);

    expect(system.count()).toBe(0);
  });

  it("el LRU respeta el techo y devuelve la geometria compartida al expulsar", () => {
    const { system } = setup();
    const shared = new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6);
    const created = Array.from({ length: PropDeformConfig.maxDeformedProps + 3 }, (_, index) =>
      makeProp(`barrel-${index}`, "metalBarrel", shared),
    );

    created.forEach((entry, index) => {
      system.dent(entry.prop, HIT, INWARD, 20, index);
    });

    expect(system.count()).toBe(PropDeformConfig.maxDeformedProps);
    // Los tres más viejos volvieron a la compartida; los últimos conservan clon.
    expect(created[0]!.mesh.geometry).toBe(shared);
    expect(created[1]!.mesh.geometry).toBe(shared);
    expect(created[2]!.mesh.geometry).toBe(shared);
    expect(created.at(-1)!.mesh.geometry).not.toBe(shared);
  });

  it("volver a golpear un prop lo saca del fondo del LRU", () => {
    const { system } = setup();
    const shared = new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6);
    const created = Array.from({ length: PropDeformConfig.maxDeformedProps }, (_, index) =>
      makeProp(`barrel-${index}`, "metalBarrel", shared),
    );
    created.forEach((entry, index) => system.dent(entry.prop, HIT, INWARD, 20, index));

    // El más viejo recibe otro golpe: pasa a ser el más reciente.
    const oldest = created[0]!;
    system.dent(oldest.prop, HIT, INWARD, 20, 100);
    // Uno nuevo fuerza una expulsión, que ya no debería tocarle al primero.
    const extra = makeProp("barrel-extra", "metalBarrel", shared);
    system.dent(extra.prop, HIT, INWARD, 20, 101);

    expect(oldest.mesh.geometry).not.toBe(shared);
    expect(created[1]!.mesh.geometry).toBe(shared);
  });

  it("clear devuelve todas las geometrias y libera los clones", () => {
    const { system } = setup();
    const shared = new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6);
    const entry = makeProp("barrel", "metalBarrel", shared);
    system.dent(entry.prop, HIT, INWARD, 20, 0);
    const clone = entry.mesh.geometry;
    const disposed = vi.spyOn(clone, "dispose");

    system.clear();

    expect(entry.mesh.geometry).toBe(shared);
    expect(disposed).toHaveBeenCalled();
    expect(system.count()).toBe(0);
  });

  it("un prop roto suelta su clon al llegar prop.broken", () => {
    const { bus, props, system } = setup();
    const shared = new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6);
    const entry = makeProp("barrel", "metalBarrel", shared);
    props.set("barrel", entry.prop);
    system.dent(entry.prop, HIT, INWARD, 20, 0);
    expect(system.count()).toBe(1);

    bus.emit("prop.broken", {
      propId: "barrel",
      archetypeId: "metalBarrel",
      position: new Vector3(),
      surface: "metal",
      debrisCount: 4,
      reaction: "shatter",
    });

    expect(system.count()).toBe(0);
    expect(entry.mesh.geometry).toBe(shared);
  });

  it("abolla cuando el daño llega por el bus, con su punto de impacto", () => {
    const { bus, props, system } = setup();
    const entry = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6),
    );
    props.set("barrel", entry.prop);

    bus.emit("prop.damaged", {
      propId: "barrel",
      archetypeId: "metalBarrel",
      health: 60,
      maxHealth: 75,
      damage: 15,
      point: HIT,
      direction: INWARD,
    });

    expect(system.count()).toBe(1);
  });

  it("un daño sin punto de impacto no abolla: no se sabe dónde", () => {
    const { bus, props, system } = setup();
    const entry = makeProp(
      "barrel",
      "metalBarrel",
      new BoxGeometry(0.56, 0.95, 0.56, 6, 6, 6),
    );
    props.set("barrel", entry.prop);

    bus.emit("prop.damaged", {
      propId: "barrel",
      archetypeId: "metalBarrel",
      health: 60,
      maxHealth: 75,
      damage: 15,
    });

    expect(system.count()).toBe(0);
  });
});
