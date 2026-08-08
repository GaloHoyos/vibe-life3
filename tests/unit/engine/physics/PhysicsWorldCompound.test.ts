import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { ColliderSpec } from "@engine/physics/ColliderSpec";

beforeAll(async () => {
  await RAPIER.init();
});

function cubePoints(half: number): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    points.push(i & 1 ? half : -half, i & 2 ? half : -half, i & 4 ? half : -half);
  }
  return new Float32Array(points);
}

async function makeWorld(): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  return physics;
}

describe("PhysicsWorld.createDynamicCompound", () => {
  it("reparte la masa pedida entre las partes por volumen real", async () => {
    const physics = await makeWorld();
    // Dos cajas de volumen muy distinto: una densidad uniforme debe dar la masa
    // total pedida sin importar el reparto.
    const parts: ColliderSpec = [
      { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [-1, 0, 0] },
      { shape: { kind: "box", halfExtents: [0.25, 0.25, 0.25] }, position: [1, 0, 0] },
    ];

    const body = physics.createDynamicCompound(
      { id: "shelf", position: new Vector3(0, 3, 0), mass: 40, parts },
      new Object3D(),
    );

    expect(body.numColliders()).toBe(2);
    expect(body.mass()).toBeCloseTo(40, 4);
  });

  it("deriva la inercia de las formas: dos masas separadas giran más costosamente", async () => {
    const physics = await makeWorld();
    const centered = physics.createDynamicCompound(
      {
        id: "centered",
        position: new Vector3(0, 3, 0),
        mass: 10,
        parts: [{ shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } }],
      },
      new Object3D(),
    );
    const spread = physics.createDynamicCompound(
      {
        id: "spread",
        position: new Vector3(5, 3, 0),
        mass: 10,
        parts: [
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [-2, 0, 0] },
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [2, 0, 0] },
        ],
      },
      new Object3D(),
    );

    expect(spread.mass()).toBeCloseTo(10, 4);
    // Con `setAdditionalMass` (masa puntual) ambos tensores serían iguales.
    expect(spread.principalInertia().y).toBeGreaterThan(centered.principalInertia().y * 5);
  });

  it("registra la MISMA metadata en todas las partes y mide bounds del conjunto", async () => {
    const physics = await makeWorld();
    const body = physics.createDynamicCompound(
      {
        id: "cabinet",
        position: new Vector3(0, 2, 0),
        mass: 60,
        parts: [
          { shape: { kind: "box", halfExtents: [0.5, 1, 0.3] } },
          { shape: { kind: "box", halfExtents: [0.5, 0.1, 0.3] }, position: [0, 1.4, 0] },
        ],
        metadata: { surface: "metal" },
      },
      new Object3D(),
    );

    const first = physics.getColliderMetadata(body.collider(0));
    const second = physics.getColliderMetadata(body.collider(1));
    // Que sea el mismo objeto es lo que deja intactos los sitios que leen
    // `collider(0)` sin importar qué parte tocó el rayo.
    expect(first).toBe(second);
    expect(first).toMatchObject({ id: "cabinet", kind: "dynamic", surface: "metal" });
    // El cuerpo va de y=-1 (base del chasis) a y=1.5 (tapa del cajón superior).
    expect(first?.navigationObstacleSize).toEqual([1, 2.5, 0.6]);
  });

  it("un hull sin volumen degrada a caja en vez de romper el cuerpo", async () => {
    const physics = await makeWorld();
    // Coplanar en Y=0: `ColliderDesc.convexHull` lo acepta, pero el collider
    // resultante no tiene volumen y los objetos lo atravesarían.
    const flat = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);

    const body = physics.createDynamicCompound(
      {
        id: "bad-hull",
        position: new Vector3(0, 2, 0),
        mass: 5,
        parts: [
          { shape: { kind: "hull", points: flat } },
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } },
        ],
      },
      new Object3D(),
    );

    expect(body.numColliders()).toBe(2);
    expect(body.collider(0).shape.type).toBe(RAPIER.ShapeType.Cuboid);
    expect(body.collider(0).volume()).toBeGreaterThan(0);
    expect(body.mass()).toBeCloseTo(5, 4);
  });

  it("aplica damping al cuerpo", async () => {
    const physics = await makeWorld();
    const body = physics.createDynamicCompound(
      {
        id: "damped",
        position: new Vector3(0, 2, 0),
        mass: 5,
        linearDamping: 0.4,
        angularDamping: 0.7,
        parts: [{ shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } }],
      },
      new Object3D(),
    );

    expect(body.linearDamping()).toBeCloseTo(0.4, 6);
    expect(body.angularDamping()).toBeCloseTo(0.7, 6);
  });
});

