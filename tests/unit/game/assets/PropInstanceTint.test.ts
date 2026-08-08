import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D } from "three";
import {
  PropAssetRegistry,
  type PropModelLoader,
} from "@game/assets/props/PropAssetRegistry";
import { PropArchetypes } from "@game/config/props.config";

/** Escena mínima con la forma que el registro espera de un pack. */
function makeScene(): Object3D {
  const scene = new Object3D();
  const root = new Object3D();
  root.name = PropArchetypes.woodenCrate.asset.node;
  for (const level of [0, 1]) {
    const lod = new Object3D();
    lod.name = `visual_lod${level}`;
    const variant = new Object3D();
    variant.name = "variant_0";
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0x808080 }),
    );
    mesh.name = `crate_lod${level}_v0`;
    variant.add(mesh);
    lod.add(variant);
    root.add(lod);
  }
  scene.add(root);
  return scene;
}

function makeRegistry(): PropAssetRegistry {
  const loader: PropModelLoader = {
    loadAsync: () => Promise.resolve({ scene: makeScene() }),
  };
  return new PropAssetRegistry({
    loader,
    urls: {
      propsWood: "w",
      propsMetal: "m",
      propsSynthetic: "s",
      propsInterior: "i",
      propsAppliance: "a",
      propsDebris: "d",
      propsTech: "t",
      propsKit: "k",
    },
  });
}

function firstColor(root: Object3D): { r: number; g: number; b: number } {
  let found: { r: number; g: number; b: number } | null = null;
  root.traverse((node) => {
    if (found || !(node instanceof Mesh)) return;
    const material = node.material as MeshStandardMaterial;
    found = { r: material.color.r, g: material.color.g, b: material.color.b };
  });
  return found!;
}

describe("variación de tinte por instancia", () => {
  it("dos props con distinto id no salen del mismo color", async () => {
    // Ocho cajones idénticos en pantalla se leen como copias pegadas, que es
    // de lo que más delata a un set generado.
    const registry = makeRegistry();

    const a = await registry.acquire("woodenCrate", 0, "crate-a");
    const b = await registry.acquire("woodenCrate", 0, "crate-b");

    const colorA = firstColor(a.root!);
    const colorB = firstColor(b.root!);
    expect(colorA).not.toEqual(colorB);
    a.dispose();
    b.dispose();
    registry.dispose();
  });

  it("el mismo id da siempre el mismo color", async () => {
    // Determinista: al recargar un nivel o restaurar un guardado, el cajón que
    // el jugador vio tiene que seguir siendo del mismo color.
    const registry = makeRegistry();

    const first = await registry.acquire("woodenCrate", 0, "crate-a");
    const second = await registry.acquire("woodenCrate", 0, "crate-a");

    expect(firstColor(first.root!)).toEqual(firstColor(second.root!));
    first.dispose();
    second.dispose();
    registry.dispose();
  });

  it("sin id no se toca el color", async () => {
    const registry = makeRegistry();

    const lease = await registry.acquire("woodenCrate", 0);

    const color = firstColor(lease.root!);
    const base = new MeshStandardMaterial({ color: 0x808080 }).color;
    expect(color.r).toBeCloseTo(base.r, 5);
    lease.dispose();
    registry.dispose();
  });

  it("la variación es chica: el prop sigue leyéndose como el mismo objeto", async () => {
    const registry = makeRegistry();
    const base = new MeshStandardMaterial({ color: 0x808080 }).color;

    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const lease = await registry.acquire("woodenCrate", 0, `crate-${id}`);
      const color = firstColor(lease.root!);
      // Más que esto y dos cajones dejan de parecer el mismo cajón, que es peor
      // que el problema original.
      expect(Math.abs(color.r - base.r)).toBeLessThan(base.r * 0.16);
      expect(Math.abs(color.b - base.b)).toBeLessThan(base.b * 0.16);
      lease.dispose();
    }
    registry.dispose();
  });
});
