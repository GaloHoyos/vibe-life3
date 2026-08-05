import { describe, expect, it } from 'vitest';
import {
  findAvoidanceSteering,
  findTimeToCollision,
  PidController,
  VehiclePathFollower,
} from '@game/gameplay/vehicles/ai/VehiclePathFollower';
import type { VehicleFollowerInput } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { groundProfile } from './fixtures';

describe('VehiclePathFollower', () => {
  it('pure-pursuit acelera y centra el steering en una recta', () => {
    const follower = new VehiclePathFollower(groundProfile);
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 0,
      path: { points: [{ position: [0, 0, 20], speedLimit: 12 }] },
    });
    expect(command.throttle).toBeGreaterThan(0.5);
    expect(Math.abs(command.steering)).toBeLessThan(0.01);
    expect(command.targetSpeed).toBe(12);
  });

  it('llega rodando al final del camino en vez de clavar los frenos', () => {
    const follower = new VehiclePathFollower(groundProfile, {
      arrivalDeceleration: 3,
    });
    const speeds: number[] = [];
    for (const z of [0, 10, 16, 19, 19.6]) {
      follower.reset();
      speeds.push(
        follower.update({
          delta: 0.1,
          pose: { position: [0, 0, z], heading: 0 },
          speed: 10,
          path: { points: [{ position: [0, 0, 20], speedLimit: 20 }] },
        }).targetSpeed,
      );
    }
    // Lejos manda el límite del tramo; cerca manda la frenada de llegada.
    expect(speeds[0]).toBe(20);
    for (let index = 2; index < speeds.length; index += 1) {
      expect(speeds[index]).toBeLessThan(speeds[index - 1]);
    }
    expect(speeds.at(-1) ?? 99).toBeLessThan(1);
  });

  it('no aplica frenada de llegada en un circuito cerrado', () => {
    const follower = new VehiclePathFollower(groundProfile, {
      arrivalDeceleration: 3,
    });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 19.6], heading: 0 },
      speed: 10,
      path: { loop: true, points: [{ position: [0, 0, 20], speedLimit: 20 }] },
    });
    expect(command.targetSpeed).toBe(20);
  });

  it('respeta el tope de velocidad externo del convoy', () => {
    const follower = new VehiclePathFollower(groundProfile);
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 5,
      speedLimit: 6,
      path: { points: [{ position: [0, 0, 40], speedLimit: 20 }] },
    });
    expect(command.targetSpeed).toBe(6);
  });

  it('anticipa curvas y reduce velocidad por aceleración lateral', () => {
    const follower = new VehiclePathFollower(groundProfile, {
      maximumLateralAcceleration: 2.5,
      baseLookAhead: 2,
    });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 8,
      path: {
        points: [
          { position: [0, 0, 4], speedLimit: 20 },
          { position: [0, 0, 8], speedLimit: 20 },
          { position: [4, 0, 8], speedLimit: 20 },
          { position: [8, 0, 8], speedLimit: 20 },
        ],
      },
    });
    expect(command.targetSpeed).toBeLessThan(20);
  });

  it('trata la velocidad segura de curva como límite duro aunque haya un piso alto', () => {
    const follower = new VehiclePathFollower(groundProfile, {
      maximumLateralAcceleration: 2.5,
      minimumSpeedFactor: 0.8,
      baseLookAhead: 2,
    });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 8,
      path: {
        points: [
          { position: [0, 0, 0], speedLimit: 24 },
          { position: [0, 0, 4], speedLimit: 24 },
          { position: [4, 0, 4], speedLimit: 24 },
        ],
      },
    });

    expect(command.targetSpeed).toBeLessThan(5);
  });

  it('se reengancha por proyección al recibir un path nuevo a mitad de recorrido', () => {
    const follower = new VehiclePathFollower(groundProfile, { baseLookAhead: 1 });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 15], heading: 0 },
      speed: 4,
      path: {
        points: [
          { position: [0, 0, 0], speedLimit: 12 },
          { position: [0, 0, 10], speedLimit: 12 },
          { position: [0, 0, 20], speedLimit: 12 },
        ],
      },
    });

    expect(command.targetPoint?.[2]).toBeGreaterThan(15);
    expect(follower.getProgress()?.distance).toBeCloseTo(15, 1);
  });

  it('no retrocede el progreso al pasar cerca de un tramo ya recorrido', () => {
    const path = {
      points: [
        { position: [0, 0, 0] as const, speedLimit: 12 },
        { position: [0, 0, 10] as const, speedLimit: 12 },
        { position: [0, 0, 20] as const, speedLimit: 12 },
      ],
    };
    const follower = new VehiclePathFollower(groundProfile, { baseLookAhead: 1 });
    follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 18], heading: 0 },
      speed: 3,
      path,
    });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 2], heading: 0 },
      speed: 3,
      path,
    });

    expect(follower.getProgress()?.distance).toBeGreaterThanOrEqual(18);
    expect(command.targetPoint?.[2]).toBeGreaterThanOrEqual(18);
  });

  it('envuelve loops sin reiniciar el progreso acumulado', () => {
    const path = {
      loop: true,
      points: [
        { position: [0, 0, 0] as const, speedLimit: 10 },
        { position: [0, 0, 10] as const, speedLimit: 10 },
        { position: [10, 0, 10] as const, speedLimit: 10 },
        { position: [10, 0, 0] as const, speedLimit: 10 },
      ],
    };
    const follower = new VehiclePathFollower(groundProfile, { baseLookAhead: 1 });
    follower.update({
      delta: 0.1,
      pose: { position: [10, 0, 1], heading: -Math.PI / 2 },
      speed: 3,
      path,
    });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 0.5], heading: 0 },
      speed: 3,
      path,
    });

    expect(follower.getProgress()?.lap).toBe(1);
    expect(follower.getProgress()?.distance).toBeGreaterThan(40);
    expect(command.targetPoint?.[2]).toBeGreaterThan(0.5);
  });

  it('frena antes de una cúspide y cambia de marcha recién después', () => {
    const follower = new VehiclePathFollower(groundProfile, { baseLookAhead: 2 });
    const command = follower.update({
      delta: 0.1,
      pose: { position: [0, 0, 3.5], heading: 0 },
      speed: 2,
      path: {
        points: [
          { position: [0, 0, 0], direction: 'forward' },
          { position: [0, 0, 4], direction: 'forward' },
          { position: [0, 0, 2], direction: 'reverse' },
        ],
      },
    });

    expect(command.reverse).toBe(false);
    expect(command.targetSpeed).toBe(0);
    expect(command.targetPoint?.[2]).toBeCloseTo(4);
  });

  it('frena por TTC y acepta obstáculos de shape cast', () => {
    const input: VehicleFollowerInput = {
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 12,
      path: { points: [{ position: [0, 0, 40], speedLimit: 20 }] },
      obstacles: [{
        id: 'stopped',
        position: [0, 0, 6],
        velocity: [0, 0, 0],
        radius: 1,
      }],
      shapeCasts: [{ distance: 4, closingSpeed: 12, lateralOffset: 0 }],
    };
    expect(findTimeToCollision(input, groundProfile)).toBeLessThan(0.3);
    const command = new VehiclePathFollower(groundProfile).update(input);
    expect(command.brake).toBe(1);
    expect(command.throttle).toBe(0);
    expect(command.handbrake).toBe(true);
  });

  it('invierte dirección sin perder el objetivo de steering', () => {
    const command = new VehiclePathFollower(groundProfile).update({
      delta: 0.1,
      pose: { position: [0, 0, 5], heading: 0 },
      speed: 0,
      path: {
        points: [{ position: [-2, 0, 0], speedLimit: 4, direction: 'reverse' }],
      },
    });
    expect(command.reverse).toBe(true);
    expect(command.throttle).toBeGreaterThan(0);
    expect(Math.abs(command.steering)).toBeGreaterThan(0.05);
  });

  it('esquiva al lado contrario de un obstáculo lateral', () => {
    const base: VehicleFollowerInput = {
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 8,
      path: { points: [{ position: [0, 0, 40], speedLimit: 14 }] },
    };
    const left = findAvoidanceSteering({
      ...base,
      obstacles: [{
        id: 'left',
        position: [0.8, 0, 7],
        velocity: [0, 0, 0],
        radius: 0.5,
      }],
    }, groundProfile);
    const right = findAvoidanceSteering({
      ...base,
      obstacles: [{
        id: 'right',
        position: [-0.8, 0, 7],
        velocity: [0, 0, 0],
        radius: 0.5,
      }],
    }, groundProfile);
    expect(left.steering).toBeGreaterThan(0);
    expect(right.steering).toBeLessThan(0);
  });

  it('no esquiva objetivos marcados como embestibles', () => {
    const command = new VehiclePathFollower(groundProfile).update({
      delta: 0.1,
      pose: { position: [0, 0, 0], heading: 0 },
      speed: 8,
      path: { points: [{ position: [0, 0, 40], speedLimit: 14 }] },
      obstacles: [{
        id: 'hostile',
        position: [0.7, 0, 6],
        velocity: [0, 0, 0],
        radius: 0.5,
        blocking: false,
      }],
    });
    expect(Math.abs(command.steering)).toBeLessThan(0.01);
  });
});

describe('PidController', () => {
  it('limita integral y se puede resetear', () => {
    const pid = new PidController(0, 1, 0, 2);
    for (let index = 0; index < 100; index += 1) pid.update(10, 0.1);
    expect(pid.update(10, 0.1)).toBe(2);
    pid.reset();
    expect(pid.update(-1, 1)).toBe(-1);
  });
});
