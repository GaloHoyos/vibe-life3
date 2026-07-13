import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  BLOB_BASE_ROLE_COUNTS,
  BLOB_FIXED_STEP_SECONDS,
  BLOB_INITIAL_PARTICLE_COUNT,
  BLOB_MAX_PARTICLE_COUNT,
  BlobOrganismRuntime,
  BlobParticleRole,
} from "@engine/blob/BlobOrganismRuntime";

function advance(runtime: BlobOrganismRuntime, seconds: number): void {
  const steps = Math.ceil(seconds / BLOB_FIXED_STEP_SECONDS);
  for (let index = 0; index < steps; index++) runtime.step(BLOB_FIXED_STEP_SECONDS);
}

describe("BlobOrganismRuntime allocation and roles", () => {
  it("preallocates 250 particles and activates the canonical 192-role organism", () => {
    const runtime = new BlobOrganismRuntime({ seed: 7 });

    expect(runtime.maxParticleCount).toBe(BLOB_MAX_PARTICLE_COUNT);
    expect(runtime.particles).toHaveLength(BLOB_MAX_PARTICLE_COUNT);
    expect(runtime.particleCount).toBe(BLOB_INITIAL_PARTICLE_COUNT);
    expect(runtime.roleCounts()).toEqual(BLOB_BASE_ROLE_COUNTS);
    expect(runtime.particles[0].role).toBe(BlobParticleRole.Brain);
    expect(runtime.particles.filter((particle) => particle.active)).toHaveLength(192);
    expect(runtime.constraints.length).toBeGreaterThan(BLOB_MAX_PARTICLE_COUNT - 1);
    expect(runtime.constraints.some((constraint) => constraint.kind === "tendon")).toBe(true);
  });

  it("grows only flesh particles and clamps biomass to the preallocated cap", () => {
    const runtime = new BlobOrganismRuntime();

    expect(runtime.grow(12)).toBe(12);
    expect(runtime.particleCount).toBe(204);
    expect(runtime.roleCounts()[BlobParticleRole.Flesh]).toBe(123);
    expect(runtime.grow(999)).toBe(46);
    expect(runtime.grow(1)).toBe(0);
    expect(runtime.particleCount).toBe(250);
    expect(runtime.constraints.every((constraint) => constraint.active)).toBe(true);
  });

  it("spawns as a broad grounded mound instead of a tall sphere", () => {
    const runtime = new BlobOrganismRuntime({
      center: new Vector3(0, 1, 0),
      bodyRadius: 1.6,
      particleRadius: 0.28,
      seed: 17,
    });
    const offsets = runtime.activeParticles.map((particle) =>
      particle.position.clone().sub(runtime.center),
    );
    const horizontalDiameter = Math.max(
      ...offsets.map((offset) => Math.hypot(offset.x, offset.z)),
    ) * 2;
    const verticalSpan =
      Math.max(...offsets.map((offset) => offset.y)) -
      Math.min(...offsets.map((offset) => offset.y));
    const supports = runtime.activeParticles.filter(
      (particle) => particle.role === BlobParticleRole.Support,
    );

    expect(horizontalDiameter).toBeGreaterThan(2.7);
    expect(verticalSpan).toBeLessThan(1.4);
    expect(Math.max(...supports.map((particle) => particle.position.y))).toBeLessThan(0.39);
    expect(Math.min(...supports.map((particle) => particle.position.y - particle.radius))).toBeGreaterThan(0.05);
  });
});

