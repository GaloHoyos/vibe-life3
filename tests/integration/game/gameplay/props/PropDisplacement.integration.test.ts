import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Scene, Vector3 } from "three";

// Los materiales PBR reales cargan texturas por TextureLoader, que necesita DOM.
vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { PropSystem } from "@game/gameplay/props/PropSystem";

async function makeWorld(): Promise<{
  physics: PhysicsWorld;
  bus: EventBus<GameEventMap>;
  props: PropSystem;
  displaced: string[];
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(200, 1, 200),
    metadata: { surface: "concrete" },
  });
  const bus = new EventBus<GameEventMap>();
  const displaced: string[] = [];
  bus.on("prop.displaced", ({ propId }) => displaced.push(propId));
  return { physics, bus, props: new PropSystem(physics, new Scene(), bus), displaced };
}

/** Avanza la física y el muestreo del sistema en el mismo reloj. */
function run(physics: PhysicsWorld, props: PropSystem, seconds: number): void {
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    physics.step(1 / 60);
    props.update(frame / 60);
  }
}

describe("un prop que deja su puesto avisa", () => {
  it("ningun prop quieto avisa, por alto que sea", async () => {
    // Nacen apoyados y se duermen donde los pusieron: si esto avisara, TODO
    // prop del nivel se daria de baja como cobertura al primer segundo.
    //
    // Van los mas ALTOS a proposito. La posicion autorada es el apoyo y la del
    // cuerpo es el centro, asi que sin subir el origen media altura un gabinete
    // (1.32) nace a 0.66 de su propia posicion y cruza el umbral el solo.
    const { physics, props, displaced } = await makeWorld();
    props.spawn({ id: "gabinete", archetypeId: "filingCabinet", position: [0, 0, 0] });
    props.spawn({ id: "barril", archetypeId: "metalBarrel", position: [6, 0, 0] });
    props.spawn({ id: "cajon", archetypeId: "woodenCrate", position: [12, 0, 0] });

    run(physics, props, 3);

    expect(displaced).toEqual([]);
  });

  it("un prop empujado lejos avisa una sola vez", async () => {
    const { physics, props, displaced } = await makeWorld();
    const prop = props.spawn({ id: "empujado", archetypeId: "woodenCrate", position: [0, 0, 0] })!;

    run(physics, props, 1);
    expect(displaced).toEqual([]);

    // Un empujon fuerte y horizontal, como el de una explosion cercana.
    prop.getBody()!.setLinvel({ x: 9, y: 0, z: 0 }, true);
    run(physics, props, 4);

    // Una sola vez: es un cambio de estado del nivel, no un seguimiento.
    expect(displaced).toEqual(["empujado"]);
  });

  it("un prop anclado no se mueve y por lo tanto no avisa", async () => {
    const { physics, props, displaced } = await makeWorld();
    props.spawn({
      id: "anclado",
      archetypeId: "woodenCrate",
      position: [0, 0, 0],
      physicsMode: "anchored",
    });

    run(physics, props, 3);

    expect(displaced).toEqual([]);
  });

  it("limpiar el nivel olvida quien se habia movido", async () => {
    const { physics, props, displaced } = await makeWorld();
    const prop = props.spawn({ id: "p", archetypeId: "woodenCrate", position: [0, 0, 0] })!;
    prop.getBody()!.setLinvel({ x: 9, y: 0, z: 0 }, true);
    run(physics, props, 4);
    expect(displaced).toEqual(["p"]);

    props.clear();
    const again = props.spawn({ id: "p", archetypeId: "woodenCrate", position: [0, 0, 0] })!;
    again.getBody()!.setLinvel({ x: 9, y: 0, z: 0 }, true);
    run(physics, props, 4);

    // Vuelve a avisar: es otro prop, aunque comparta el id.
    expect(displaced).toEqual(["p", "p"]);
  });
});
