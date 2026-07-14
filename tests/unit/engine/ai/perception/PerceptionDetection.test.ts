import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { PerceptionSystem } from "@engine/ai/perception/PerceptionSystem";
import type { PerceptionConfig, PerceptionTarget } from "@engine/ai/perception/PerceptionSystem";
import type { RaycastSource } from "@engine/physics/Raycast";

const clearLos: RaycastSource = { cast: () => null };
const blockedLos: RaycastSource = {
  cast: () =>
    ({ metadata: { id: "wall" } }) as unknown as ReturnType<RaycastSource["cast"]>,
};

const baseConfig: PerceptionConfig = {
  visionRange: 32,
  visionConeRadians: Math.PI,
  hearingRadius: 0,
  memoryTime: 8,
  eyeHeight: 0.62,
};

const detection = {
  baseTime: 1.0,
  instantRange: 7,
  suspicionThreshold: 0.35,
  decayRate: 0.6,
  alertMultiplier: 3,
};

function makeTarget(x: number): PerceptionTarget {
  return { id: "player", position: new Vector3(x, 0, 0), isAlive: true };
}

const self = new Vector3(0, 0, 0);
const facing = new Vector3(1, 0, 0);

describe("PerceptionSystem detection accumulator", () => {
  it("sin config de detection la vision es instantanea (legacy)", () => {
    const perception = new PerceptionSystem(baseConfig);
    const snap = perception.update(self, facing, makeTarget(20), 1 / 60, clearLos);
    expect(snap.visibleNow).toBe(true);
    expect(snap.awareness).toBe(1);
    expect(snap.suspicious).toBe(false);
  });

  it("a distancia acumula: sospecha primero, deteccion plena despues", () => {
    const perception = new PerceptionSystem({ ...baseConfig, detection });
    const target = makeTarget(19.5); // frac (19.5-7)/25 = 0.5 → t = 0.5 s
    const first = perception.update(self, facing, target, 1 / 60, clearLos);
    expect(first.visibleNow).toBe(false);

    let snap = first;
    let suspiciousSeen = false;
    for (let i = 0; i < 60; i += 1) {
      snap = perception.update(self, facing, target, 1 / 60, clearLos);
      if (snap.suspicious) suspiciousSeen = true;
      if (snap.visibleNow) break;
    }
    expect(suspiciousSeen).toBe(true);
    expect(snap.visibleNow).toBe(true);
    expect(snap.lastKnownPosition).not.toBeNull();
  });

  it("expone la posicion sospechada mientras acumula", () => {
    const perception = new PerceptionSystem({ ...baseConfig, detection });
    const target = makeTarget(19.5);
    let snap = perception.update(self, facing, target, 0.2, clearLos);
    expect(snap.suspicious).toBe(true);
    expect(snap.suspectedPosition?.x).toBeCloseTo(19.5, 5);
    expect(snap.visibleNow).toBe(false);
    // La sospecha no genera memoria de threat (eso es solo deteccion plena).
    expect(snap.hasMemory).toBe(false);
    snap = perception.update(self, facing, target, 0.5, clearLos);
    expect(snap.visibleNow).toBe(true);
    expect(snap.suspicious).toBe(false);
  });

  it("a quemarropa detecta en el primer frame", () => {
    const perception = new PerceptionSystem({ ...baseConfig, detection });
    const snap = perception.update(self, facing, makeTarget(5), 1 / 60, clearLos);
    expect(snap.visibleNow).toBe(true);
  });

  it("decae sin LOS y la sospecha se apaga", () => {
    const perception = new PerceptionSystem({ ...baseConfig, detection });
    const target = makeTarget(19.5);
    perception.update(self, facing, target, 0.25, clearLos);
    let snap = perception.update(self, facing, target, 1 / 60, blockedLos);
    expect(snap.visibleNow).toBe(false);
    // awareness ~0.5 decae a 0.6/s → bajo el umbral 0.35 en ~0.3 s.
    snap = perception.update(self, facing, target, 0.5, blockedLos);
    expect(snap.suspicious).toBe(false);
    expect(snap.awareness).toBeLessThan(detection.suspicionThreshold);
  });

  it("en alerta acumula alertMultiplier veces mas rapido", () => {
    const relaxed = new PerceptionSystem({ ...baseConfig, detection });
    const alerted = new PerceptionSystem({ ...baseConfig, detection });
    alerted.setAlert(true);
    const target = makeTarget(19.5);
    const snapRelaxed = relaxed.update(self, facing, target, 0.1, clearLos);
    const snapAlerted = alerted.update(self, facing, target, 0.1, clearLos);
    expect(snapAlerted.awareness).toBeCloseTo(snapRelaxed.awareness * detection.alertMultiplier, 5);
  });

  it("reset limpia el acumulador ademas de la memoria", () => {
    const perception = new PerceptionSystem({ ...baseConfig, detection });
    const target = makeTarget(19.5);
    perception.update(self, facing, target, 0.3, clearLos);
    perception.reset();
    const snap = perception.update(self, facing, target, 1 / 60, clearLos);
    expect(snap.awareness).toBeLessThan(0.1);
    expect(snap.visibleNow).toBe(false);
  });
});
