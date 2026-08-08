import { describe, expect, it } from "vitest";
import { BoxGeometry, LOD, Mesh, MeshStandardMaterial, Object3D } from "three";
import {
  PropAssetRegistry,
  readPackChunks,
  readPackColliders,
  type PropModelLoader,
} from "@game/assets/props/PropAssetRegistry";
import { PropArchetypes } from "@game/config/props.config";

/**
 * Los tres packs meten cuatro props en un mismo GLB, y todos repiten los
 * nombres autorados (`visual_lod0`, `variant_0`, `collider_0`, `chunks`).
 * `GLTFLoader` los hace únicos al cargar: el segundo `chunks` entra como
 * `chunks_1`, el tercero como `chunks_2`. Estos tests reproducen esa escena
 * porque es lo que el registro ve en runtime, no lo que dice el manifiesto.
 */
const SUFFIXED = "_1";
/** Factor de desnormalización que `meshopt` deja en la escala del nodo. */
const QUANTIZE_SCALE = 0.25;

function makeMesh(name: string, size: number, scale: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial());
  mesh.name = name;
  mesh.scale.setScalar(scale);
  return mesh;
}

function makeProp(node: string, suffix: string): Object3D {
  const root = new Object3D();
  root.name = node;

  for (const level of [0, 1]) {
    const lodRoot = new Object3D();
    lodRoot.name = `visual_lod${level}${suffix}`;
    const variant = new Object3D();
    variant.name = `variant_0${suffix}`;
    variant.add(makeMesh(`${node}_lod${level}_v0`, 1, 1));
    lodRoot.add(variant);
    root.add(lodRoot);
  }

  root.add(makeMesh(`collider_0${suffix}`, 2, QUANTIZE_SCALE));

  const chunksRoot = new Object3D();
  chunksRoot.name = `chunks${suffix}`;
  const chunk = makeMesh(`chunk_0${suffix}`, 1, QUANTIZE_SCALE);
  chunk.position.set(0.3, 0, 0);
  chunk.userData = { sector: [1, 0, 0], massFraction: 1 };
  chunksRoot.add(chunk);
  root.add(chunksRoot);

  return root;
}

/** `woodenCrate` conserva sus nombres; `pallet` es el segundo del pack. */
function makePackScene(): Object3D {
  const scene = new Object3D();
  scene.add(makeProp(PropArchetypes.woodenCrate.asset.node, ""));
  scene.add(makeProp(PropArchetypes.pallet.asset.node, SUFFIXED));
  return scene;
}

function makeRegistry(scene: Object3D): PropAssetRegistry {
  const loader: PropModelLoader = { loadAsync: () => Promise.resolve({ scene }) };
  return new PropAssetRegistry({
    loader,
    urls: {
      propsWood: "wood",
      propsMetal: "metal",
      propsSynthetic: "synthetic",
      propsInterior: "interior",
      propsAppliance: "appliance",
      propsDebris: "debris",
      propsTech: "tech",
    },
  });
}

function boundsOf(points: Float32Array, axis: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let index = axis; index < points.length; index += 3) {
    min = Math.min(min, points[index]!);
    max = Math.max(max, points[index]!);
  }
  return { min, max };
}

describe("PropAssetRegistry con nombres de nodo renombrados por GLTFLoader", () => {
  it("lee el casco del prop que quedó con nombres sufijados", () => {
    const colliders = readPackColliders(makePackScene());

    expect(colliders.has("woodenCrate")).toBe(true);
    expect(colliders.has("pallet")).toBe(true);
  });

  it("el casco viene en metros, no en el espacio cuantizado del buffer", () => {
    const colliders = readPackColliders(makePackScene());

    for (const id of ["woodenCrate", "pallet"] as const) {
      const part = colliders.get(id)![0]!;
      expect(part.shape.kind).toBe("hull");
      if (part.shape.kind !== "hull") continue;
      const { min, max } = boundsOf(part.shape.points, 1);
      // La caja mide 2 con el nodo a 0.25: el casco real es de 0.5, no de 2.
      expect(max - min).toBeCloseTo(2 * QUANTIZE_SCALE, 5);
    }
  });

  it("lee los fragmentos del prop sufijado, no sólo los del primero del pack", () => {
    const chunks = readPackChunks(makePackScene());

    for (const id of ["woodenCrate", "pallet"] as const) {
      const chunk = chunks.get(id)?.[0];
      expect(chunk, `${id} se quedó sin fragmentos`).toBeDefined();
      expect(chunk!.center[0]).toBeCloseTo(0.3, 5);
      expect(chunk!.size[0]).toBeCloseTo(QUANTIZE_SCALE, 5);
    }
  });

  it("arma el LOD de un prop sufijado y le esconde casco y fragmentos", async () => {
    const registry = makeRegistry(makePackScene());

    const lease = await registry.acquire("pallet");

    expect(lease.source).toBe("generated");
    const root = lease.root!;
    const lod = root.getObjectByName("runtime_visual_lods");
    expect(lod).toBeInstanceOf(LOD);
    // Sin LOD el prop se dibuja crudo; con el LOD vacío desaparece a distancia.
    expect((lod as LOD).levels).toHaveLength(2);
    for (const level of (lod as LOD).levels) {
      expect(level.object.children.length).toBeGreaterThan(0);
    }
    for (const child of root.children) {
      if (child === lod) continue;
      expect(child.visible, `${child.name} se dibuja y no debería`).toBe(false);
    }
    lease.dispose();
    registry.dispose();
  });

  it("el prop sufijado conserva su variante visible", async () => {
    const registry = makeRegistry(makePackScene());

    const lease = await registry.acquire("pallet");

    const meshes: string[] = [];
    lease.root!.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node.name);
    });
    expect(meshes).toContain(`${PropArchetypes.pallet.asset.node}_lod0_v0`);
    expect(meshes).toContain(`${PropArchetypes.pallet.asset.node}_lod1_v0`);
    lease.dispose();
    registry.dispose();
  });
});
