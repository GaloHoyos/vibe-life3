import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { MeshBasicMaterial, Scene, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { Blobulator } from "@engine/blob/Blobulator";

beforeAll(async () => {
  await RAPIER.init();
});

async function createBlobulator(): Promise<{
  blobulator: Blobulator;
  physics: PhysicsWorld;
  raycast: Raycast;
  scene: Scene;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  const scene = new Scene();
  const blobulator = new Blobulator(scene, physics, new MeshBasicMaterial(), {
    chunkSize: 2.8,
    cellSize: 0.14,
    padCells: 3,
    maxPolyCount: 30000,
    colliderIdPrefix: "ice",
    surface: "snow",
    maxChunkRebuildsPerFrame: 64,
  });
  return { blobulator, physics, raycast: new Raycast(physics), scene };
}

describe("Blobulator", () => {
  it("bakes a blob into a chunk mesh with a raycastable trimesh collider", async () => {
    const { blobulator, physics, raycast } = await createBlobulator();
    blobulator.addBlob(new Vector3(1, 1, 1), 0.45);
    blobulator.flush();
    physics.updateQueryPipeline();

    expect(blobulator.getChunkCount()).toBeGreaterThan(0);
    const hit = raycast.cast(
      new Vector3(1, 3, 1),
      new Vector3(0, -1, 0),
      5,
    );
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id.startsWith("ice-")).toBe(true);
    expect(hit!.metadata?.kind).toBe("static");
    // La superficie del metaball aislado queda cerca del radio configurado.
    expect(hit!.point.y).toBeGreaterThan(1.2);
    expect(hit!.point.y).toBeLessThan(1.6);
  });

  it("removing the last blob removes the chunk and its collider", async () => {
    const { blobulator, physics, raycast } = await createBlobulator();
    const id = blobulator.addBlob(new Vector3(0.5, 0.5, 0.5), 0.4);
    blobulator.flush();
    blobulator.removeBlob(id);
    blobulator.flush();
    physics.updateQueryPipeline();

    expect(blobulator.getChunkCount()).toBe(0);
    const hit = raycast.cast(
      new Vector3(0.5, 3, 0.5),
      new Vector3(0, -1, 0),
      5,
    );
    expect(hit).toBeNull();
  });

  it("keeps the surface continuous across a chunk boundary (no gap at the seam)", async () => {
    const { blobulator, physics, raycast } = await createBlobulator();
    // Frontera de chunk en x = 2.8: fila de blobs cruzándola.
    for (let i = 0; i < 6; i++) {
      blobulator.addBlob(new Vector3(2.0 + i * 0.35, 1, 1), 0.45);
    }
    blobulator.flush();
    physics.updateQueryPipeline();
    expect(blobulator.getChunkCount()).toBeGreaterThanOrEqual(2);

    // Muestrear la tapa superior a lo largo de la fila: sin huecos en la costura.
    for (let x = 2.1; x <= 3.6; x += 0.1) {
      const hit = raycast.cast(new Vector3(x, 3, 1), new Vector3(0, -1, 0), 5);
      expect(hit, `hueco en x=${x.toFixed(2)}`).not.toBeNull();
      expect(hit!.metadata?.id.startsWith("ice-")).toBe(true);
    }
  });

  it("shrinking a blob radius lowers the baked surface", async () => {
    const { blobulator, physics, raycast } = await createBlobulator();
    const id = blobulator.addBlob(new Vector3(1, 1, 1), 0.5);
    blobulator.flush();
    physics.updateQueryPipeline();
    const before = raycast.cast(new Vector3(1, 3, 1), new Vector3(0, -1, 0), 5);

    blobulator.setBlobRadius(id, 0.25);
    blobulator.flush();
    physics.updateQueryPipeline();
    const after = raycast.cast(new Vector3(1, 3, 1), new Vector3(0, -1, 0), 5);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.point.y).toBeLessThan(before!.point.y);
  });

  it("clear removes every chunk", async () => {
    const { blobulator, physics } = await createBlobulator();
    blobulator.addBlob(new Vector3(0, 0, 0), 0.4);
    blobulator.addBlob(new Vector3(5, 0, 0), 0.4);
    blobulator.flush();
    expect(blobulator.getChunkCount()).toBeGreaterThan(0);
    blobulator.clear();
    expect(blobulator.getChunkCount()).toBe(0);
    expect(blobulator.getBlobCount()).toBe(0);
    expect(physics.getBodyCount()).toBe(0);
  });
});
