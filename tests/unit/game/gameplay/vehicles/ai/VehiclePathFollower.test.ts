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