describe("BlobOrganismRuntime fixed step", () => {
  it("runs at 30 Hz, interpolates, and caps frame recovery at two steps", () => {
    const runtime = new BlobOrganismRuntime();
    const half = runtime.step(1 / 60, { desiredVelocity: new Vector3(3, 0, 0) });
    expect(half.steps).toBe(0);
    expect(half.alpha).toBeCloseTo(0.5);

    const full = runtime.step(1 / 60, { desiredVelocity: new Vector3(3, 0, 0) });
    expect(full.steps).toBe(1);
    expect(runtime.totalFixedSteps).toBe(1);
    expect(runtime.particles[0].renderPosition.x).toBeCloseTo(
      runtime.particles[0].previousPosition.x,
    );

    const hitch = runtime.step(1, { desiredVelocity: new Vector3(3, 0, 0) });
    expect(hitch.steps).toBe(2);
    expect(hitch.droppedTime).toBeGreaterThan(0.8);
    expect(runtime.totalFixedSteps).toBe(3);
  });

  it("is deterministic for equal seeds and inputs", () => {
    const a = new BlobOrganismRuntime({ seed: 123 });
    const b = new BlobOrganismRuntime({ seed: 123 });
    const desiredVelocity = new Vector3(1.5, 0.1, -0.75);
    for (let index = 0; index < 90; index++) {
      a.step(BLOB_FIXED_STEP_SECONDS, { desiredVelocity });
      b.step(BLOB_FIXED_STEP_SECONDS, { desiredVelocity });
    }

    for (let index = 0; index < a.particleCount; index++) {
      expect(a.particles[index].position.distanceToSquared(b.particles[index].position)).toBe(0);
      expect(a.particles[index].velocity.distanceToSquared(b.particles[index].velocity)).toBe(0);
    }
  });

  it("uses local spatial candidates rather than testing every pair", () => {
    const runtime = new BlobOrganismRuntime({ seed: 99 });
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    const allPairs = (runtime.particleCount * (runtime.particleCount - 1)) / 2;
    expect(runtime.lastSeparationCandidateChecks).toBeGreaterThan(0);
    expect(runtime.lastSeparationCandidateChecks).toBeLessThan(allPairs * 0.5);
  });

  it("routes the combined fixed-step displacement through the physics resolver", () => {
    let sweeps = 0;
    let attemptedMovement = false;
    const runtime = new BlobOrganismRuntime({
      motionResolver: (_particle, from, desired) => {
        sweeps++;
        attemptedMovement ||= desired.distanceToSquared(from) > 0;
        return from;
      },
    });
    const before = runtime.center.clone();
    runtime.step(BLOB_FIXED_STEP_SECONDS, { desiredVelocity: new Vector3(4, 0, 0) });

    expect(sweeps).toBe(runtime.particleCount);
    expect(attemptedMovement).toBe(true);
    expect(runtime.center.distanceToSquared(before)).toBe(0);
  });

  it("translates intact as one organism instead of leaving a flesh trail", () => {
    const runtime = new BlobOrganismRuntime({ seed: 41 });
    advance(runtime, 1);
    const relative = runtime.activeParticles.map((particle) =>
      particle.position.clone().sub(runtime.center),
    );

    for (let index = 0; index < 60; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, {
        desiredVelocity: new Vector3(2.5, 0, -1),
      });
    }

    const maximumDrift = Math.max(
      ...runtime.activeParticles.map((particle, index) =>
        particle.position
          .clone()
          .sub(runtime.center)
          .distanceTo(relative[index]),
      ),
    );
    expect(maximumDrift).toBeLessThan(0.35);
  });
});

