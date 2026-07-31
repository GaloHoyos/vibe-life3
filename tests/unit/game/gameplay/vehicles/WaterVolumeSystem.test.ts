import { afterEach, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import type { WaterVolumeDefinition } from "@game/levels/LevelDefinition";
import { WaterVolumeSystem } from "@game/gameplay/vehicles/water/WaterVolumeSystem";

/** Canal centrado en el origen: superficie en y = 2, fondo en y = -2. */
const canal: WaterVolumeDefinition = {
  id: "canal",
  position: [0, 0, 0],
  size: [40, 4, 20],
  surface: "canal",
  flow: [1.5, 0, 0],
};

const scene = new Scene();
let system: WaterVolumeSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
});

describe("WaterVolumeSystem como VehicleSurfaceProvider", () => {
  it("devuelve la superficie, su normal y la corriente sobre el volumen", () => {
    system = load([canal]);

    const sample = system.sampleSurface(new Vector3(3, 1.5, 2), 3);

    expect(sample).not.toBeNull();
    expect(sample?.kind).toBe("fluid");
    expect(sample?.point.y).toBeCloseTo(2, 6);
    expect(sample?.point.x).toBeCloseTo(3, 6);
    expect(sample?.normal.y).toBeCloseTo(1, 6);
    expect(sample?.velocity.x).toBeCloseTo(1.5, 6);
  });

  it("no devuelve muestra fuera del volumen ni por encima del alcance", () => {
    system = load([canal]);

    expect(system.sampleSurface(new Vector3(100, 1, 0), 3)).toBeNull();
    expect(system.sampleSurface(new Vector3(0, 1, 40), 3)).toBeNull();
    // Probe a 4 m bajo la superficie con alcance 1: fuera de rango.
    expect(system.sampleSurface(new Vector3(0, -2, 0), 1)).toBeNull();
  });

  it("un probe por encima de la superficie no reporta agua", () => {
    system = load([canal]);

    expect(system.sampleSurface(new Vector3(0, 3, 0), 3)).toBeNull();
  });

  it("con volúmenes superpuestos gana la superficie más alta", () => {
    system = load([
      canal,
      {
        id: "esclusa",
        position: [0, 1, 0],
        size: [10, 4, 10],
        surface: "canal",
      },
    ]);

    const sample = system.sampleSurface(new Vector3(0, 1.5, 0), 3);

    expect(sample?.point.y).toBeCloseTo(3, 6);
    expect(system.getSurfaceHeight(0, 0)).toBeCloseTo(3, 6);
    expect(system.getSurfaceHeight(18, 0)).toBeCloseTo(2, 6);
    expect(system.getSurfaceHeight(100, 0)).toBeNull();
  });

  it("clear saca las mallas de la escena y deja de muestrear", () => {
    system = load([canal]);
    const before = scene.children.length;

    system.clear();

    expect(scene.children.length).toBeLessThan(before);
    expect(system.sampleSurface(new Vector3(0, 1.5, 0), 3)).toBeNull();
    expect(system.getDefinitions()).toHaveLength(0);
  });
});

function load(definitions: readonly WaterVolumeDefinition[]): WaterVolumeSystem {
  const created = new WaterVolumeSystem(scene);
  created.load(definitions);
  return created;
}
