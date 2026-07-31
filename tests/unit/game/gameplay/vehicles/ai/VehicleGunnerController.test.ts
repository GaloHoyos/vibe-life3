import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { VehicleMountedWeaponPreset } from '@game/config/vehicles.config';
import type { VehicleGunnerProfile } from '@game/config/vehicleAi.config';
import { VehicleGunnerController } from '@game/gameplay/vehicles/ai/VehicleGunnerController';

const weapon: VehicleMountedWeaponPreset = {
  kind: 'doorGun',
  damage: 12,
  fireRate: 10,
  range: 100,
  heatPerShot: 0.03,
  coolingPerSecond: 0.25,
  yawLimit: 1,
  pitchMin: -0.5,
  pitchMax: 0.5,
  traverseSpeed: 2,
  firingConeRadians: 0.06,
  burstSize: 4,
  burstPauseSeconds: 2,
};

const profile: VehicleGunnerProfile = {
  id: 'trained',
  acquisitionSeconds: 0.5,
  initialSpread: 0.05,
  minSpread: 0.01,
  tightenSeconds: 1,
  angularRateGain: 0.1,
  traverseFactor: 1,
};

/** Determinista: el centro exacto del cono de dispersión. */
const noRandom = (): number => 0;

function directionFromYaw(yaw: number, pitch = 0): Vector3 {
  const horizontal = Math.cos(pitch);
  return new Vector3(
    Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    Math.cos(yaw) * horizontal,
  );
}

function run(
  controller: VehicleGunnerController,
  frames: number,
  input: {
    direction: Vector3 | null;
    visible?: boolean;
    distance?: number;
    ready?: boolean;
  },
  delta = 0.05,
): { shots: number; last: ReturnType<VehicleGunnerController['update']> } {
  let shots = 0;
  let last = controller.update({
    delta,
    targetLocalDirection: input.direction,
    visible: input.visible ?? true,
    distance: input.distance ?? 30,
    ready: input.ready ?? true,
  });
  if (last.fireLocalDirection) shots += 1;
  for (let frame = 1; frame < frames; frame += 1) {
    last = controller.update({
      delta,
      targetLocalDirection: input.direction,
      visible: input.visible ?? true,
      distance: input.distance ?? 30,
      ready: input.ready ?? true,
    });
    if (last.fireLocalDirection) shots += 1;
  }
  return { shots, last };
}

describe('VehicleGunnerController', () => {
  it('no dispara hasta que la torreta alcanza al blanco', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const direction = directionFromYaw(0.9);
    // 0.9 rad a 2 rad/s son 0.45 s de barrido; con 0.5 s de adquisición encima,
    // los primeros frames no pueden tener un solo disparo.
    const early = run(controller, 6, { direction });
    expect(early.shots).toBe(0);
    expect(early.last.onTarget).toBe(false);
    const later = run(controller, 20, { direction });
    expect(later.shots).toBeGreaterThan(0);
    expect(later.last.onTarget).toBe(true);
  });

  it('respeta el tamaño de ráfaga y la pausa', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const direction = directionFromYaw(0);
    // Adquisición (0.5 s) más la ráfaga completa (4 tiros a 0.1 s).
    const burst = run(controller, 20, { direction });
    expect(burst.shots).toBe(weapon.burstSize);
    // `noRandom` deja la pausa en 0.8 × 2 s: 10 frames de 0.05 s no alcanzan.
    expect(run(controller, 10, { direction }).shots).toBe(0);
    expect(run(controller, 40, { direction }).shots).toBeGreaterThan(0);
  });

  it('no dispara sin línea de visión ni fuera de alcance', () => {
    const blind = new VehicleGunnerController(weapon, profile, noRandom);
    expect(run(blind, 60, { direction: directionFromYaw(0), visible: false }).shots)
      .toBe(0);
    const far = new VehicleGunnerController(weapon, profile, noRandom);
    expect(run(far, 60, { direction: directionFromYaw(0), distance: 150 }).shots)
      .toBe(0);
    const unready = new VehicleGunnerController(weapon, profile, noRandom);
    expect(run(unready, 60, { direction: directionFromYaw(0), ready: false }).shots)
      .toBe(0);
  });

  it('un blanco fuera del recorrido de la torreta nunca entra en el cono', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const behind = directionFromYaw(Math.PI - 0.2);
    const result = run(controller, 80, { direction: behind });
    expect(result.shots).toBe(0);
    expect(result.last.atTraverseLimit).toBe(true);
    expect(Math.abs(result.last.yaw)).toBeLessThanOrEqual(weapon.yawLimit + 1e-6);
  });

  it('cierra la puntería con el tiempo en blanco y la reabre al perderlo', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const direction = directionFromYaw(0);
    run(controller, 4, { direction });
    const early = controller.getSpread();
    run(controller, 60, { direction });
    const tracked = controller.getSpread();
    expect(tracked).toBeLessThan(early);
    run(controller, 20, { direction, visible: false });
    expect(controller.getSpread()).toBeGreaterThan(tracked);
  });

  it('el disparo sale de la dirección real del cañón', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const direction = directionFromYaw(0.3);
    const result = run(controller, 40, { direction });
    expect(result.last.fireLocalDirection ?? result.last.onTarget).toBeTruthy();
    const fired = run(controller, 1, { direction });
    if (fired.last.fireLocalDirection) {
      const yaw = Math.atan2(
        fired.last.fireLocalDirection.x,
        fired.last.fireLocalDirection.z,
      );
      expect(yaw).toBeCloseTo(fired.last.yaw, 4);
    }
  });

  it('sin blanco barre en reposo sin disparar', () => {
    const controller = new VehicleGunnerController(weapon, profile, noRandom);
    const result = run(controller, 60, { direction: null });
    expect(result.shots).toBe(0);
    expect(result.last.onTarget).toBe(false);
    expect(Math.abs(result.last.yaw)).toBeLessThanOrEqual(weapon.yawLimit);
  });
});