describe("BlobOrganismRuntime damage openings and components", () => {
  it("conserves a bullet impulse across its local kernel without tearing globally", () => {
    const runtime = new BlobOrganismRuntime({ seed: 31 });
    const point = runtime.particles[100].position.clone();
    const impulse = new Vector3(0, 0.5, 3);
    const before = runtime.activeParticles.reduce(
      (sum, particle) => sum.add(particle.velocity),
      new Vector3(),
    );

    expect(runtime.applyImpulseAt(point, impulse, 0.7)).toBeGreaterThan(1);
    const after = runtime.activeParticles.reduce(
      (sum, particle) => sum.add(particle.velocity),
      new Vector3(),
    );
    const transferred = after.sub(before);
    const broken = runtime.constraints.filter((constraint) => constraint.connection < 1);

    expect(transferred.length()).toBeLessThanOrEqual(impulse.length() * 1.001);
    expect(transferred.dot(impulse.clone().normalize())).toBeGreaterThan(impulse.length() * 0.7);
    expect(broken).toHaveLength(0);
    expect(runtime.exposure).toBeLessThan(0.1);
  });

  it("turns an impulse and severed tendons into measurable brain exposure", () => {
    const runtime = new BlobOrganismRuntime();
    expect(runtime.exposure).toBeLessThan(0.05);

    expect(runtime.applyImpulse(80, new Vector3(0, 18, 0))).toBe(true);
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    expect(runtime.exposure).toBeGreaterThan(0.35);
    expect(
      runtime.constraints.some(
        (constraint) => constraint.brokenUntil > 0 && constraint.particleB === 80,
      ),
    ).toBe(true);
  });

  it.each([2, 3, 4, 5, 6])("splits into %i shared components and keeps the brain in main", (count) => {
    const runtime = new BlobOrganismRuntime();
    expect(runtime.split(count)).toBe(count);
    expect(runtime.componentCount).toBe(count);
    expect(runtime.particles[0].componentId).toBe(0);
    expect(runtime.components[0].particleIndices).toContain(0);
    expect(runtime.components.slice(0, count).every((component) => component.active)).toBe(true);
    expect(runtime.constraints.some((constraint) => constraint.connection === 0)).toBe(true);
  });

  it("splits spatially and gives every splat one coherent launch velocity", () => {
    const runtime = new BlobOrganismRuntime({ seed: 19 });
    runtime.split(4, 2);

    for (const component of runtime.components.slice(1, 4)) {
      expect(component.active).toBe(true);
      const firstVelocity = runtime.particles[component.particleIndices[0]].velocity;
      expect(firstVelocity.length()).toBeCloseTo(2);
      for (const particleIndex of component.particleIndices) {
        expect(runtime.particles[particleIndex].velocity.distanceTo(firstVelocity)).toBeLessThan(1e-8);
      }
    }
  });

  it("keeps the launch coherent long enough to separate, then auto-merges splats", () => {
    const runtime = new BlobOrganismRuntime({ seed: 27 });
    runtime.split(3, 2);
    advance(runtime, 1);

    const separation = Math.max(
      ...runtime.components
        .filter((component) => component.active)
        .map((component) => component.center.distanceTo(runtime.center)),
    );
    expect(separation).toBeGreaterThan(1.5);
    expect(runtime.componentCount).toBe(3);

    advance(runtime, 3);
    expect(runtime.isMerging || runtime.componentCount === 1).toBe(true);
  });

  it("rejects invalid split counts and reconnects tendons gradually on merge", () => {
    const runtime = new BlobOrganismRuntime();
    expect(() => runtime.split(1)).toThrow(RangeError);
    expect(() => runtime.split(7)).toThrow(RangeError);

    runtime.split(3);
    expect(runtime.merge()).toBe(true);
    expect(runtime.componentCount).toBe(3);
    expect(runtime.isMerging).toBe(true);
    expect(runtime.mergeProgress).toBe(0);
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    expect(runtime.componentCount).toBeGreaterThan(1);
    for (let index = 0; index < 240 && runtime.isMerging; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS);
      expect(Math.max(...runtime.activeParticles.map((particle) => particle.velocity.length()))).toBeLessThanOrEqual(10.000001);
    }
    expect(runtime.componentCount).toBe(1);
    expect(runtime.isMerging).toBe(false);
    expect(runtime.mergeProgress).toBe(1);
    expect(runtime.drainEvents().some((event) => event.type === "merged")).toBe(true);
  });

  it("reconnects an impact-severed constraint gradually after its break window", () => {
    const runtime = new BlobOrganismRuntime();
    const incident = runtime.constraints.find((constraint) => constraint.particleB === 80);
    expect(incident).toBeDefined();

    runtime.applyImpulse(80, new Vector3(), 0.1);
    expect(incident?.connection).toBe(0);
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    expect(incident?.connection).toBe(0);
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    expect(incident?.connection).toBeGreaterThan(0);
    expect(incident?.connection).toBeLessThan(1);
    expect(runtime.simulationTimeSeconds).toBeCloseTo(0.1);
  });

  it("keeps velocities finite and bounded through split and physical recomposition", () => {
    const runtime = new BlobOrganismRuntime({
      seed: 33,
      motionResolver: (_particle, from, desired) => ({
        position: desired,
        velocity: desired.clone().sub(from).multiplyScalar(1 / BLOB_FIXED_STEP_SECONDS),
      }),
    });
    runtime.split(6, 8);
    advance(runtime, 0.75);
    runtime.merge();
    for (let index = 0; index < 360 && runtime.isMerging; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS);
      for (const particle of runtime.activeParticles) {
        expect(Number.isFinite(particle.position.lengthSq())).toBe(true);
        expect(Number.isFinite(particle.velocity.lengthSq())).toBe(true);
        expect(particle.velocity.length()).toBeLessThanOrEqual(10.000001);
      }
    }
    expect(runtime.componentCount).toBe(1);
    expect(runtime.isMerging).toBe(false);
  }, 10_000);
});

