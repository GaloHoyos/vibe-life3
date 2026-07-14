import { describe, expect, it } from "vitest";
import { BlobOrganismController } from "@engine/blob/v2";

describe("BlobOrganismController island transforms", () => {
  it("transforms main through a portal without dragging a detached fragment", () => {
    const controller = new BlobOrganismController();
    const opening = controller.applyImpact({
      point: { x: 1, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 1, y: 0, z: 0 },
    });
    if (opening.fragmentId === null) throw new Error("Expected fragment");
    const before = controller.snapshot();
    const fragmentBefore = before.fragments[0];
    const mainId = controller.topology.mainIslandId;

    expect(controller.transformIsland(mainId, {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 10, y: 0, z: 0 },
    })).toBe(true);
    const afterMain = controller.snapshot();
    expect(afterMain.core.position.x).toBeCloseTo(before.core.position.x + 10);
    expect(afterMain.wounds[0]?.point.x).toBeCloseTo((before.wounds[0]?.point.x ?? 0) + 10);
    expect(afterMain.fragments[0]?.position).toEqual(fragmentBefore?.position);

    const fragmentIsland = afterMain.islands.find((island) => island.fragmentId === opening.fragmentId);
    if (!fragmentIsland) throw new Error("Expected fragment island");
    expect(controller.transformIsland(fragmentIsland.id, {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 0, y: 0, z: 5 },
    })).toBe(true);
    const afterFragment = controller.snapshot();
    expect(afterFragment.fragments[0]?.position.z).toBeCloseTo((fragmentBefore?.position.z ?? 0) + 5);
    expect(afterFragment.core.position).toEqual(afterMain.core.position);
    expect(afterFragment.wounds[0]?.point).toEqual(afterMain.wounds[0]?.point);
  });

  it("rotates particle velocities and keeps interpolation endpoints portal-local", () => {
    const controller = new BlobOrganismController();
    controller.step(1 / 30, { desiredVelocity: { x: 1, y: 0, z: 0 } });
    const before = controller.snapshot();
    const mainId = controller.topology.mainIslandId;
    const halfTurnY = { x: 0, y: 1, z: 0, w: 0 };

    controller.transformIsland(mainId, {
      rotation: halfTurnY,
      translation: { x: 3, y: 0, z: 4 },
    });
    const after = controller.snapshot();
    const source = before.particles[0];
    const transformed = after.particles[0];
    expect(transformed?.position.x).toBeCloseTo(-(source?.position.x ?? 0) + 3);
    expect(transformed?.position.z).toBeCloseTo(-(source?.position.z ?? 0) + 4);
    expect(transformed?.previousPosition.x).toBeCloseTo(-(source?.previousPosition.x ?? 0) + 3);
    expect(transformed?.renderPosition.z).toBeCloseTo(-(source?.renderPosition.z ?? 0) + 4);
    expect(transformed?.velocity.x).toBeCloseTo(-(source?.velocity.x ?? 0));
  });
});
