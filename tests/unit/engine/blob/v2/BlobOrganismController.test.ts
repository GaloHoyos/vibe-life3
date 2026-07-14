import { describe, expect, it } from "vitest";
import {
  BLOB_V2_FIXED_STEP_SECONDS,
  BlobOrganismController,
  type BlobFragmentObservation,
  type BlobStepInput,
} from "@engine/blob/v2";

function advance(
  controller: BlobOrganismController,
  seconds: number,
  input: BlobStepInput = {},
): void {
  const steps = Math.ceil(seconds / BLOB_V2_FIXED_STEP_SECONDS);
  for (let index = 0; index < steps; index++) {
    controller.step(BLOB_V2_FIXED_STEP_SECONDS, input);
  }
}

function breach(controller: BlobOrganismController, x = 1, detachBiomass = 8) {
  return controller.applyImpact({
    point: { x, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    damage: 36,
    cohesionEnergy: 36,
    detachBiomass,
    impulse: { x: -1, y: 0, z: 0 },
  });
}

describe("BlobOrganismController biomass and snapshots", () => {
  it("starts at 192/250 with stable cell IDs and a deeply immutable snapshot", () => {
    const controller = new BlobOrganismController({ seed: 7 });
    const initial = controller.snapshot();

    expect(initial.biomass).toEqual({
      initial: 192,
      maximum: 250,
      total: 192,
      attached: 192,
      fragments: 0,
      created: 192,
      lost: 0,
    });
    expect(initial.cells.map((cell) => cell.id)).toEqual(
      Array.from({ length: 192 }, (_, index) => index + 1),
    );
    expect(initial.cells[0]).toMatchObject({ id: 1, isCore: true, membership: "attached" });
    expect(initial.particles).toHaveLength(192);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.cells)).toBe(true);
    expect(Object.isFrozen(initial.cells[0])).toBe(true);
    expect(Object.isFrozen(initial.particles[0]?.position)).toBe(true);

    const consumption = controller.consumeBiomass(100);
    const grown = controller.snapshot();
    expect(consumption.accepted).toBe(58);
    expect(grown.biomass.total).toBe(250);
    expect(grown.cells.slice(0, 192).map((cell) => cell.id)).toEqual(
      initial.cells.map((cell) => cell.id),
    );
    expect(grown.cells.at(-1)?.id).toBe(250);
    expect(controller.consumeBiomass(1).accepted).toBe(0);
  });

  it("metabolizes consumed biomass for core healing even at the topology cap", () => {
    const controller = new BlobOrganismController();
    controller.consumeBiomass(58);
    breach(controller);
    controller.applyImpact({
      point: { x: 1, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      damage: 10,
    });
    expect(controller.core.health).toBe(125);

    const result = controller.consumeBiomass(12);

    expect(result).toMatchObject({ accepted: 0, coreHealing: 24 });
    expect(controller.core.health).toBe(149);
    expect(controller.snapshot().biomass.total).toBe(250);
  });

  it("uses a deterministic 30 Hz simulation with a two-step recovery cap", () => {
    const first = new BlobOrganismController({ seed: 123 });
    const second = new BlobOrganismController({ seed: 123 });
    const input = { desiredVelocity: { x: 1.5, y: 0, z: -0.5 } } as const;

    expect(first.step(1 / 60, input)).toMatchObject({ steps: 0, alpha: 0.5 });
    expect(second.step(1 / 60, input)).toMatchObject({ steps: 0, alpha: 0.5 });
    expect(first.step(1 / 60, input).steps).toBe(1);
    expect(second.step(1 / 60, input).steps).toBe(1);
    for (let index = 0; index < 45; index++) {
      first.step(BLOB_V2_FIXED_STEP_SECONDS, input);
      second.step(BLOB_V2_FIXED_STEP_SECONDS, input);
    }
    expect(first.snapshot().particles).toEqual(second.snapshot().particles);
    expect(first.particles.lastCandidateChecks).toBeGreaterThan(0);

    const hitch = first.step(1, input);
    expect(hitch.steps).toBe(2);
    expect(hitch.droppedTime).toBeGreaterThan(0.9);
  });

  it("restores the constructor distribution only for a pristine evidence run", () => {
    const controller = new BlobOrganismController({
      center: { x: 2, y: 1, z: -3 },
      seed: 91,
    });
    const initial = controller.snapshot().particles;
    advance(controller, 1, {
      desiredVelocity: { x: 2, y: 0, z: 1 },
      gravity: 4,
    });
    expect(controller.snapshot().particles).not.toEqual(initial);

    const reset = controller.resetForEvidence({ x: 2, y: 1, z: -3 });

    expect(reset.simulationTime).toBe(0);
    expect(reset.particles).toEqual(initial);
    expect(reset.organismState).toBe("Idle");
    expect(reset.traversalState).toBe("Ground");
    expect(reset.overrideState).toBe("None");

    breach(controller);
    expect(() => controller.resetForEvidence({ x: 2, y: 1, z: -3 })).toThrow(
      /pristine topology/,
    );
  });

  it("publishes authoritative contact normals and compression for anisotropic rendering", () => {
    const controller = new BlobOrganismController({ seed: 71 });
    controller.step(1 / 30, {
      contactResolver: (_cellId, _from, desired) => ({
        position: { x: desired.x, y: desired.y + 0.08, z: desired.z },
        normal: { x: 0, y: 1, z: 0 },
        grounded: true,
      }),
    });
    const contact = controller.snapshot().particles[0];
    expect(contact?.contactNormal).toEqual({ x: 0, y: 1, z: 0 });
    expect(contact?.contactAmount).toBeGreaterThan(0);

    controller.step(1 / 30);
    expect(controller.snapshot().particles[0]?.contactAmount).toBe(0);
  });

  it("keeps scripted splits separate from combat fragmentation and merges physically", () => {
    const controller = new BlobOrganismController();
    const beforeIds = controller.snapshot().cells.map((cell) => cell.id);
    const split = controller.splitScripted(3);

    expect(split.ok).toBe(true);
    expect(split.islandIds).toHaveLength(3);
    let snapshot = controller.snapshot();
    expect(snapshot.biomass).toMatchObject({ total: 192, attached: 192, fragments: 0 });
    expect(snapshot.wounds).toHaveLength(0);
    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.cells.map((cell) => cell.id)).toEqual(beforeIds);

    expect(controller.completeScriptedMerge(split.islandIds[1]!)).toMatchObject({ ok: false });
    expect(controller.snapshot().scriptedSplit.active).toBe(true);
    expect(controller.requestScriptedMerge().ok).toBe(true);
    expect(controller.snapshot().scriptedSplit.mergeRequested).toBe(true);
    for (const islandId of split.islandIds.slice(1)) {
      expect(controller.completeScriptedMerge(islandId).ok).toBe(true);
    }
    snapshot = controller.snapshot();
    expect(snapshot.scriptedSplit.active).toBe(false);
    expect(snapshot.islands).toHaveLength(1);

    const combat = breach(controller);
    expect(combat.fragmentId).not.toBeNull();
    expect(controller.splitScripted(2)).toMatchObject({ ok: false, reason: "busy" });
    expect(controller.drainEvents()).toContainEqual({
      type: "error",
      command: "SplitBlob",
      reason: "busy",
    });
  });

  it("freezes simulation time without corrupting interpolation", () => {
    const controller = new BlobOrganismController();
    controller.setOverrideState("Frozen");
    expect(controller.step(2).steps).toBe(0);
    expect(controller.snapshot().simulationTime).toBe(0);
    controller.setOverrideState("None");
    expect(controller.step(BLOB_V2_FIXED_STEP_SECONDS).steps).toBe(1);
  });

  it("never reuses lost cell, fragment, island, or wound IDs", () => {
    const controller = new BlobOrganismController({ coverageSectors: [] });
    const first = breach(controller);
    if (first.fragmentId === null || first.woundId === null) throw new Error("Expected first fragment");
    const firstFragment = controller.snapshot().fragments[0];
    const firstCellIds = firstFragment?.cellIds ?? [];
    controller.applyImpact({
      point: { x: 1, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      damage: 48,
      fragmentId: first.fragmentId,
    });
    controller.consumeBiomass(8);
    const replacementIds = controller.snapshot().cells
      .map((cell) => cell.id)
      .filter((id) => !Array.from({ length: 184 }, (_, index) => index + 1).includes(id));
    expect(Math.min(...replacementIds)).toBeGreaterThan(Math.max(...firstCellIds));

    const second = breach(controller, 2);
    const secondFragment = controller.snapshot().fragments.find((fragment) => fragment.id === second.fragmentId);
    expect(second.fragmentId).toBeGreaterThan(first.fragmentId);
    expect(second.woundId).toBeGreaterThan(first.woundId);
    expect(secondFragment?.islandId).toBeGreaterThan(firstFragment?.islandId ?? 0);
    expect(secondFragment?.generation).toBeGreaterThan(firstFragment?.generation ?? 0);
  });
});

