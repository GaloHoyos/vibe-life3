import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  boxColliderSpec,
  colliderDescFromPart,
  colliderSpecBounds,
  toBoxPart,
  type ColliderSpec,
} from "@engine/physics/ColliderSpec";

beforeAll(async () => {
  await RAPIER.init();
});

/** Ocho esquinas de una caja centrada, como las daría un atributo `position`. */
function cubePoints(half: number): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    points.push(i & 1 ? half : -half, i & 2 ? half : -half, i & 4 ? half : -half);
  }
  return new Float32Array(points);
}

describe("colliderDescFromPart", () => {
  it("construye cada forma analítica con su descriptor propio", () => {
    expect(
      colliderDescFromPart({ shape: { kind: "box", halfExtents: [1, 2, 3] } })?.shape.type,
    ).toBe(RAPIER.ShapeType.Cuboid);
    expect(colliderDescFromPart({ shape: { kind: "sphere", radius: 0.5 } })?.shape.type).toBe(
      RAPIER.ShapeType.Ball,
    );
    expect(
      colliderDescFromPart({ shape: { kind: "capsule", radius: 0.3, halfHeight: 0.8 } })?.shape
        .type,
    ).toBe(RAPIER.ShapeType.Capsule);
  });

  it("resuelve un hull como poliedro convexo", () => {
    const desc = colliderDescFromPart({ shape: { kind: "hull", points: cubePoints(0.5) } });

    expect(desc?.shape.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
  });

  it("rechaza un hull con menos de cuatro puntos", () => {
    const line = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);

    expect(colliderDescFromPart({ shape: { kind: "hull", points: line } })).toBeNull();
  });

  it("aplica pose local, fricción, restitución y grupos", () => {
    const desc = colliderDescFromPart({
      shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] },
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      friction: 0.9,
      restitution: 0.2,
      collisionGroups: 0x00010002,
    });

    expect(desc?.translation).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(desc?.friction).toBeCloseTo(0.9, 6);
    expect(desc?.restitution).toBeCloseTo(0.2, 6);
    expect(desc?.collisionGroups).toBe(0x00010002);
  });
});

describe("toBoxPart", () => {
  it("conserva una chapa plana con espesor mínimo en vez de descartarla", () => {
    // Cuatro puntos sobre el plano Y=0: el hull no tiene volumen.
    const flat = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);

    const box = toBoxPart({ shape: { kind: "hull", points: flat } });

    expect(box.shape).toMatchObject({ kind: "box" });
    if (box.shape.kind !== "box") throw new Error("esperaba una caja");
    expect(box.shape.halfExtents[0]).toBeCloseTo(1, 6);
    expect(box.shape.halfExtents[1]).toBeGreaterThan(0);
    expect(box.shape.halfExtents[2]).toBeCloseTo(1, 6);
  });

  it("recentra la caja sobre el centro real del AABB, no sobre el origen", () => {
    // Hull descentrado en X: su caja debe seguirlo, no quedar en el origen.
    const offset = new Float32Array([
      2, -1, -1, 4, -1, -1, 4, 1, -1, 2, 1, -1, 2, -1, 1, 4, -1, 1, 4, 1, 1, 2, 1, 1,
    ]);

    const box = toBoxPart({ shape: { kind: "hull", points: offset }, position: [10, 0, 0] });

    expect(box.position?.[0]).toBeCloseTo(13, 6);
    expect(box.shape.kind === "box" && box.shape.halfExtents[0]).toBeCloseTo(1, 6);
  });

  it("preserva pose, fricción y grupos de la parte original", () => {
    const box = toBoxPart({
      shape: { kind: "hull", points: cubePoints(0.5) },
      rotation: [0, 0, 0, 1],
      friction: 0.8,
      collisionGroups: 0x00040002,
    });

    expect(box.friction).toBeCloseTo(0.8, 6);
    expect(box.collisionGroups).toBe(0x00040002);
    expect(box.rotation).toEqual([0, 0, 0, 1]);
  });
});

describe("colliderSpecBounds", () => {
  it("mide extensiones completas, no medias", () => {
    expect(colliderSpecBounds(boxColliderSpec([2, 1, 4]))).toEqual([2, 1, 4]);
  });

  it("envuelve todas las partes de un compound desplazado", () => {
    const spec: ColliderSpec = [
      { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [-2, 0, 0] },
      { shape: { kind: "box", halfExtents: [0.5, 0.5, 0.5] }, position: [2, 0, 0] },
    ];

    expect(colliderSpecBounds(spec)).toEqual([5, 1, 1]);
  });

  it("cubre una cápsula incluyendo sus casquetes", () => {
    const spec: ColliderSpec = [{ shape: { kind: "capsule", radius: 0.3, halfHeight: 0.7 } }];

    expect(colliderSpecBounds(spec)).toEqual([0.6, 2, 0.6]);
  });

  it("acota una parte rotada por las esquinas giradas", () => {
    // 90° sobre Y: el eje largo X local pasa a Z world.
    const quarterTurnY = Math.SQRT1_2;
    const spec: ColliderSpec = [
      {
        shape: { kind: "box", halfExtents: [2, 0.5, 0.5] },
        rotation: [0, quarterTurnY, 0, quarterTurnY],
      },
    ];

    const [x, y, z] = colliderSpecBounds(spec);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(4, 5);
  });

  it("devuelve cero para un spec vacío", () => {
    expect(colliderSpecBounds([])).toEqual([0, 0, 0]);
  });
});
