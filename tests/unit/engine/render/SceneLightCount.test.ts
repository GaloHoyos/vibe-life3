/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { Color, Light, Scene, Vector2, Vector3, type WebGLRenderer } from "three";
import { VfxSystem, type VfxEmitterConfig } from "@engine/render/effects/VfxSystem";
import { WeaponViewModel } from "@game/gameplay/weapons/effects/WeaponViewModel";
import type { AssetManager } from "@engine/assets/AssetManager";

/**
 * Three cuenta las luces con `traverseVisible` y mete el conteo en la clave de
 * caché del programa: si cambia, recompila TODOS los materiales iluminados de la
 * escena. Con un nivel cargado eso son segundos de freeze, así que ningún efecto
 * puede agregar, sacar ni esconder una luz en runtime. Esta suite fija ese
 * invariante — ya se rompió tres veces (destellos, emisores, fogonazo).
 */
describe("conteo de luces visibles de la escena", () => {
  it("los emisores con luz salen de un pool: prender y apagar no mueve el conteo", () => {
    const scene = new Scene();
    const vfx = new VfxSystem(scene, fakeRenderer());
    const baseline = countVisibleLights(scene);

    const emitters = Array.from({ length: 4 }, () =>
      vfx.createEmitter(fireConfig()),
    );
    expect(countVisibleLights(scene)).toBe(baseline);

    emitters.forEach((emitter) => emitter.setActive(false));
    expect(countVisibleLights(scene)).toBe(baseline);

    emitters.forEach((emitter) => emitter.dispose());
    expect(countVisibleLights(scene)).toBe(baseline);
  });

  it("agotar el pool degrada la luz, nunca el conteo", () => {
    const scene = new Scene();
    const vfx = new VfxSystem(scene, fakeRenderer());
    const baseline = countVisibleLights(scene);

    // Muy por encima del pool: cada vehículo en llamas pide una.
    const emitters = Array.from({ length: 40 }, () =>
      vfx.createEmitter(fireConfig()),
    );
    vfx.update(1 / 60);

    expect(countVisibleLights(scene)).toBe(baseline);
    emitters.forEach((emitter) => emitter.dispose());
    expect(countVisibleLights(scene)).toBe(baseline);
  });

  it("recuperar el pool tras un clear deja las luces disponibles otra vez", () => {
    const scene = new Scene();
    const vfx = new VfxSystem(scene, fakeRenderer());
    const baseline = countVisibleLights(scene);

    Array.from({ length: 6 }, () => vfx.createEmitter(fireConfig()));
    vfx.clear();
    const reused = vfx.createEmitter(fireConfig());
    vfx.update(1 / 60);

    expect(countVisibleLights(scene)).toBe(baseline);
    reused.dispose();
  });

  it("la luz del fogonazo no cuelga del viewmodel: esconderlo no la apaga", () => {
    const scene = new Scene();
    const viewModel = new WeaponViewModel(scene, fakeAssets());
    const baseline = countVisibleLights(scene);
    expect(baseline).toBeGreaterThan(0);

    // Subir a un vehículo, quedarse sin arma y los passes de portal hacen esto.
    viewModel.getRoot().visible = false;

    expect(countVisibleLights(scene)).toBe(baseline);
  });
});

/** Igual que el conteo interno de Three: recorre sólo lo visible. */
function countVisibleLights(scene: Scene): number {
  let count = 0;
  scene.traverseVisible((object) => {
    if (object instanceof Light) count += 1;
  });
  return count;
}

function fireConfig(): VfxEmitterConfig {
  return {
    position: new Vector3(),
    halfExtents: new Vector3(0.2, 0.06, 0.2),
    ratePerSecond: 11,
    color: new Color(0xffc24a),
    colorJitter: 0.1,
    size: 0.18,
    endSize: 0.42,
    lifetime: 0.5,
    lifetimeJitter: 0.16,
    rise: 1.15,
    spread: 0.24,
    spreadY: 0.18,
    buoyancy: 0.4,
    blend: "additive",
    spawnRegion: "floor",
    light: {
      color: new Color(0xff7a26),
      intensity: 1.4,
      range: 7,
      flicker: 0.65,
    },
  };
}

function fakeRenderer(): WebGLRenderer {
  return {
    getDrawingBufferSize: (target: Vector2) => target.set(1920, 1080),
  } as unknown as WebGLRenderer;
}

function fakeAssets(): AssetManager {
  return {
    loadModel: () => new Promise(() => undefined),
  } as unknown as AssetManager;
}
