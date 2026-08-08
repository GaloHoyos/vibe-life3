import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Scene, Vector3 } from "three";

vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { PropSystem } from "@game/gameplay/props/PropSystem";
import { PropStructureSystem } from "@game/gameplay/props/PropStructureSystem";
import {
  crateStackStructure,
  shelfUnitStructure,
} from "@game/levels/builders/PropStructureBuilder";
import type { PropStructureArtifact } from "@game/levels/builders/PropStructureBuilder";

async function setup() {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(60, 1, 60),
    metadata: { surface: "concrete" },
  });
  const bus = new EventBus<GameEventMap>();
  const props = new PropSystem(physics, new Scene(), bus);
  const structures = new PropStructureSystem(physics, props, bus);

  let elapsed = 0;
  const tick = (frames: number): void => {
    for (let i = 0; i < frames; i += 1) {
      physics.step(1 / 60);
      elapsed += 1 / 60;
      structures.update(elapsed);
    }
  };
  const load = (artifact: PropStructureArtifact): void => {
    for (const definition of artifact.props) props.spawn(definition);
    structures.build([artifact.structure]);
  };
  return { physics, bus, props, structures, tick, load };
}

const STACK = crateStackStructure({
  id: "stack",
  at: [0, 0],
  perLayer: 2,
  layers: 3,
  cascade: true,
});

