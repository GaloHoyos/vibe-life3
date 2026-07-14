import { describe, expect, it } from "vitest";
import { BLOB_V2_FIXED_STEP_SECONDS, BlobOrganismController } from "@engine/blob/v2";

function impactAt(x: number, extras: Record<string, unknown> = {}) {
  return {
    point: { x, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    damage: 36,
    cohesionEnergy: 36,
    detachBiomass: 8,
    impulse: { x: 0, y: 0, z: 0 },
    ...extras,
  };
}

describe("BlobDamageRouter", () => {
  it("blocks intact skin, opens a local breach, and never damages core on the opening hit", () => {
    const controller = new BlobOrganismController();
    const opening = controller.applyImpact(impactAt(1));

    expect(opening).toMatchObject({
      target: "skin",
      openedBreach: true,
      coreDamage: 0,
      biomassLost: 0,
    });
    expect(controller.snapshot().core).toMatchObject({ health: 150, state: "Breached" });
    expect(controller.snapshot().biomass).toMatchObject({ total: 192, attached: 184, fragments: 8 });

    const throughOpening = controller.applyImpact(impactAt(1, {
      damage: 10,
      cohesionEnergy: 10,
    }));
    expect(throughOpening).toMatchObject({ target: "core", openedBreach: false, coreDamage: 25 });
    expect(controller.snapshot().core.health).toBe(125);

    const wrongCorridor = controller.applyImpact({
      ...impactAt(1),
      point: { x: 1, y: 1, z: 0 },
      damage: 10,
      cohesionEnergy: 10,
    });
    expect(wrongCorridor.target).toBe("skin");
    expect(wrongCorridor.coreDamage).toBe(0);
  });

  it("decays local cohesion by 12/s only after the 0.75 second grace", () => {
    const controller = new BlobOrganismController();
    controller.applyImpact(impactAt(1, { damage: 20, cohesionEnergy: 20 }));
    for (let index = 0; index < 22; index++) controller.step(BLOB_V2_FIXED_STEP_SECONDS);
    expect(controller.snapshot().wounds[0]?.cohesionEnergy).toBeCloseTo(20, 6);
    for (let index = 0; index < 8; index++) controller.step(BLOB_V2_FIXED_STEP_SECONDS);
    expect(controller.snapshot().wounds[0]?.cohesionEnergy).toBeCloseTo(17, 5);
  });

  it("erodes fragments at one biomass per six damage and kills them below four", () => {
    const controller = new BlobOrganismController();
    const fragmentId = controller.applyImpact(impactAt(1)).fragmentId;
    expect(fragmentId).not.toBeNull();
    if (fragmentId === null) return;

    const first = controller.applyImpact({
      ...impactAt(1),
      fragmentId,
      damage: 24,
    });
    expect(first).toMatchObject({ target: "fragment", biomassLost: 4 });
    expect(controller.snapshot().fragments[0]).toMatchObject({ state: "Detaching", biomass: 4 });
    expect(controller.snapshot().biomass.total).toBe(188);

    const lethal = controller.applyImpact({
      ...impactAt(1),
      fragmentId,
      damage: 6,
    });
    expect(lethal).toMatchObject({ target: "fragment", biomassLost: 4 });
    expect(controller.snapshot().fragments[0]).toMatchObject({ state: "Dead", biomass: 0 });
    expect(controller.snapshot().biomass).toMatchObject({ total: 184, attached: 184, fragments: 0, lost: 8 });
    expect(controller.snapshot().wounds[0]).toMatchObject({ state: "Exposed", fragmentId: null });
  });

  it("caps autonomous fragments at six and sheds further breaches without merging IDs", () => {
    const controller = new BlobOrganismController();
    const fragmentIds: number[] = [];
    for (let index = 0; index < 6; index++) {
      const result = controller.applyImpact(impactAt(1 + index));
      expect(result.fragmentId).not.toBeNull();
      if (result.fragmentId !== null) fragmentIds.push(result.fragmentId);
    }
    const overflow = controller.applyImpact(impactAt(7));
    const snapshot = controller.snapshot();

    expect(new Set(fragmentIds).size).toBe(6);
    expect(overflow).toMatchObject({ openedBreach: true, fragmentId: null, biomassLost: 8 });
    expect(snapshot.fragments.filter((fragment) => fragment.state !== "Dead" && fragment.state !== "Attached")).toHaveLength(6);
    expect(snapshot.islands.filter((island) => island.kind === "combat-fragment")).toHaveLength(6);
    expect(snapshot.biomass).toMatchObject({ total: 184, attached: 136, fragments: 48 });
    expect(snapshot.shedDroplets).toHaveLength(2);
    expect(snapshot.shedDroplets.reduce((total, droplet) => total + droplet.biomass, 0)).toBe(8);
    expect(snapshot.shedDroplets.every((droplet) => droplet.witherProgress === 0)).toBe(true);
    expect(controller.drainEvents().filter((event) => event.type === "shedDropletSpawned")).toHaveLength(2);

    for (let index = 0; index < 44; index++) controller.step(BLOB_V2_FIXED_STEP_SECONDS);
    expect(controller.snapshot().shedDroplets).toHaveLength(2);
    expect(controller.snapshot().shedDroplets[0]?.witherProgress).toBeGreaterThan(0.97);
    controller.step(BLOB_V2_FIXED_STEP_SECONDS);
    expect(controller.snapshot().shedDroplets).toHaveLength(0);
    expect(controller.snapshot().biomass).toMatchObject({ total: 184, lost: 8 });
    expect(controller.drainEvents().filter((event) => event.type === "shedDropletWithered")).toHaveLength(2);
    controller.assertInvariants();
  });

  it("sheds sub-viable remaining mass instead of creating a fragment below four biomass", () => {
    const controller = new BlobOrganismController({
      initialBiomass: 4,
      maximumBiomass: 4,
    });

    const opening = controller.applyImpact(impactAt(1));
    const snapshot = controller.snapshot();

    expect(opening).toMatchObject({
      openedBreach: true,
      fragmentId: null,
      biomassLost: 3,
    });
    expect(snapshot.fragments).toHaveLength(0);
    expect(snapshot.islands.filter((island) => island.kind === "combat-fragment")).toHaveLength(0);
    expect(snapshot.biomass).toMatchObject({
      total: 1,
      attached: 1,
      fragments: 0,
      created: 4,
      lost: 3,
    });
    expect(snapshot.wounds[0]).toMatchObject({ repairDeficit: 3, fragmentId: null });
    controller.assertInvariants();
  });

  it("rejects invalid deterministic detach overrides before mutating wounds", () => {
    const controller = new BlobOrganismController();

    expect(() => controller.applyImpact(impactAt(1, { detachBiomass: Number.NaN })))
      .toThrow(/finite and non-negative/);
    expect(controller.snapshot().wounds).toHaveLength(0);
    expect(controller.snapshot().biomass).toMatchObject({ total: 192, lost: 0 });
  });
});