describe("BlobOrganismRuntime poses and teleport", () => {
  it("builds a held geometric pose, cancels it cleanly, and resets locomotion", () => {
    const runtime = new BlobOrganismRuntime();
    runtime.setPose({ kind: "column", height: 4, radius: 0.5, duration: 0.1 });
    expect(runtime.isLocomotionPaused).toBe(true);
    advance(runtime, 0.12);

    const ys = runtime.activeParticles.map((particle) => particle.position.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3.5);
    expect(runtime.currentPose?.kind).toBe("column");
    expect(runtime.drainEvents().some((event) => event.type === "poseReached")).toBe(true);

    runtime.setPose({ kind: "wall", width: 5, height: 3, duration: 0.8 });
    runtime.setPose({ kind: "sphere", radius: 1, duration: 0.1 });
    advance(runtime, 0.12);
    expect(runtime.currentPose?.kind).toBe("sphere");
    runtime.resetPose(0.1);
    advance(runtime, 0.12);
    expect(runtime.currentPose).toBeNull();
    expect(runtime.isLocomotionPaused).toBe(false);
  });

  it("atomically transforms current, previous, interpolated and velocity state", () => {
    const runtime = new BlobOrganismRuntime({ center: new Vector3(2, 1, -3), seed: 5 });
    runtime.step(BLOB_FIXED_STEP_SECONDS, { desiredVelocity: new Vector3(1, 0, 0) });
    const relative = runtime.particles[20].position.clone().sub(runtime.center);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const expectedRelative = relative.clone().applyQuaternion(rotation);
    const destination = new Vector3(10, 4, 8);
    const velocity = new Vector3(0, 2, -3);

    runtime.teleportPose({ position: destination, rotation, velocity });

    expect(runtime.center.distanceToSquared(destination)).toBe(0);
    expect(runtime.velocity.distanceToSquared(velocity)).toBe(0);
    expect(runtime.particles[20].position.clone().sub(destination).distanceTo(expectedRelative)).toBeLessThan(1e-6);
    for (const particle of runtime.particles) {
      expect(particle.previousPosition.distanceToSquared(particle.position)).toBe(0);
      expect(particle.renderPosition.distanceToSquared(particle.position)).toBe(0);
    }
  });
});

