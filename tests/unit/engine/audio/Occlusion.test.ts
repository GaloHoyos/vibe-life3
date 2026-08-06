import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  OcclusionScheduler,
  OcclusionTuning,
  occlusionFilterHz,
  occlusionGain,
  sampleOcclusion,
} from "@engine/audio/spatial/Occlusion";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";

type RaycastFilter = Parameters<RaycastSource["cast"]>[5];

/** Bloquea el rayo central y, opcionalmente, los laterales. */
function raycastBlocking(blockedRays: number): RaycastSource & { calls: number } {
  const raycast = {
    calls: 0,
    cast(
      _origin: Vector3,
      _direction: Vector3,
      _distance: number,
      _body?: unknown,
      _excludeId?: string,
      filter?: RaycastFilter,
    ): RaycastHit | null {
      raycast.calls += 1;
      if (raycast.calls > blockedRays) {
        return null;
      }
      // El sistema solo cuenta geometria del mundo como bloqueo.
      const wall = { id: "muro", kind: "static" } as PhysicsMetadata;
      if (filter && !filter(wall, undefined as never)) {
        return null;
      }
      return { point: new Vector3(), toi: 1 } as unknown as RaycastHit;
    },
  };
  return raycast;
}

const listener = new Vector3(0, 1.6, 0);
const source = new Vector3(0, 1.6, -6);

describe("occlusionFilterHz", () => {
  it("interpola en octavas entre limpio y bloqueado", () => {
    expect(occlusionFilterHz(0, 20_000, 500)).toBeCloseTo(20_000);
    expect(occlusionFilterHz(1, 20_000, 500)).toBeCloseTo(500);
    // A mitad de camino, la media geometrica: 500 * 40^0.5.
    expect(occlusionFilterHz(0.5, 20_000, 500)).toBeCloseTo(3162, 0);
  });

  it("clampea fuera de rango", () => {
    expect(occlusionFilterHz(-1, 20_000, 500)).toBeCloseTo(20_000);
    expect(occlusionFilterHz(9, 20_000, 500)).toBeCloseTo(500);
  });
});

describe("occlusionGain", () => {
  it("va de la unidad al piso configurado", () => {
    expect(occlusionGain(0, 0.3)).toBeCloseTo(1);
    expect(occlusionGain(1, 0.3)).toBeCloseTo(0.3);
    expect(occlusionGain(0.5, 0.3)).toBeCloseTo(0.65);
  });
});

describe("sampleOcclusion", () => {
  it("linea de vista libre: un solo rayo y nada filtrado", () => {
    const raycast = raycastBlocking(0);
    const sample = sampleOcclusion(raycast, listener, source);

    expect(raycast.calls).toBe(1);
    expect(sample).toEqual({ occlusion: 0, obstruction: 0 });
  });

  it("solo el centro bloqueado: obstruye pero no ocluye", () => {
    const raycast = raycastBlocking(1);
    const sample = sampleOcclusion(raycast, listener, source);

    // El sonido rodea el obstaculo: se apaga el directo, la reverb sigue.
    expect(raycast.calls).toBe(3);
    expect(sample.occlusion).toBe(0);
    expect(sample.obstruction).toBeGreaterThan(0);
  });

  it("los tres rayos bloqueados: oclusion total", () => {
    const sample = sampleOcclusion(raycastBlocking(3), listener, source);

    expect(sample.occlusion).toBeCloseTo(1);
    expect(sample.obstruction).toBeCloseTo(1);
  });

  it("fuente encima del oyente: los laterales no degeneran", () => {
    const overhead = new Vector3(0, 6, 0);
    const sample = sampleOcclusion(raycastBlocking(3), listener, overhead);

    expect(sample.occlusion).toBeCloseTo(1);
  });

  it("una fuente pegada al oyente no se sondea", () => {
    const raycast = raycastBlocking(3);
    sampleOcclusion(raycast, listener, listener.clone());

    expect(raycast.calls).toBe(0);
  });

  it("el ajuste declara limites audibles", () => {
    expect(OcclusionTuning.occludedHz).toBeLessThan(
      OcclusionTuning.obstructedHz,
    );
    expect(OcclusionTuning.occludedGain).toBeLessThan(
      OcclusionTuning.obstructedGain,
    );
  });
});

describe("OcclusionScheduler", () => {
  it("respeta el presupuesto por frame", () => {
    const scheduler = new OcclusionScheduler(3);
    expect(scheduler.next(10)).toHaveLength(3);
  });

  it("recorre todas las voces antes de repetir", () => {
    const scheduler = new OcclusionScheduler(2);
    const seen = new Set<number>();

    for (let frame = 0; frame < 3; frame += 1) {
      scheduler.next(6).forEach((index) => seen.add(index));
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("no pide indices fuera de rango cuando bajan las voces", () => {
    const scheduler = new OcclusionScheduler(4);
    scheduler.next(10);
    scheduler.next(10);

    expect(scheduler.next(2).every((index) => index < 2)).toBe(true);
  });

  it("sin voces no programa nada", () => {
    expect(new OcclusionScheduler(4).next(0)).toEqual([]);
  });
});
