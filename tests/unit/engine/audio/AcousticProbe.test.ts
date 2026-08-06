import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  AcousticProbe,
  ProbeTuning,
} from "@engine/audio/spatial/AcousticProbe";
import { reverbSpaceFor } from "@engine/audio/spatial/AcousticResponse";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import type { SurfaceType } from "@shared/types/Surface";

const absorption: Partial<Record<SurfaceType, number>> = {
  concrete: 0.12,
  metal: 0.05,
  grass: 0.65,
};

/** Caja centrada en el origen: el rayo choca a `half` en cada eje. */
function boxRaycast(half: number, surface: SurfaceType): RaycastSource {
  return {
    cast(
      _origin: Vector3,
      direction: Vector3,
      maxDistance: number,
    ): RaycastHit | null {
      // Distancia del centro a la cara de la caja en esa direccion.
      const scale = Math.max(
        Math.abs(direction.x),
        Math.abs(direction.y),
        Math.abs(direction.z),
      );
      const distance = half / scale;
      if (distance > maxDistance) {
        return null;
      }
      return {
        point: new Vector3(),
        toi: distance,
        metadata: { id: "muro", kind: "static", surface } as PhysicsMetadata,
      } as RaycastHit;
    },
  };
}

/** Cielo abierto: ningun rayo toca nada. */
const openRaycast: RaycastSource = { cast: () => null };

const listener = new Vector3();

describe("AcousticProbe", () => {
  it("mide el volumen de una caja por sus pares de ejes opuestos", () => {
    const probe = new AcousticProbe(absorption);
    // Caja de 5 m de semilado: 10 x 10 x 10 = 1000 m³.
    const estimate = probe.sample(boxRaycast(5, "concrete"), listener);

    expect(estimate.volume).toBeCloseTo(1000, 0);
    expect(estimate.openness).toBe(0);
    expect(estimate.absorption).toBeCloseTo(0.12, 2);
  });

  it("a cielo abierto reporta apertura total y absorcion maxima", () => {
    const probe = new AcousticProbe(absorption);
    const estimate = probe.sample(openRaycast, listener);

    expect(estimate.openness).toBe(1);
    expect(estimate.absorption).toBe(ProbeTuning.openAbsorption);
    expect(estimate.meanDistance).toBe(ProbeTuning.maxDistance);
  });

  it("distingue materiales reflectantes de absorbentes", () => {
    const probe = new AcousticProbe(absorption);
    const metal = probe.sample(boxRaycast(4, "metal"), listener);
    const grass = probe.sample(boxRaycast(4, "grass"), listener);

    expect(metal.absorption).toBeLessThan(grass.absorption);
  });

  it("no sondea antes del intervalo", () => {
    const probe = new AcousticProbe(absorption);
    const raycast = boxRaycast(5, "concrete");

    expect(probe.update(0.001, raycast, listener)).not.toBeNull();
    const second = probe.update(0.001, raycast, listener);
    expect(second?.volume).toBeCloseTo(1000, 0);
  });

  it("suaviza la transicion entre espacios en vez de saltar", () => {
    const probe = new AcousticProbe(absorption);
    const small = boxRaycast(3, "concrete");
    const large = boxRaycast(18, "concrete");

    probe.update(1, small, listener);
    const before = probe.update(1, small, listener);
    // Cruza a un espacio mucho mas grande de golpe.
    const after = probe.update(ProbeTuning.intervalSeconds, large, listener);

    expect(before?.volume).toBeCloseTo(216, 0);
    expect(after?.volume).toBeGreaterThan(before?.volume ?? 0);
    // Todavia lejos del destino: sin suavizado la reverb pegaria un salto.
    expect(after?.volume).toBeLessThan(46_656 * 0.5);
  });

  it("sin raycast devuelve lo ultimo medido", () => {
    const probe = new AcousticProbe(absorption);
    probe.update(1, boxRaycast(5, "concrete"), listener);

    expect(probe.update(1, null, listener)?.volume).toBeCloseTo(1000, 0);
  });

  it("reset olvida el espacio anterior", () => {
    const probe = new AcousticProbe(absorption);
    probe.update(1, boxRaycast(5, "concrete"), listener);
    probe.reset();

    expect(probe.update(0, null, listener)).toBeNull();
  });
});