describe("BlobOrganismRuntime gravity and ballistics", () => {
  it("only accumulates gravity when the step input provides it", () => {
    const runtime = new BlobOrganismRuntime({ seed: 3 });
    runtime.step(BLOB_FIXED_STEP_SECONDS);
    expect(Math.abs(runtime.particles[100].velocity.y)).toBeLessThan(0.5);

    for (let index = 0; index < 15; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18 });
    }
    expect(runtime.particles[100].velocity.y).toBeLessThan(-2);
    expect(runtime.particles[100].velocity.y).toBeGreaterThanOrEqual(-9.001);
  });

  it("rests particles whose resolver reports ground support", () => {
    const runtime = new BlobOrganismRuntime({
      seed: 3,
      motionResolver: (_particle, from) => ({ position: from, grounded: true }),
    });
    for (let index = 0; index < 12; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18 });
    }
    expect(Math.abs(runtime.particles[100].velocity.y)).toBeLessThan(0.7);
  });

  it("launches ballistic, suspends steering, and lands when support returns", () => {
    let grounded = false;
    const runtime = new BlobOrganismRuntime({
      seed: 5,
      motionResolver: (_particle, _from, desired) => ({
        position: desired,
        grounded,
      }),
    });
    runtime.launch(new Vector3(4, 6, 0));
    expect(runtime.airborne).toBe(true);

    const still = new Vector3(0, 0, 0);
    for (let index = 0; index < 12; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18, desiredVelocity: still });
    }
    // Locomotion no frena el proyectil: la velocidad horizontal se conserva.
    expect(runtime.airborne).toBe(true);
    expect(runtime.particles[50].velocity.x).toBeGreaterThan(3);

    grounded = true;
    for (let index = 0; index < 8 && runtime.airborne; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18 });
    }
    expect(runtime.airborne).toBe(false);
  });
});

describe("BlobOrganismRuntime gunfire detachment", () => {
  it("detaches the local kernel as a returning chunk and exposes the brain", () => {
    const runtime = new BlobOrganismRuntime({ seed: 13 });
    const exposureBefore = runtime.exposure;
    const point = runtime.particles[120].position.clone();

    const count = runtime.detachAt(point, 0.8, new Vector3(5, 2, 0));

    expect(count).toBeGreaterThanOrEqual(3);
    expect(runtime.componentCount).toBe(2);
    expect(runtime.particles[0].componentId).toBe(0);
    const chunk = runtime.components.find(
      (component) => component.active && component.id !== 0,
    );
    expect(chunk?.detached).toBe(true);
    expect(runtime.exposure).toBeGreaterThan(exposureBefore);
  });

  it("refuses to detach while a choreographed pose is held", () => {
    const runtime = new BlobOrganismRuntime({ seed: 13 });
    runtime.setPose({ kind: "column", duration: 0.5 });
    expect(runtime.detachAt(runtime.center, 1, new Vector3(3, 0, 0))).toBe(0);
  });

  it("keeps a detached chunk crawling home until it re-merges with the mass", () => {
    const runtime = new BlobOrganismRuntime({
      seed: 17,
      motionResolver: (_particle, _from, desired) => ({
        position: desired,
        grounded: true,
      }),
    });
    const point = runtime.particles[130].position.clone();
    expect(runtime.detachAt(point, 0.7, new Vector3(6, 0, 0))).toBeGreaterThanOrEqual(3);
    expect(runtime.componentCount).toBe(2);

    for (let index = 0; index < 21; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18 });
    }
    const chunk = runtime.components.find(
      (component) => component.active && component.id !== 0,
    );
    expect(chunk).toBeDefined();
    expect(chunk!.center.distanceTo(runtime.components[0].center)).toBeGreaterThan(1.5);

    let reunited = false;
    for (let index = 0; index < 240 && !reunited; index++) {
      runtime.step(BLOB_FIXED_STEP_SECONDS, { gravity: 18 });
      reunited = runtime.componentCount === 1;
    }
    expect(reunited).toBe(true);
  });
});

describe("BlobOrganismRuntime envelop", () => {
  it("flows eligible flesh into a vertical sheath around the envelop target", () => {
    const runtime = new BlobOrganismRuntime({
      seed: 23,
      envelopFraction: 0.6,
      envelopFlowSpeed: 3,
      envelopSwirlSpeed: 0.5,
    });
    const target = runtime.center.clone().add(new Vector3(1.2, -0.4, 0));
    runtime.setEnvelopTarget({ position: target, radius: 0.35, height: 1.7 });
    advance(runtime, 1.6);

    const sheath = runtime.activeParticles.filter((particle) => {
      const planar = Math.hypot(
        particle.position.x - target.x,
        particle.position.z - target.z,
      );
      return planar < 1.05 && particle.position.y > target.y + 0.5;
    });
    expect(sheath.length).toBeGreaterThan(8);

    runtime.setEnvelopTarget(null);
    expect(runtime.airborne).toBe(false);
  });
});
