import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";

beforeAll(async () => {
  await RAPIER.init();
});

describe("PhysicsWorld.removeDynamicBody", () => {
  it("remueve el binding y la metadata, y el step siguiente no toca el body liberado", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const mesh = new Object3D();
    const body = physics.createDynamicBox(
      { id: "barrel", position: new Vector3(0, 5, 0), size: new Vector3(1, 1, 1), mass: 1 },
      mesh,
    );
    const colliderHandle = body.collider(0).handle;
    const collider = physics.world.getCollider(colliderHandle);
    expect(physics.getColliderMetadata(collider)?.id).toBe("barrel");

    physics.step(1 / 60); // sincroniza el mesh con el body vivo

    physics.removeDynamicBody(body);

    // Antes del fix: el binding colgado hacía que syncMeshes llamara translation()
    // sobre un body liberado → trap de WASM. Ahora el step debe ser inocuo.
    expect(() => physics.step(1 / 60)).not.toThrow();
    expect(physics.getColliderMetadata(collider)).toBeUndefined();
  });

  it("otros cuerpos dinámicos siguen sincronizando tras remover uno", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    const meshA = new Object3D();
    const bodyA = physics.createDynamicBox(
      { id: "a", position: new Vector3(0, 5, 0), size: new Vector3(1, 1, 1), mass: 1 },
      meshA,
    );
    const meshB = new Object3D();
    physics.createDynamicBox(
      { id: "b", position: new Vector3(3, 5, 0), size: new Vector3(1, 1, 1), mass: 1 },
      meshB,
    );

    physics.removeDynamicBody(bodyA);
    physics.step(1 / 60);
    physics.step(1 / 60);

    // B cayó por gravedad: su mesh sigue siendo sincronizado.
    expect(meshB.position.y).toBeLessThan(5);
  });
});

describe("PhysicsWorld.createStaticBoxes", () => {
  it("crea un solo body y conserva pose y metadata por collider", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const wallRotation = new Quaternion().setFromEuler(
      new Euler(0, Math.PI / 2, 0),
    );

    const body = physics.createStaticBoxes([
      {
        id: "batched-floor",
        position: new Vector3(-3, 0, 0),
        size: new Vector3(2, 1, 2),
        metadata: { surface: "metal" },
      },
      {
        id: "batched-wall",
        position: new Vector3(4, 1, 0),
        size: new Vector3(4, 2, 0.5),
        rotation: wallRotation,
        metadata: { surface: "wood" },
      },
    ]);

    expect(body).not.toBeNull();
    expect(physics.getBodyCount()).toBe(1);
    expect(body?.numColliders()).toBe(2);
    expect(body?.translation()).toEqual({ x: 0, y: 0, z: 0 });

    const floor = body!.collider(0);
    const wall = body!.collider(1);
    expect(floor.translation()).toEqual({ x: -3, y: 0, z: 0 });
    expect(wall.translation()).toEqual({ x: 4, y: 1, z: 0 });
    expect(wall.rotation().x).toBeCloseTo(wallRotation.x, 6);
    expect(wall.rotation().y).toBeCloseTo(wallRotation.y, 6);
    expect(wall.rotation().z).toBeCloseTo(wallRotation.z, 6);
    expect(wall.rotation().w).toBeCloseTo(wallRotation.w, 6);
    expect(physics.getColliderMetadata(floor)).toMatchObject({
      id: "batched-floor",
      kind: "static",
      surface: "metal",
    });
    expect(physics.getColliderMetadata(wall)).toMatchObject({
      id: "batched-wall",
      kind: "static",
      surface: "wood",
    });

    physics.updateQueryPipeline();
    const rotatedHit = new Raycast(physics).cast(
      new Vector3(10, 1, 0),
      new Vector3(-1, 0, 0),
      10,
    );
    expect(rotatedHit?.metadata?.id).toBe("batched-wall");
    // La caja mide 4 en X local, pero al rotarla 90° ese eje queda sobre Z:
    // el frente world-X está a medio espesor (4 + 0.25), no a 4 + 2.
    expect(rotatedHit?.toi).toBeCloseTo(5.75, 5);
  });

  it("los raycasts resuelven cada collider y pueden excluir uno por id", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBoxes([
      {
        id: "near-wall",
        position: new Vector3(3, 1, 0),
        size: new Vector3(1, 2, 2),
        metadata: { surface: "concrete" },
      },
      {
        id: "far-wall",
        position: new Vector3(7, 1, 0),
        size: new Vector3(1, 2, 2),
        metadata: { surface: "metal" },
      },
    ]);
    physics.updateQueryPipeline();
    const raycast = new Raycast(physics);

    const nearest = raycast.cast(
      new Vector3(0, 1, 0),
      new Vector3(1, 0, 0),
      10,
    );
    expect(nearest?.metadata).toMatchObject({
      id: "near-wall",
      surface: "concrete",
    });
    expect(nearest?.toi).toBeCloseTo(2.5, 5);

    // Ambos colliders comparten body, pero la exclusión por metadata debe
    // atravesar sólo el cercano y todavía encontrar el lejano.
    const withoutNear = raycast.cast(
      new Vector3(0, 1, 0),
      new Vector3(1, 0, 0),
      10,
      undefined,
      "near-wall",
    );
    expect(withoutNear?.metadata).toMatchObject({
      id: "far-wall",
      surface: "metal",
    });
    expect(withoutNear?.toi).toBeCloseTo(6.5, 5);
  });

  it("no crea bodies para un lote vacío y limpia toda la metadata al remover", async () => {
    const physics = new PhysicsWorld();
    await physics.init();

    expect(physics.createStaticBoxes([])).toBeNull();
    expect(physics.getBodyCount()).toBe(0);

    const body = physics.createStaticBoxes([
      {
        id: "a",
        position: new Vector3(0, 0, 0),
        size: new Vector3(1, 1, 1),
      },
      {
        id: "b",
        position: new Vector3(2, 0, 0),
        size: new Vector3(1, 1, 1),
      },
    ])!;
    const colliders = [body.collider(0), body.collider(1)];

    physics.removeBody(body);

    expect(physics.getBodyCount()).toBe(0);
    expect(physics.getColliderMetadata(colliders[0])).toBeUndefined();
    expect(physics.getColliderMetadata(colliders[1])).toBeUndefined();
  });
});