describe("reverbSpaceFor", () => {
  const tuning = {
    minVolume: 30,
    maxVolume: 60_000,
    minDuration: 0.35,
    maxDuration: 2.8,
    minWet: 0.1,
    maxWet: 0.42,
    absorbentToneHz: 4_200,
    reflectiveToneHz: 9_500,
    maxEchoFeedback: 0.42,
    maxEchoWet: 0.16,
  };

  it("una sala mas grande alarga la cola y sube el wet", () => {
    const small = reverbSpaceFor(
      { volume: 40, absorption: 0.12, openness: 0, meanDistance: 2, longestExtent: 2 },
      tuning,
    );
    const hall = reverbSpaceFor(
      { volume: 40_000, absorption: 0.12, openness: 0, meanDistance: 18, longestExtent: 18 },
      tuning,
    );

    expect(hall.duration).toBeGreaterThan(small.duration);
    expect(hall.wet).toBeGreaterThan(small.wet);
    // Cola mas larga = exponente de caida mas bajo.
    expect(hall.decay).toBeLessThan(small.decay);
  });

  it("una explanada no suena como una nave del mismo volumen medido", () => {
    // A la intemperie los rayos que escapan reportan su alcance maximo, asi que
    // el volumen medido es enorme; lo que la diferencia de una nave cerrada es
    // que la energia se va en vez de rebotar.
    const measured = { volume: 60_000, absorption: 0.69, meanDistance: 30, longestExtent: 40 };
    const plain = reverbSpaceFor({ ...measured, openness: 0.64 }, tuning);
    const hall = reverbSpaceFor({ ...measured, openness: 0 }, tuning);

    expect(plain.duration).toBeLessThan(hall.duration * 0.6);
    expect(plain.wet).toBeLessThan(hall.wet);
    expect(plain.echoFeedback).toBeLessThan(hall.echoFeedback);
  });

  it("a cielo abierto la reverb se apaga", () => {
    const outdoor = reverbSpaceFor(
      { volume: 500_000, absorption: 1, openness: 1, meanDistance: 40, longestExtent: 40 },
      tuning,
    );

    expect(outdoor.wet).toBe(0);
    expect(outdoor.echoFeedback).toBe(0);
  });

  it("el material reflectante abre el tono del retorno", () => {
    const metal = reverbSpaceFor(
      { volume: 2_000, absorption: 0.05, openness: 0, meanDistance: 6, longestExtent: 6 },
      tuning,
    );
    const grass = reverbSpaceFor(
      { volume: 2_000, absorption: 0.65, openness: 0, meanDistance: 6, longestExtent: 6 },
      tuning,
    );

    expect(metal.toneHz).toBeGreaterThan(grass.toneHz);
    expect(metal.wet).toBeGreaterThan(grass.wet);
  });

  it("un tunel repica mas lento que un cuarto del mismo volumen", () => {
    const base = { volume: 320, absorption: 0.06, openness: 0 };
    // Mismo volumen: 34x3.2x3 (tunel) contra ~6.8x6.8x6.8 (cuarto).
    const tunnel = reverbSpaceFor(
      { ...base, meanDistance: 4, longestExtent: 34 },
      tuning,
    );
    const room = reverbSpaceFor(
      { ...base, meanDistance: 4, longestExtent: 6.8 },
      tuning,
    );

    // El golpeteo rebota entre las superficies mas lejanas: en el tunel el
    // periodo es largo y se oye como slap; en el cuarto se funde con la cola.
    expect(tunnel.echoDelay).toBeGreaterThan(room.echoDelay * 4);
    expect(tunnel.duration).toBeCloseTo(room.duration);
  });

  it("satura fuera del rango en vez de extrapolar", () => {
    const huge = reverbSpaceFor(
      { volume: 10_000_000, absorption: 0, openness: 0, meanDistance: 40, longestExtent: 40 },
      tuning,
    );
    const tiny = reverbSpaceFor(
      { volume: 1, absorption: 0, openness: 0, meanDistance: 1, longestExtent: 1 },
      tuning,
    );

    expect(huge.duration).toBeCloseTo(tuning.maxDuration);
    expect(tiny.duration).toBeCloseTo(tuning.minDuration);
    expect(huge.preDelay).toBeLessThanOrEqual(0.06);
  });
});
