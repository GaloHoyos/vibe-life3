import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NoBlending,
  Scene,
} from "three";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";
import { WeaponViewModel } from "@game/gameplay/weapons/effects/WeaponViewModel";

/**
 * El arma en primera persona tiene que dibujarse SIEMPRE al frente.
 *
 * `renderOrder: 1000` no alcanza por sí solo: three dibuja toda la cola
 * transparente después de la opaca y `renderOrder` sólo ordena dentro de cada
 * una. Un fragmento de prop desvaneciéndose o el vidrio de un televisor —ambos
 * transparentes— le ganaban al arma sin importar su renderOrder.
 */
function fakeAssets(): AssetManager {
  return {
    instantiateModel: vi.fn(
      async (): Promise<ModelInstance> => ({
        asset: { id: "pistol", path: "pistol.glb", type: "weapon", debug: false },
        root: new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()),
        source: "gltf",
        hasSkeleton: false,
        animationsIgnored: true,
      }),
    ),
  } as unknown as AssetManager;
}

const PISTOL = {
  id: "pistol",
  name: "pistol",
  viewModel: { assetId: "pistol" },
} as unknown as WeaponDefinition;

/**
 * Reproduce la regla de ordenamiento de `WebGLRenderLists`: primero TODA la
 * cola opaca, después la transparente, y dentro de cada una por `renderOrder`.
 * Es exactamente la regla por la que un prop transparente le ganaba al arma.
 */
function drawOrder(scene: Scene): string[] {
  const entries: { name: string; queue: number; order: number }[] = [];
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const material = node.material as MeshStandardMaterial;
    entries.push({
      name: node.name,
      queue: material.transparent ? 1 : 0,
      order: node.renderOrder,
    });
  });
  return entries
    .sort((a, b) => (a.queue === b.queue ? a.order - b.order : a.queue - b.queue))
    .map((entry) => entry.name);
}

function viewModelMeshes(root: Group): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh && node.name === "weapon-viewmodel-instance") meshes.push(node);
    else if (node instanceof Mesh && node.renderOrder === 1000) meshes.push(node);
  });
  return meshes;
}

describe("orden de dibujo del arma en primera persona", () => {
  it("el viewmodel entra a la cola transparente, sin mezclar", async () => {
    const scene = new Scene();
    const viewModel = new WeaponViewModel(scene, fakeAssets());

    await viewModel.equip(PISTOL);

    const meshes = viewModelMeshes(viewModel.getRoot());
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material as MeshStandardMaterial;
      expect(mesh.renderOrder).toBe(1000);
      // En la cola transparente, donde su renderOrder sí le gana a los props.
      expect(material.transparent).toBe(true);
      // Pero sin mezclar: sigue viéndose opaca y el alfa de su textura se ignora.
      expect(material.blending).toBe(NoBlending);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
    }
  });

  it("queda ultimo en el orden de dibujo, detras de un prop transparente", async () => {
    const scene = new Scene();
    const viewModel = new WeaponViewModel(scene, fakeAssets());
    await viewModel.equip(PISTOL);

    // Un fragmento de prop desvaneciéndose y el vidrio de un televisor: los dos
    // transparentes, con el renderOrder por defecto.
    for (const id of ["debris", "glass"]) {
      const prop = new Mesh(
        new BoxGeometry(0.2, 0.2, 0.2),
        new MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
      );
      prop.name = id;
      scene.add(prop);
    }

    const order = drawOrder(scene);

    // Antes del fix el arma era opaca: caía en el primer grupo y los dos props
    // transparentes se dibujaban encima. Ahora cierra la lista.
    expect(order.at(-1)).toBe("weapon-viewmodel-instance");
    expect(order).toContain("debris");
    expect(order).toContain("glass");
  });
});
