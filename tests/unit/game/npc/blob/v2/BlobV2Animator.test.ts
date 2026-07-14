import { describe, expect, it, vi } from "vitest";
import { Group, Vector3 } from "three";
import { BlobSurfaceScheduler } from "@engine/blob/BlobSurfaceScheduler";
import type { BlobOrganismSnapshot } from "@engine/blob/v2/BlobV2Types";
import { BlobV2Animator } from "@game/npc/blob/v2/BlobV2Animator";

describe("BlobV2Animator", () => {
  it("only adapts snapshots and delegates presentation through NpcAnimator", () => {
    const root = new Group();
    const scheduler = new BlobSurfaceScheduler({ budgetMs: 1_000 });
    const snapshotProvider = vi.fn(() => makeAnimatorSnapshot());
    const animator = new BlobV2Animator(root, {
      ownerId: "wrapper",
      snapshotProvider,
      scheduler,
      maxMainPolyCount: 8_000,
      maxFragmentPolyCount: 4_000,
    });

    animator.updateFromMotor({
      delta: 1 / 60,
      viewerDistance: 6,
      visible: true,
      lookTarget: new Vector3(),
      balanceIsStumbling: false,
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
    });

    expect(snapshotProvider).toHaveBeenCalledOnce();
    expect(scheduler.pendingCount).toBe(1);
    // One regular cell plus the positive skin source that keeps Covered core
    // geometry from floating outside the organism.
    expect(animator.presenter.fallbackCellCount).toBe(2);

    animator.notifyHit(new Vector3(), 1);
    animator.disable();
    expect(animator.presenter.isFrozen).toBe(true);
    expect(scheduler.pendingCount).toBe(0);

    animator.dispose();
    animator.dispose();
    expect(root.getObjectByName("blob-v2-presenter-wrapper")).toBeUndefined();
    scheduler.dispose();
  });

  it("presents death without mutating simulation and releases visuals after 1.4 seconds", () => {
    const root = new Group();
    const scheduler = new BlobSurfaceScheduler({ budgetMs: 1_000 });
    const authoritative = makeAnimatorSnapshot();
    const beforeParticle = { ...authoritative.particles[1].position };
    const onDispose = vi.fn();
    const animator = new BlobV2Animator(root, {
      ownerId: "death",
      snapshotProvider: () => authoritative,
      scheduler,
      warmupBackend: false,
      onDispose,
    });
    const update = vi.spyOn(animator.presenter, "update");

    animator.notifyDeath(undefined, new Vector3(), "blob-core");
    animator.updateStandalone(0.8);

    const deathSnapshot = update.mock.calls.at(-1)?.[0];
    const deathCell = deathSnapshot?.islands[0]?.cells[0];
    expect(deathSnapshot?.core.visible).toBe(false);
    expect(deathSnapshot?.core.radius).toBeLessThan(authoritative.core.radius);
    expect(deathSnapshot?.islands[0]?.witherProgress).toBeGreaterThan(0.5);
    expect(deathCell?.scale).toBeLessThan(1);
    expect(deathCell?.position).not.toEqual(beforeParticle);
    expect(authoritative.particles[1].position).toEqual(beforeParticle);
    expect(animator.presenter.isDisposed).toBe(false);

    animator.updateStandalone(0.61);
    expect(animator.presenter.isDisposed).toBe(true);
    expect(root.getObjectByName("blob-v2-presenter-death")).toBeUndefined();
    expect(scheduler.pendingCount).toBe(0);

    animator.dispose();
    animator.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
    scheduler.dispose();
  });
});

function makeAnimatorSnapshot(): BlobOrganismSnapshot {
  const zero = { x: 0, y: 0, z: 0 };
  return {
    version: 1,
    simulationTime: 1,
    interpolationAlpha: 0,
    organismState: "Idle",
    traversalState: "Ground",
    overrideState: "None",
    biomass: {
      initial: 192,
      maximum: 250,
      total: 2,
      attached: 2,
      fragments: 0,
      created: 0,
      lost: 0,
    },
    core: {
      state: "Covered",
      health: 150,
      maximumHealth: 150,
      damageMultiplier: 2.5,
      position: zero,
      radius: 0.35,
    },
    cells: [
      { id: 1, islandId: 1, membership: "attached", isCore: true },
      { id: 2, islandId: 1, membership: "attached", isCore: false },
    ],
    islands: [
      {
        id: 1,
        generation: 1,
        kind: "main",
        fragmentId: null,
        biomass: 2,
        mergeRequested: false,
      },
    ],
    wounds: [],
    fragments: [],
    shedDroplets: [],
    particles: [
      {
        cellId: 1,
        islandId: 1,
        position: zero,
        previousPosition: zero,
        renderPosition: zero,
        velocity: zero,
        radius: 0.16,
      },
      {
        cellId: 2,
        islandId: 1,
        position: { x: 0.3, y: 0, z: 0 },
        previousPosition: { x: 0.3, y: 0, z: 0 },
        renderPosition: { x: 0.3, y: 0, z: 0 },
        velocity: zero,
        radius: 0.16,
      },
    ],
    scriptedSplit: {
      active: false,
      mergeRequested: false,
      islandIds: [],
    },
  };
}
