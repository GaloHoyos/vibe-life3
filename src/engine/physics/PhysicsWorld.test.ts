import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { PhysicsWorld } from "./PhysicsWorld";

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
