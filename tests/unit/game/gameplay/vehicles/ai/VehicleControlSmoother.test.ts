import { describe, expect, it } from 'vitest';
import type { VehicleControlCommand } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import {
  VehicleControlSmoother,
  type VehicleControlSmootherTuning,
} from '@game/gameplay/vehicles/ai/VehicleControlSmoother';

const tuning: VehicleControlSmootherTuning = {
  steeringRate: 2,
  throttleRate: 2,
  brakeRate: 4,
  reactionSeconds: 0.3,
};

function command(
  overrides: Partial<VehicleControlCommand> = {},
): VehicleControlCommand {
  return {
    throttle: 1,
    brake: 0,
    steering: 0,
    reverse: false,
    handbrake: false,
    targetSpeed: 10,
    targetPoint: [0, 0, 10],
    timeToCollision: null,
    ...overrides,
  };
}

describe('VehicleControlSmoother', () => {
  it('limita la velocidad del volante en vez de saltar al valor pedido', () => {
    const smoother = new VehicleControlSmoother(tuning);
    const first = smoother.update(0.1, command({ steering: 1 }));
    expect(first.steering).toBeCloseTo(0.2, 5);
    const second = smoother.update(0.1, command({ steering: 1 }));
    expect(second.steering).toBeCloseTo(0.4, 5);
    for (let frame = 0; frame < 10; frame += 1) {
      smoother.update(0.1, command({ steering: 1 }));
    }
    expect(smoother.update(0.1, command({ steering: 1 })).steering).toBe(1);
  });

  it('nunca manda acelerador y freno a la vez', () => {
    const smoother = new VehicleControlSmoother(tuning);
    for (let frame = 0; frame < 20; frame += 1) {
      smoother.update(0.1, command({ throttle: 1 }));
    }
    for (let frame = 0; frame < 20; frame += 1) {
      const output = smoother.update(0.1, command({ throttle: 0.8, brake: 1 }));
      expect(output.throttle === 0 || output.brake === 0).toBe(true);
    }
  });

  it('demora la frenada el tiempo de reacción del conductor', () => {
    const smoother = new VehicleControlSmoother(tuning);
    for (let frame = 0; frame < 20; frame += 1) {
      smoother.update(0.1, command({ throttle: 1 }));
    }
    const hazard = command({ throttle: 0, brake: 1, timeToCollision: 0.5 });
    // Mientras corren los 0.3 s de reacción el conductor sigue acelerando.
    for (let frame = 0; frame < 2; frame += 1) {
      const output = smoother.update(0.1, hazard);
      expect(output.brake).toBe(0);
      expect(output.throttle).toBeGreaterThan(0.9);
    }
    const reacting = smoother.update(0.1, hazard);
    expect(reacting.brake).toBeGreaterThan(0);
  });

  it('no demora la corrección del volante mientras espera para frenar', () => {
    const smoother = new VehicleControlSmoother(tuning);
    smoother.update(0.1, command({ throttle: 1 }));
    const output = smoother.update(
      0.1,
      command({ steering: 1, brake: 1, timeToCollision: 0.4 }),
    );
    expect(output.steering).toBeGreaterThan(0);
    expect(output.brake).toBe(0);
  });

  it('para el vehículo antes de invertir la marcha', () => {
    const smoother = new VehicleControlSmoother(tuning);
    for (let frame = 0; frame < 20; frame += 1) {
      smoother.update(0.1, command({ throttle: 1 }));
    }
    const reversing = command({ throttle: 1, reverse: true });
    const immediate = smoother.update(0.05, reversing);
    expect(immediate.reverse).toBe(false);
    expect(immediate.throttle).toBeLessThan(1);
    for (let frame = 0; frame < 20; frame += 1) {
      smoother.update(0.05, reversing);
    }
    expect(smoother.update(0.05, reversing).reverse).toBe(true);
  });

  it('los overrides de recovery pasan sin suavizar', () => {
    const smoother = new VehicleControlSmoother(tuning);
    const output = smoother.update(
      0.05,
      command({ throttle: 0.72, steering: -0.65, reverse: true }),
      { immediate: true },
    );
    expect(output.steering).toBeCloseTo(-0.65, 5);
    expect(output.reverse).toBe(true);
  });
});
