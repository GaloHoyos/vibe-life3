import {
  BoxGeometry,
  Group,
  LOD,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  VehicleAssetRegistry,
  prepareVehicleModelSource,
  type VehicleModelLoader,
} from "@game/assets/vehicles/VehicleAssetRegistry";
import type { VehicleArchetypeId } from "@game/config/vehicles.config";

describe("VehicleAssetRegistry", () => {
  it("cachea la carga, clona materiales y conserva geometría hasta el último lease", async () => {
    const source = modelSource("buggy");
    const geometry = firstMesh(source).geometry;
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const loader: VehicleModelLoader = {
      loadAsync: vi.fn(async () => ({ scene: source })),
    };
    const registry = new VehicleAssetRegistry({
      loader,
      cloneModel: (root) => root.clone(true),
      warnOnFallback: false,
    });

    const [first, second] = await Promise.all([
      registry.acquire("buggy"),
      registry.acquire("buggy"),
    ]);

    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    expect(first.source).toBe("generated");
    expect(first.root).not.toBe(second.root);
    expect(registry.getReferenceCount("buggy")).toBe(2);
    expect(first.root?.getObjectByName("runtime_visual_lods")).toBeInstanceOf(
      LOD,
    );

    const firstRenderable = firstMesh(first.root!);
    const secondRenderable = firstMesh(second.root!);
    expect(firstRenderable.geometry).toBe(secondRenderable.geometry);
    expect(firstRenderable.material).not.toBe(secondRenderable.material);
    expect(firstRenderable.frustumCulled).toBe(true);
    expect(firstRenderable.geometry.boundingSphere).not.toBeNull();

    first.dispose();
    expect(registry.getReferenceCount("buggy")).toBe(1);
    expect(disposeGeometry).not.toHaveBeenCalled();

    second.dispose();
    expect(registry.getReferenceCount("buggy")).toBe(0);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("vuelve al procedural y permite reintentar una carga fallida", async () => {
    const loader: VehicleModelLoader = {
      loadAsync: vi.fn(async () => {
        throw new Error("sin red");
      }),
    };
    const registry = new VehicleAssetRegistry({
      loader,
      warnOnFallback: false,
    });

    const first = await registry.acquire("airboat");
    const second = await registry.acquire("airboat");

    expect(first.source).toBe("fallback");
    expect(first.root).toBeNull();
    expect(first.error?.message).toBe("sin red");
    expect(second.source).toBe("fallback");
    expect(loader.loadAsync).toHaveBeenCalledTimes(2);
    expect(registry.getReferenceCount("airboat")).toBe(0);
  });

  it("mantiene el preload vivo hasta liberar el registro del nivel", async () => {
    const source = modelSource("helicopter");
    const disposeGeometry = vi.spyOn(firstMesh(source).geometry, "dispose");
    const loader: VehicleModelLoader = {
      loadAsync: vi.fn(async () => ({ scene: source })),
    };
    const registry = new VehicleAssetRegistry({
      loader,
      cloneModel: (root) => root.clone(true),
      warnOnFallback: false,
    });

    await registry.preload(["helicopter", "helicopter"]);
    const instance = await registry.acquire("helicopter");

    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    expect(registry.getReferenceCount("helicopter")).toBe(2);
    instance.dispose();
    expect(disposeGeometry).not.toHaveBeenCalled();

    registry.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
  });

  it("rechaza un GLB sin raíz o LOD completos", () => {
    const scene = new Group();
    expect(() => prepareVehicleModelSource(scene, "helicopter")).toThrow(
      /raíz declarada/,
    );

    const root = new Group();
    root.name = "helicopter_vehicle";
    scene.add(root);
    expect(() => prepareVehicleModelSource(scene, "helicopter")).toThrow(
      /visual_lod0\/1\/2/,
    );
  });
});

function modelSource(archetype: VehicleArchetypeId): Group {
  const scene = new Group();
  const root = new Group();
  root.name = `${archetype}_vehicle`;
  scene.add(root);
  for (const index of [0, 1, 2]) {
    const level = new Group();
    level.name = `visual_lod${index}`;
    level.add(
      new Mesh(
        new BoxGeometry(2 - index * 0.25, 1, 3),
        new MeshStandardMaterial({ color: 0x8d714b }),
      ),
    );
    root.add(level);
  }
  const wreckage = new Group();
  wreckage.name = "wreckage";
  wreckage.add(
    new Mesh(
      new BoxGeometry(1, 0.5, 1.5),
      new MeshStandardMaterial({ color: 0x211b16 }),
    ),
  );
  root.add(wreckage);
  return scene;
}

function firstMesh(root: Object3D): Mesh {
  let result: Mesh | null = null;
  root.traverse((node) => {
    if (!result && node instanceof Mesh) result = node;
  });
  if (!result) throw new Error("Fixture sin mesh.");
  return result;
}
