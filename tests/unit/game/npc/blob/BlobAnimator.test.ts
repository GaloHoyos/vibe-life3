import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';
import { blobSurfaceScheduler } from '@engine/blob/BlobSurfaceScheduler';
import { BlobAnimator } from '@game/npc/blob/BlobAnimator';

describe('BlobAnimator', () => {
  afterEach(() => blobSurfaceScheduler.clear());

  it('crea cerebro, tendones y superficie y libera todo idempotentemente', () => {
    const root = new Group();
    const runtime = new BlobOrganismRuntime({ center: new Vector3() });
    const animator = new BlobAnimator(root, { ownerId: 'blob-test', runtime });

    expect(root.getObjectByName('blob-brain-blob-test')).toBeDefined();
    expect(root.getObjectByName('blob-tendons-blob-test')).toBeDefined();
    expect(root.getObjectByName('blob-surface-blob-test-0')).toBeDefined();

    animator.dispose();
    animator.dispose();
    expect(root.children).toHaveLength(0);
  });

  it('usa una superficie cercana densa, continua y con material lechoso', () => {
    const root = new Group();
    const runtime = new BlobOrganismRuntime({
      center: new Vector3(),
      particleRadius: 0.28,
      bodyRadius: 1.6,
      separationDistance: 0.28 * 1.65,
    });
    // Un splat extremo no debe agrandar la grilla principal a 12 metros.
    runtime.particles[100].renderPosition.x += 20;
    const animator = new BlobAnimator(root, { ownerId: 'blob-surface', runtime });

    animator.updateFromMotor(makeFrame(1 / 15));
    blobSurfaceScheduler.runFrame();

    const surface = root.getObjectByName('blob-surface-blob-surface-0') as MarchingCubes;
    const material = surface.material as MeshStandardMaterial;
    expect(surface.resolution).toBe(40);
    expect(surface.scale.x).toBeLessThanOrEqual(3.5);
    // Resolution 40 still produces thousands of smooth triangles while its
    // synchronous rebuild remains below the 64-grid stall cost.
    expect(surface.count).toBeGreaterThan(15_000);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.roughness).toBeGreaterThanOrEqual(0.35);
    expect(material.emissiveIntensity).toBeLessThan(0.1);
    expect(material.forceSinglePass).toBe(true);

    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('blobSurfaceTime');
    expect(shader.vertexShader).toContain('blobSurfaceWave');
    expect(shader.uniforms).toHaveProperty('blobSurfaceAmplitude');
    expect((shader.uniforms.blobSurfaceTime as { value: number }).value).toBeGreaterThan(0);
    expect((shader.uniforms.blobSurfaceAmplitude as { value: number }).value).toBeGreaterThan(0);

    animator.dispose();
  });

  it('mueve la topología anterior con el centroide visual interpolado cada frame', () => {
    const root = new Group();
    const runtime = new BlobOrganismRuntime({ center: new Vector3() });
    const animator = new BlobAnimator(root, { ownerId: 'blob-interpolation', runtime });

    animator.updateFromMotor(makeFrame(1 / 30));
    blobSurfaceScheduler.runFrame();
    const surface = root.getObjectByName(
      'blob-surface-blob-interpolation-0',
    ) as MarchingCubes;
    const before = surface.position.x;

    // Component.center remains fixed-step state; renderPosition is the visual
    // interpolation consumed between those steps.
    for (const particle of runtime.activeParticles) particle.renderPosition.x += 0.75;
    animator.updateFromMotor(makeFrame(1 / 120));

    expect(surface.position.x - before).toBeCloseTo(0.75, 5);
    animator.dispose();
  });

  it('dibuja sólo tendones internos conectados y con bounds actualizados', () => {
    const root = new Group();
    const runtime = new BlobOrganismRuntime({ center: new Vector3() });
    const animator = new BlobAnimator(root, { ownerId: 'blob-tendons', runtime });
    const tendons = root.getObjectByName('blob-tendons-blob-tendons') as InstancedMesh;

    animator.updateFromMotor(makeFrame(1 / 30));
    const tendonConstraints = runtime.constraints.filter(({ kind }) => kind === 'tendon');
    expect(tendons.count).toBe(tendonConstraints.length);
    expect(tendons.frustumCulled).toBe(true);
    expect(tendons.boundingSphere?.radius).toBeGreaterThan(0);
    expect((tendons.material as MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.15);

    const broken = tendonConstraints[0];
    broken.brokenUntil = runtime.simulationTimeSeconds + 10;
    animator.updateFromMotor(makeFrame(1 / 30));
    expect(tendons.count).toBe(tendonConstraints.length - 1);

    broken.brokenUntil = 0;
    const endpoint = runtime.particles[broken.particleB].renderPosition;
    const original = endpoint.clone();
    endpoint.add(new Vector3(10, 0, 0));
    animator.updateFromMotor(makeFrame(1 / 30));
    expect(tendons.count).toBe(tendonConstraints.length - 1);
    endpoint.copy(original);

    animator.dispose();
  });

  it('no duplica en el animator el impulso que ya aplican las hitboxes', () => {
    const root = new Group();
    const runtime = new BlobOrganismRuntime({ center: new Vector3() });
    const impulse = vi.spyOn(runtime, 'applyRadialImpulse');
    const animator = new BlobAnimator(root, { ownerId: 'blob-hit', runtime });

    animator.notifyHit(new Vector3(1, 0, 0), 1);

    expect(impulse).not.toHaveBeenCalled();
    animator.dispose();
  });
});

function makeFrame(delta: number) {
  return {
    delta,
    lookTarget: new Vector3(),
    balanceIsStumbling: false,
    viewerDistance: 5,
    visible: true,
    snapshot: {
      position: new Vector3(),
      velocity: new Vector3(),
      desiredVelocity: new Vector3(),
      forward: new Vector3(0, 0, 1),
      grounded: true,
      yaw: 0,
      targetYaw: 0,
      distanceToTarget: 0,
    },
  };
}
