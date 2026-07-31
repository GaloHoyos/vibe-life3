import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  PHYSICS_FIXED_TIMESTEP,
  PHYSICS_MAX_SUBSTEPS,
  PhysicsWorld,
} from "@engine/physics/PhysicsWorld";

beforeAll(async () => {
  await RAPIER.init();
});

describe("PhysicsWorld fixed step", () => {
  it("ejecuta hooks pre/post una vez por substep de 60 Hz", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const pre = vi.fn();
    const post = vi.fn();
    physics.addPreStepHook(pre);
    physics.addPostStepHook(post);

    physics.step(1 / 30);

    expect(pre).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(2);
    expect(pre).toHaveBeenNthCalledWith(1, PHYSICS_FIXED_TIMESTEP);
    expect(physics.world.timestep).toBeCloseTo(PHYSICS_FIXED_TIMESTEP, 8);
  });

  it("acumula frames de 144 Hz sin alterar los 60 substeps por segundo", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const pre = vi.fn();
    physics.registerPreStepHook(pre);

    for (let frame = 0; frame < 144; frame += 1) {
      physics.step(1 / 144);
    }

    expect(pre).toHaveBeenCalledTimes(60);
    expect(physics.getInterpolationAlpha()).toBeGreaterThanOrEqual(0);
    expect(physics.getInterpolationAlpha()).toBeLessThan(1);
  });

  it("limita pausas largas al máximo de substeps y permite disponer hooks", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const pre = vi.fn();
    const dispose = physics.addPreStepHook(pre);

    physics.step(1);
    expect(pre).toHaveBeenCalledTimes(PHYSICS_MAX_SUBSTEPS);

    dispose();
    dispose();
    physics.step(1 / 60);
    expect(pre).toHaveBeenCalledTimes(PHYSICS_MAX_SUBSTEPS);
  });
});