describe("PhysicsWorld.getBodiesByKind", () => {
  it("indexa por kind y devuelve una copia segura de iterar", async () => {
    const physics = await makeWorld();
    physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 2, 0), size: new Vector3(1, 1, 1), mass: 10 },
      new Object3D(),
    );
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, 0, 0),
      size: new Vector3(10, 1, 10),
    });

    const dynamics = physics.getBodiesByKind("dynamic");
    expect(dynamics).toHaveLength(1);
    expect(physics.getBodiesByKind("static")).toHaveLength(1);
    expect(physics.getBodiesByKind("npc")).toHaveLength(0);

    // Crear cuerpos mientras se itera la copia no la muta: es lo que hace
    // seguro romper props dentro del propio pase de props.
    physics.createDynamicBox(
      { id: "crate-2", position: new Vector3(3, 2, 0), size: new Vector3(1, 1, 1), mass: 10 },
      new Object3D(),
    );
    expect(dynamics).toHaveLength(1);
    expect(physics.getBodiesByKind("dynamic")).toHaveLength(2);
  });

  it("expone la metadata del cuerpo y la retira al removerlo", async () => {
    const physics = await makeWorld();
    const body = physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 2, 0), size: new Vector3(1, 1, 1), mass: 10 },
      new Object3D(),
    );

    expect(physics.getBodyMetadata(body)?.id).toBe("crate");

    physics.removeBody(body);

    expect(physics.getBodyMetadata(body)).toBeUndefined();
    expect(physics.getBodiesByKind("dynamic")).toHaveLength(0);
  });

  it("re-registrar el collider primario actualiza la identidad del cuerpo", async () => {
    const physics = await makeWorld();
    const body = physics.createDynamicBox(
      { id: "chunk", position: new Vector3(0, 2, 0), size: new Vector3(1, 1, 1), mass: 1 },
      new Object3D(),
    );

    // Es lo que hace un fragmento al desprenderse de un actor: se reclasifica
    // sobre el mismo collider. Con "primero gana" a secas, el cambio se perdía.
    physics.registerCollider(body.collider(0), {
      id: "chunk",
      kind: "prop",
      propImpactExcluded: true,
    });

    expect(physics.getBodyMetadata(body)).toMatchObject({
      kind: "prop",
      propImpactExcluded: true,
    });
    expect(physics.getBodiesByKind("prop")).toHaveLength(1);
    expect(physics.getBodiesByKind("dynamic")).toHaveLength(0);
  });

  it("una parte extra de un compound no pisa la identidad del cuerpo", async () => {
    const physics = await makeWorld();
    const body = physics.createDynamicCompound(
      {
        id: "cabinet",
        position: new Vector3(0, 2, 0),
        mass: 20,
        parts: [
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] } },
          { shape: { kind: "box", halfExtents: [0.2, 0.2, 0.2] }, position: [0, 0.8, 0] },
        ],
        metadata: { kind: "prop" },
      },
      new Object3D(),
    );

    physics.registerCollider(body.collider(1), { id: "otra-cosa", kind: "npc" });

    expect(physics.getBodyMetadata(body)?.id).toBe("cabinet");
    expect(physics.getBodiesByKind("npc")).toHaveLength(0);
  });

  it("reset vacía el índice", async () => {
    const physics = await makeWorld();
    physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 2, 0), size: new Vector3(1, 1, 1), mass: 10 },
      new Object3D(),
    );

    physics.reset();

    expect(physics.getBodiesByKind("dynamic")).toHaveLength(0);
  });
});

describe("PhysicsWorld.createDynamicClone", () => {
  it("conserva la forma de hull en vez de degradarla a un cubo fijo", async () => {
    const physics = await makeWorld();
    const source = physics.createDynamicCompound(
      {
        id: "barrel",
        position: new Vector3(0, 3, 0),
        mass: 30,
        parts: [{ shape: { kind: "hull", points: cubePoints(0.4) } }],
      },
      new Object3D(),
    );

    const clone = physics.createDynamicClone(source, new Vector3(9, 3, 0), new Quaternion());

    expect(clone.collider(0).shape.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
  });

  it("conserva la pose local de cada parte de un compound", async () => {
    const physics = await makeWorld();
    const source = physics.createDynamicCompound(
      {
        id: "shelf",
        position: new Vector3(0, 3, 0),
        mass: 20,
        parts: [
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [-1.5, 0, 0] },
          { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [1.5, 0, 0] },
        ],
      },
      new Object3D(),
    );

    const clone = physics.createDynamicClone(source, new Vector3(20, 3, 0), new Quaternion());

    // Antes del fix ambas partes caían sobre el origen del cuerpo (x = 20).
    const xs = [clone.collider(0).translation().x, clone.collider(1).translation().x].sort(
      (a, b) => a - b,
    );
    expect(xs[0]).toBeCloseTo(18.5, 5);
    expect(xs[1]).toBeCloseTo(21.5, 5);
  });

  it("conserva la pose local con el cuerpo fuente rotado", async () => {
    const physics = await makeWorld();
    const quarterTurnY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const source = physics.createDynamicCompound(
      {
        id: "shelf",
        position: new Vector3(0, 3, 0),
        rotation: quarterTurnY,
        mass: 20,
        parts: [{ shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [2, 0, 0] }],
      },
      new Object3D(),
    );

    const clone = physics.createDynamicClone(source, new Vector3(0, 10, 0), new Quaternion());

    // Sin rotación en el clon, la parte local (2,0,0) debe volver al eje X.
    const local = clone.collider(0).translation();
    expect(local.x).toBeCloseTo(2, 4);
    expect(local.y).toBeCloseTo(10, 4);
    expect(local.z).toBeCloseTo(0, 4);
  });
});
