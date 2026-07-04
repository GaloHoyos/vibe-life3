import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Valida el mecanismo que hace caer props por un portal de piso: un filtro de
 * contactos (physics hook de Rapier) suprime el contacto entre el piso y una
 * caja dinámica encima, así la gravedad la atraviesa.
 */
describe("PhysicsWorld contact-pair filter", () => {
  it("una caja apoyada descansa sobre el piso sin filtro", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, 0, 0),
      size: new Vector3(10, 1, 10),
    });
    const mesh = new Object3D();
    const box = physics.createDynamicBox(
      { id: "box", position: new Vector3(0, 1.2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      mesh,
    );
    for (let i = 0; i < 120; i += 1) physics.step(1 / 60);
    // Descansa cerca de y=1 (media caja sobre el tope del piso en y=0.5).
    expect(box.translation().y).toBeGreaterThan(0.8);
  });

  it("con el filtro activo la caja atraviesa el piso y cae", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const floorBody = physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, 0, 0),
      size: new Vector3(10, 1, 10),
    });
    const floorCollider = floorBody.collider(0);
    floorCollider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);

    const mesh = new Object3D();
    const box = physics.createDynamicBox(
      { id: "box", position: new Vector3(0, 1.2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      mesh,
    );

    physics.setContactPairFilter((c1, c2) => {
      // Suprime cualquier contacto que involucre al piso.
      if (c1 === floorCollider.handle || c2 === floorCollider.handle) {
        return null;
      }
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    });

    for (let i = 0; i < 120; i += 1) physics.step(1 / 60);
    // Sin contacto, cae muy por debajo del piso.
    expect(box.translation().y).toBeLessThan(-2);
  });

  it("el filtro solo afecta pares marcados; cajas vecinas siguen colisionando", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const floorBody = physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, 0, 0),
      size: new Vector3(20, 1, 20),
    });
    const floorCollider = floorBody.collider(0);
    floorCollider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);

    const holeMesh = new Object3D();
    const holeBox = physics.createDynamicBox(
      { id: "hole", position: new Vector3(0, 1.2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      holeMesh,
    );
    const restMesh = new Object3D();
    const restBox = physics.createDynamicBox(
      { id: "rest", position: new Vector3(6, 1.2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      restMesh,
    );
    const holeHandle = holeBox.collider(0).handle;

    // El hook DEBE ser puro (sin queries a Rapier: corrompen el solver). Solo
    // la caja marcada — precomputada fuera del step — atraviesa el piso.
    physics.setContactPairFilter((c1, c2) => {
      const involvesFloor =
        c1 === floorCollider.handle || c2 === floorCollider.handle;
      const other = c1 === floorCollider.handle ? c2 : c1;
      if (involvesFloor && other === holeHandle) return null;
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    });

    for (let i = 0; i < 120; i += 1) physics.step(1 / 60);
    expect(holeBox.translation().y).toBeLessThan(-2);
    expect(restBox.translation().y).toBeGreaterThan(0.8);
  });

  it("un query de Rapier DENTRO del hook corrompe el contacto (regresión: mantener el hook puro)", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const floorBody = physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, 0, 0),
      size: new Vector3(10, 1, 10),
    });
    floorBody.collider(0).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const box = physics.createDynamicBox(
      { id: "box", position: new Vector3(0, 1.2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      new Object3D(),
    );
    // Aunque devuelve COMPUTE_IMPULSE, llamar getCollider re-entra a WASM y la
    // caja termina cayendo. Este test documenta por qué el hook real solo usa
    // sets de enteros.
    physics.setContactPairFilter((c1) => {
      void physics.world.getCollider(c1)?.translation();
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    });
    for (let i = 0; i < 120; i += 1) physics.step(1 / 60);
    expect(box.translation().y).toBeLessThan(-2);
  });
});
