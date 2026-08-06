import { describe, expect, it } from 'vitest';
import { VehicleProgressMonitor } from '@game/gameplay/vehicles/ai/VehicleProgressMonitor';

describe('VehicleProgressMonitor', () => {
  it('declara atasco tras dos segundos sin avance planar', () => {
    const monitor = new VehicleProgressMonitor();
    let snapshot = monitor.update(0, 0, {
      position: [0, 0, 0],
      goalDistance: 20,
      wantsMove: true,
    });
    for (let step = 1; step <= 24; step += 1) {
      snapshot = monitor.update(0.1, step * 0.1, {
        position: [0, Math.sin(step) * 0.5, 0],
        goalDistance: 20,
        wantsMove: true,
      });
    }
    expect(snapshot.stuck).toBe(true);
    expect(snapshot.displacement).toBe(0);
  });

  it('acepta avance hacia el objetivo aunque el desplazamiento neto sea pequeno', () => {
    const monitor = new VehicleProgressMonitor();
    let snapshot = monitor.update(0, 0, {
      position: [0, 0, 0],
      goalDistance: 20,
      wantsMove: true,
    });
    for (let step = 1; step <= 24; step += 1) {
      snapshot = monitor.update(0.1, step * 0.1, {
        position: [0, 0, step * 0.08],
        goalDistance: 20 - step * 0.08,
        wantsMove: true,
      });
    }
    expect(snapshot.stuck).toBe(false);
    expect(snapshot.goalProgress).toBeGreaterThan(1);
  });

  it('reinicia la ventana durante una espera tactica', () => {
    const monitor = new VehicleProgressMonitor();
    monitor.update(0.1, 0, {
      position: [0, 0, 0],
      goalDistance: 10,
      wantsMove: true,
    });
    expect(monitor.update(0.1, 1, {
      position: [0, 0, 0],
      goalDistance: 10,
      wantsMove: false,
    }).stalledSeconds).toBe(0);
  });

  it('mide avance sobre la ruta y no confunde movimiento lateral con progreso', () => {
    const monitor = new VehicleProgressMonitor();
    let snapshot = monitor.update(0, 0, {
      position: [0, 0, 0],
      goalDistance: 20,
      routeProgress: 5,
      wantsMove: true,
    });
    for (let step = 1; step <= 24; step += 1) {
      snapshot = monitor.update(0.1, step * 0.1, {
        position: [step * 0.12, 0, 0],
        goalDistance: 20,
        routeProgress: 5,
        wantsMove: true,
      });
    }
    expect(snapshot.displacement).toBeGreaterThan(1.25);
    expect(snapshot.routeProgress).toBe(0);
    expect(snapshot.stuck).toBe(true);
  });
});
