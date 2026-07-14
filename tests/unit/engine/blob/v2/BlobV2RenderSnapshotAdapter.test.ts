import { describe, expect, it } from "vitest";
import type { BlobOrganismSnapshot } from "@engine/blob/v2/BlobV2Types";
import { adaptBlobV2RenderSnapshot } from "@engine/blob/v2/render/BlobV2RenderSnapshotAdapter";

describe("adaptBlobV2RenderSnapshot", () => {
  it("groups authoritative cells and keeps positive skin coverage around the core", () => {
    const source = makeCoreSnapshot();
    const render = adaptBlobV2RenderSnapshot(source);

    expect(render.mainIslandId).toBe(1);
    expect(render.islands).toHaveLength(2);
    expect(render.islands[0]).toMatchObject({
      id: 1,
      generation: 1,
      kind: "main",
    });
    expect(render.islands[0]?.cells.map((cell) => cell.id)).toEqual([1, 2]);
    expect(render.islands[0]?.cells[0]).toMatchObject({
      position: source.core.position,
      scale: 1,
    });
    expect(render.islands[0]?.cells[0]?.radius).toBeGreaterThanOrEqual(
      source.core.radius * 1.05,
    );
    expect(render.islands[1]).toMatchObject({
      id: 2,
      generation: 2,
      kind: "fragment",
      fragmentState: "withering",
    });
    expect(render.islands[1]?.cells[0]?.scale).toBeCloseTo(0.6);
    expect(render.islands[1]?.witherProgress).toBeCloseTo(0.4);
    expect(render.islands[0]?.wounds).toHaveLength(2);
    expect(render.islands[0]?.wounds?.[0]).toMatchObject({
      id: 10,
      opensSkin: false,
    });
    expect(render.islands[0]?.wounds?.[0]?.strength).toBeLessThan(1);
    expect(render.islands[0]?.wounds?.[1]).toMatchObject({
      id: 11,
      opensSkin: true,
      strength: 1,
    });
    expect(render.islands[1]?.wounds).toHaveLength(0);
    expect(Object.isFrozen(render)).toBe(true);
    expect(Object.isFrozen(render.islands)).toBe(true);
  });

  it("keeps a covered core inside opaque flesh without exposing its hit target", () => {
    const source = makeCoreSnapshot();
    const render = adaptBlobV2RenderSnapshot({
      ...source,
      core: { ...source.core, state: "Covered" },
      wounds: [],
    });

    expect(render.core).toMatchObject({ state: "covered", exposure: 0 });
    expect(render.islands[0]?.cells.some((cell) => cell.id === 1)).toBe(true);
    expect(render.islands[0]?.wounds).toEqual([]);
  });

  it("adapts overflow shed records without creating topology islands", () => {
    const source = makeCoreSnapshot();
    const render = adaptBlobV2RenderSnapshot({
      ...source,
      shedDroplets: [{
        id: 4,
        biomass: 3,
        position: { x: 0.4, y: 0.2, z: 0 },
        velocity: { x: 1, y: 2, z: 0 },
        radius: 0.13,
        createdAt: 0,
        age: 0.75,
        witherProgress: 0.5,
      }],
    });

    expect(render.islands).toHaveLength(source.islands.length);
    expect(render.shedDroplets).toEqual([{
      id: 4,
      position: { x: 0.4, y: 0.2, z: 0 },
      velocity: { x: 1, y: 2, z: 0 },
      radius: 0.13,
      witherProgress: 0.5,
    }]);
    expect(Object.isFrozen(render.shedDroplets)).toBe(true);
  });

  it("keeps motion on cadence but changes revision for topology", () => {
    const firstSource = makeCoreSnapshot();
    const first = adaptBlobV2RenderSnapshot(firstSource);
    const moved = adaptBlobV2RenderSnapshot({
      ...firstSource,
      version: 2,
      particles: firstSource.particles.map((particle) => ({
        ...particle,
        renderPosition: {
          x: particle.renderPosition.x + 1,
          y: particle.renderPosition.y,
          z: particle.renderPosition.z,
        },
      })),
    });
    expect(moved.islands[0]?.geometryRevision).toBe(
      first.islands[0]?.geometryRevision,
    );

    const topologyChanged = adaptBlobV2RenderSnapshot({
      ...firstSource,
      particles: firstSource.particles.filter((particle) => particle.cellId !== 2),
      cells: firstSource.cells.filter((cell) => cell.id !== 2),
    });
    expect(topologyChanged.islands[0]?.geometryRevision).not.toBe(
      first.islands[0]?.geometryRevision,
    );
  });
});

export function makeCoreSnapshot(): BlobOrganismSnapshot {
  return {
    version: 1,
    simulationTime: 1,
    interpolationAlpha: 0.5,
    organismState: "Idle",
    traversalState: "Ground",
    overrideState: "None",
    biomass: {
      initial: 192,
      maximum: 250,
      total: 3,
      attached: 2,
      fragments: 1,
      created: 0,
      lost: 0,
    },
    core: {
      state: "Exposed",
      health: 150,
      maximumHealth: 150,
      damageMultiplier: 2.5,
      position: { x: 0, y: 0, z: 0 },
      radius: 0.35,
    },
    cells: [
      { id: 1, islandId: 1, membership: "attached", isCore: true },
      { id: 2, islandId: 1, membership: "attached", isCore: false },
      {
        id: 3,
        islandId: 2,
        membership: "combat-fragment",
        isCore: false,
      },
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
      {
        id: 2,
        generation: 2,
        kind: "combat-fragment",
        fragmentId: 7,
        biomass: 1,
        mergeRequested: false,
      },
    ],
    wounds: [
      wound(10, "Stressed"),
      wound(11, "Exposed"),
    ],
    fragments: [
      {
        id: 7,
        islandId: 2,
        generation: 2,
        woundId: 11,
        state: "Withering",
        biomass: 1,
        cellIds: [3],
        position: { x: 1, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        detachedAt: 0,
        stateStartedAt: 0.5,
        age: 1,
        reattachProgress: 0,
        witherProgress: 0.4,
        damageRemainder: 0,
        needsPath: false,
      },
    ],
    shedDroplets: [],
    particles: [
      particle(1, 1, 0),
      particle(2, 1, 0.3),
      particle(3, 2, 1),
    ],
    scriptedSplit: {
      active: false,
      mergeRequested: false,
      islandIds: [],
    },
  };
}

function wound(id: number, state: "Stressed" | "Exposed") {
  return {
    id,
    point: { x: 0.2, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    radius: 0.25,
    state,
    cohesionEnergy: state === "Stressed" ? 10 : 36,
    cohesionThreshold: 36,
    repairDeficit: 0,
    detachedBiomass: 1,
    fragmentId: state === "Stressed" ? null : 7,
    createdAt: 0,
    lastImpactAt: 0,
    openedAt: state === "Stressed" ? null : 0.1,
    reattachProgress: 0,
    sourceWoundId: null,
  } as const;
}

function particle(cellId: number, islandId: number, x: number) {
  return {
    cellId,
    islandId,
    position: { x, y: 0, z: 0 },
    previousPosition: { x, y: 0, z: 0 },
    renderPosition: { x, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.16,
  };
}