describe("estructuras de props con juntas", () => {
  it("una pila armada se sostiene sola bajo gravedad", async () => {
    const { props, structures, tick, load } = await setup();
    load(STACK);
    const top = props.get("stack-l2-0")!;
    const restY = top.position().y;

    tick(180);

    expect(structures.count()).toBe(1);
    // Sin juntas los cajones anclados de arriba flotarían igual, pero la pila
    // entera tiene que seguir en pie y en su sitio.
    expect(Math.abs(top.position().y - restY)).toBeLessThan(0.05);
    expect(props.all()).toHaveLength(STACK.props.length);
  });

  it("los miembros nacen anclados y se sueltan al perder su ultima union", async () => {
    const { props, structures, tick, load } = await setup();
    load(STACK);
    const top = props.get("stack-l2-0")!;
    expect(top.getBody()!.isFixed()).toBe(true);

    structures.collapse("stack");
    tick(2);

    // Al soltar las juntas dejan de estar atornillados y caen.
    expect(top.getBody()!.isDynamic()).toBe(true);
    expect(structures.count()).toBe(0);
  });

  it("armada aguanta un empujon; colapsada se voltea", async () => {
    const { props, structures, tick, load } = await setup();
    load(STACK);
    const top = props.get("stack-l2-0")!;
    const start = top.position().clone();

    // Atornillada no se mueve: es lo que la vuelve cobertura confiable.
    top.getBody()!.applyImpulse({ x: 400, y: 0, z: 0 }, true);
    tick(30);
    expect(top.position().distanceTo(start)).toBeLessThan(0.02);

    // Suelta, el mismo empujón la manda a volar. Una pila que perdió sus
    // uniones sigue apoyada — no atraviesa el piso —, pero ya no resiste nada.
    structures.collapse("stack");
    tick(1);
    top.getBody()!.applyImpulse({ x: 400, y: 0, z: 0 }, true);
    tick(60);

    expect(top.position().distanceTo(start)).toBeGreaterThan(0.5);
    expect(structures.count()).toBe(0);
  });

  it("romper un miembro derrumba la estructura en cascada", async () => {
    const { props, structures, tick, load } = await setup();
    load(STACK);
    const base = props.get("stack-l0-0")!;
    const top = props.get("stack-l2-0")!;
    const restY = top.position().y;
    const crateHeight = 0.86;

    // El cajón de la base desaparece. Rapier se lleva sus juntas con el cuerpo,
    // así que la estructura lo detecta en su próximo chequeo y suelta el resto.
    props.remove(base);
    structures.update(1);

    expect(structures.count()).toBe(0);
    expect(top.getBody()!.isDynamic()).toBe(true);

    tick(120);
    // Cae la altura del cajón que ya no está debajo, y se apoya en el de abajo.
    expect(top.position().y).toBeLessThan(restY - crateHeight * 0.8);
  });

  it("una union que se estira mas de lo tolerado cede sola", async () => {
    const { props, structures, tick, load } = await setup();
    load(STACK);
    const top = props.get("stack-l2-0")!;
    const body = top.getBody()!;

    // Se lo arranca de su sitio: la deriva supera la tolerancia de la madera.
    body.setBodyType(2 /* KinematicPositionBased */, true);
    body.setNextKinematicTranslation({ x: 0, y: 6, z: 0 });
    tick(6);

    expect(structures.count()).toBe(0);
  });

  it("sin cascada solo se sueltan las uniones del miembro perdido", async () => {
    const { bus, props, structures, tick, load } = await setup();
    const shelf = shelfUnitStructure({
      id: "shelf",
      at: [10, 0],
      shelves: 3,
      cascade: false,
    });
    load(shelf);
    expect(structures.count()).toBe(1);

    const middle = props.get("shelf-s1")!;
    props.remove(middle);
    bus.emit("prop.broken", {
      propId: "shelf-s1",
      archetypeId: "woodenCrate",
      position: new Vector3(),
      surface: "wood",
      debrisCount: 4,
      reaction: "shatter",
    });
    tick(2);

    // La estructura sigue viva con sus otros dos estantes atornillados.
    expect(structures.count()).toBe(1);
    expect(props.get("shelf-s0")!.getBody()!.isFixed()).toBe(true);
    expect(props.get("shelf-s2")!.getBody()!.isFixed()).toBe(true);
  });

  it("la reaccion collapse derrumba aunque la estructura no sea en cascada", async () => {
    const { bus, props, structures, load } = await setup();
    const shelf = shelfUnitStructure({
      id: "shelf",
      at: [20, 0],
      shelves: 3,
      cascade: false,
    });
    load(shelf);

    const middle = props.get("shelf-s1")!;
    props.remove(middle);
    bus.emit("prop.broken", {
      propId: "shelf-s1",
      archetypeId: "woodenCrate",
      position: new Vector3(),
      surface: "wood",
      debrisCount: 4,
      reaction: "collapse",
    });

    expect(structures.count()).toBe(0);
    expect(props.get("shelf-s0")!.getBody()!.isDynamic()).toBe(true);
  });

  it("clear libera juntas y anclas antes del reset de fisica", async () => {
    const { physics, structures, load } = await setup();
    load(STACK);
    const bodiesBefore = physics.getBodyCount();

    structures.clear();

    expect(structures.count()).toBe(0);
    // Las anclas de las uniones con el mundo son cuerpos: tienen que irse.
    expect(physics.getBodyCount()).toBeLessThan(bodiesBefore);
  });

  it("tolera una estructura cuyos props no existen", async () => {
    const { structures } = await setup();

    expect(() =>
      structures.build([
        {
          id: "huerfana",
          joints: [
            {
              a: "no-existe",
              b: "tampoco",
              anchorA: [0, 0, 0],
              anchorB: [0, 0, 0],
              breakTranslation: 0.05,
              breakAngle: 0.2,
            },
          ],
        },
      ]),
    ).not.toThrow();
    expect(structures.count()).toBe(0);
  });
});

describe("presets de estructura", () => {
  it("la pila genera un prop por celda y una union por prop", () => {
    const stack = crateStackStructure({ id: "s", at: [0, 0], perLayer: 3, layers: 2 });

    expect(stack.props).toHaveLength(6);
    expect(stack.structure.joints).toHaveLength(6);
    // La capa de abajo va al mundo; el resto cuelga del cajón de abajo.
    const toWorld = stack.structure.joints.filter((joint) => joint.b === "world");
    expect(toWorld).toHaveLength(3);
  });

  it("las tolerancias salen del material del prop", () => {
    const wood = crateStackStructure({ id: "w", at: [0, 0], archetypeId: "woodenCrate" });
    const metal = crateStackStructure({ id: "m", at: [0, 0], archetypeId: "metalBarrel" });

    // El acero aguanta menos deriva antes de ceder que la madera.
    expect(metal.structure.joints[0]!.breakTranslation).toBeLessThan(
      wood.structure.joints[0]!.breakTranslation,
    );
  });

  it("los ids son unicos dentro de la estructura", () => {
    const stack = crateStackStructure({ id: "s", at: [0, 0], perLayer: 3, layers: 3 });
    const ids = stack.props.map((prop) => prop.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
