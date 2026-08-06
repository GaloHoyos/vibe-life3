import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AcousticProbe } from "@engine/audio/spatial/AcousticProbe";
import {
  reverbSpaceFor,
  type AcousticResponseTuning,
} from "@engine/audio/spatial/AcousticResponse";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import { AcousticResponse, SurfaceAbsorption } from "@game/config/audio.config";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";
import { materialToSurface } from "@game/levels/materialSurface";
import { AudioTestLevel } from "@game/levels/maps/custom/AudioTestLevel";

/**
 * El banco de audio existe para que cada estación suene distinta a la de al
 * lado. Este contrato corre la sonda acústica contra su geometría real y
 * verifica que las diferencias sigan ahí: si alguien mueve una pared, cambia un
 * material o toca la curva de respuesta, el mapa deja de demostrar lo que dice
 * demostrar y hay que enterarse acá, no jugando.
 *
 * Las aserciones son relaciones entre estaciones, no números exactos: el punto
 * es el contraste audible, no un valor puntual de la curva.
 */

const boxes: StaticBoxDefinition[] = [
  ...AudioTestLevel.staticBoxes,
  ...(AudioTestLevel.buildings ?? []).flatMap((building) => building.boxes),
];

/** Raycast contra las cajas del nivel (AABB slab test). */
const raycast: RaycastSource = {
  cast(origin: Vector3, direction: Vector3, maxDistance: number): RaycastHit | null {
    let best: RaycastHit | null = null;
    const o = [origin.x, origin.y, origin.z];
    const d = [direction.x, direction.y, direction.z];

    for (const box of boxes) {
      let near = 0;
      let far = maxDistance;
      let intersects = true;

      for (let axis = 0; axis < 3; axis += 1) {
        const center = box.position[axis] ?? 0;
        const half = (box.size[axis] ?? 0) / 2;
        const dir = d[axis] ?? 0;
        const start = o[axis] ?? 0;

        if (Math.abs(dir) < 1e-9) {
          if (Math.abs(start - center) > half) {
            intersects = false;
            break;
          }
          continue;
        }
        let t1 = (center - half - start) / dir;
        let t2 = (center + half - start) / dir;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
        }
        near = Math.max(near, t1);
        far = Math.min(far, t2);
        if (near > far) {
          intersects = false;
          break;
        }
      }

      // `near <= 0` = el origen está dentro de la caja (el piso bajo los pies).
      if (!intersects || near <= 0.01) {
        continue;
      }
      if (!best || near < best.toi) {
        best = {
          toi: near,
          point: new Vector3(),
          metadata: {
            id: box.id,
            kind: "static",
            surface: materialToSurface(box.material),
          } as PhysicsMetadata,
        } as RaycastHit;
      }
    }

    return best;
  },
};

const tuning: AcousticResponseTuning = AcousticResponse;
const probe = new AcousticProbe(SurfaceAbsorption);

function stationAt(x: number, z: number) {
  const estimate = probe.sample(raycast, new Vector3(x, 1.6, z));
  return { estimate, space: reverbSpaceFor(estimate, tuning) };
}

const plaza = stationAt(0, 14);
const concreteRoom = stationAt(-14, -18);
const softRoom = stationAt(-34, -18);
const hall = stationAt(0, -58);
const tunnel = stationAt(0, -95);

describe("banco de audio: la sonda distingue cada estacion", () => {
  it("las camaras quedan selladas y la explanada abierta", () => {
    expect(concreteRoom.estimate.openness).toBe(0);
    expect(softRoom.estimate.openness).toBe(0);
    expect(hall.estimate.openness).toBe(0);
    expect(tunnel.estimate.openness).toBe(0);
    expect(plaza.estimate.openness).toBeGreaterThan(0.5);
  });

  it("las pantallas frente a las puertas hacen que las camaras midan su tamano real", () => {
    // Sin pantalla el rayo sale derecho por el vano y reporta 40 m: una cámara
    // de ~350 m³ se mediría como ~1300 y sonaría mucho más grande de lo que es.
    expect(concreteRoom.estimate.volume).toBeLessThan(600);
    expect(hall.estimate.volume).toBeGreaterThan(8_000);
  });

  it("el material cambia el sonido de dos camaras identicas (estacion 2 vs 3)", () => {
    expect(softRoom.estimate.volume).toBeCloseTo(concreteRoom.estimate.volume, 0);
    expect(softRoom.estimate.absorption).toBeGreaterThan(
      concreteRoom.estimate.absorption * 2,
    );

    expect(softRoom.space.wet).toBeLessThan(concreteRoom.space.wet);
    // La sala blanda se come los agudos del retorno.
    expect(softRoom.space.toneHz).toBeLessThan(
      concreteRoom.space.toneHz - 1_000,
    );
  });

  it("el tamano cambia el sonido a igual material (estacion 2 vs 4)", () => {
    expect(hall.estimate.absorption).toBeCloseTo(
      concreteRoom.estimate.absorption,
      2,
    );

    expect(hall.space.duration).toBeGreaterThan(concreteRoom.space.duration * 1.5);
    expect(hall.space.wet).toBeGreaterThan(concreteRoom.space.wet);
    expect(hall.space.decay).toBeLessThan(concreteRoom.space.decay);
  });

  it("el tunel repica lento aunque su volumen sea el de una camara", () => {
    expect(tunnel.estimate.volume).toBeLessThan(concreteRoom.estimate.volume * 2);
    // Lo que lo hace túnel es el largo, no el volumen.
    expect(tunnel.estimate.longestExtent).toBeGreaterThan(30);
    expect(tunnel.space.echoDelay).toBeGreaterThan(
      concreteRoom.space.echoDelay * 2.5,
    );
    // Es la estación más reflectante del mapa.
    expect(tunnel.estimate.absorption).toBeLessThan(0.1);
  });

  it("la explanada es la referencia seca", () => {
    for (const station of [concreteRoom, softRoom, hall, tunnel]) {
      expect(plaza.space.wet).toBeLessThan(station.space.wet);
    }
  });
});