describe("BlobOrganismController fragment lifecycle", () => {
  it("returns and reattaches with the same cell IDs through a 0.6 second neck", () => {
    const controller = new BlobOrganismController({ fragmentReturnSpeed: 2.5 });
    const result = breach(controller);
    const fragmentId = result.fragmentId;
    expect(fragmentId).not.toBeNull();
    if (fragmentId === null) return;
    const detachedIds = controller.snapshot().fragments[0]?.cellIds;

    advance(controller, 4);
    const fragment = controller.snapshot().fragments.find((entry) => entry.id === fragmentId);
    expect(fragment?.state).toBe("Attached");
    expect(fragment?.reattachProgress).toBe(1);
    expect(fragment?.cellIds).toEqual(detachedIds);
    expect(controller.snapshot().biomass).toMatchObject({ total: 192, attached: 192, fragments: 0 });
    expect(controller.snapshot().core.state).toBe("Covered");
    expect(controller.snapshot().wounds[0]?.state).toBe("Closed");
  });

  it("withers irreversibly at 10 seconds and loses its biomass after 1.5 seconds", () => {
    const controller = new BlobOrganismController();
    const fragmentId = breach(controller).fragmentId;
    expect(fragmentId).not.toBeNull();
    if (fragmentId === null) return;
    const blocked: BlobFragmentObservation = {
      position: { x: 10, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      lineOfSightToOwner: false,
    };
    const input = { fragmentObservations: { [fragmentId]: blocked } };

    advance(controller, 10.01, input);
    expect(controller.snapshot().fragments.find((entry) => entry.id === fragmentId)?.state).toBe("Withering");
    expect(controller.snapshot().fragments.find((entry) => entry.id === fragmentId)?.needsPath).toBe(false);

    const temptingReturn = {
      fragmentObservations: {
        [fragmentId]: {
          position: { x: 0, y: 0, z: 0 },
          grounded: true,
          lineOfSightToOwner: true,
        },
      },
    };
    advance(controller, 1.4, temptingReturn);
    expect(controller.snapshot().fragments.find((entry) => entry.id === fragmentId)?.state).toBe("Withering");
    advance(controller, 0.11, temptingReturn);
    expect(controller.snapshot().fragments.find((entry) => entry.id === fragmentId)?.state).toBe("Dead");
    expect(controller.snapshot().biomass).toMatchObject({ total: 184, attached: 184, fragments: 0, lost: 8 });
  });

  it("requests a Blob path after 0.55 seconds without return progress", () => {
    const controller = new BlobOrganismController();
    const fragmentId = breach(controller).fragmentId;
    if (fragmentId === null) throw new Error("Expected fragment");
    const blocked = {
      fragmentObservations: {
        [fragmentId]: {
          position: { x: 10, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          lineOfSightToOwner: false,
        },
      },
    } as const;
    advance(controller, 1.2, blocked);

    expect(controller.snapshot().fragments.find((fragment) => fragment.id === fragmentId)?.needsPath).toBe(true);
    expect(controller.drainEvents().filter((event) => event.type === "fragmentPathRequested")).toEqual([
      { type: "fragmentPathRequested", fragmentId },
    ]);
  });

  it("measures return progress after collision resolution and never reattaches through a blocker", () => {
    const controller = new BlobOrganismController();
    const fragmentId = breach(controller).fragmentId;
    if (fragmentId === null) throw new Error("Expected fragment");
    const pinned = { x: 1, y: 0, z: 0 } as const;
    const input: BlobStepInput = {
      fragmentObservations: {
        [fragmentId]: {
          position: pinned,
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          lineOfSightToOwner: true,
        },
      },
      fragmentMotionResolver: (_fragmentId, _islandId, from) => from,
    };

    advance(controller, 1.2, input);

    const fragment = controller.snapshot().fragments.find((entry) => entry.id === fragmentId);
    expect(fragment).toMatchObject({ state: "Returning", needsPath: true });
    expect(fragment?.position.x).toBe(1);
    expect(controller.snapshot().wounds[0]?.state).not.toBe("Reattaching");
  });

  it("keeps terminal fragment and closed-wound history bounded without reusing IDs", () => {
    const controller = new BlobOrganismController({
      center: { x: 0, y: 0, z: 0 },
      initialBiomass: 32,
      maximumBiomass: 32,
      coverageSectors: [],
    });

    for (let cycle = 0; cycle < 30; cycle++) {
      const result = breach(controller, 1, 8);
      if (result.fragmentId === null) throw new Error(`Expected fragment in cycle ${cycle}`);
      for (let step = 0; step < 25; step++) {
        const core = controller.snapshot().core.position;
        const observation = {
          position: { x: core.x, y: core.y, z: core.z },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          lineOfSightToOwner: true,
        } as const;
        controller.step(BLOB_V2_FIXED_STEP_SECONDS, {
          fragmentObservations: { [result.fragmentId]: observation },
        });
      }
      expect(controller.snapshot().fragments.at(-1)?.state).toBe("Attached");
      controller.drainEvents();
    }

    const snapshot = controller.snapshot();
    expect(snapshot.fragments).toHaveLength(12);
    expect(snapshot.fragments[0]?.id).toBe(19);
    expect(snapshot.fragments.at(-1)?.id).toBe(30);
    expect(snapshot.wounds).toHaveLength(24);
    expect(snapshot.wounds[0]?.id).toBe(7);
    expect(snapshot.wounds.at(-1)?.id).toBe(30);
    expect(snapshot.biomass).toMatchObject({ total: 32, attached: 32, fragments: 0 });
    controller.assertInvariants();
  });
});
