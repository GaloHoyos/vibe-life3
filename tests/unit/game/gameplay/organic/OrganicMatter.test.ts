import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import {
  OrganicMatterController,
  organicYieldForMass,
} from "@game/gameplay/organic/OrganicMatter";

describe("OrganicMatterController", () => {
  it("otorga un claim exclusivo y solo acepta control de su consumidor", () => {
    const fixture = organicFixture();

    expect(fixture.matter.tryClaim("blob-a")).toBe(true);
    expect(fixture.matter.tryClaim("blob-a")).toBe(true);
    expect(fixture.matter.tryClaim("blob-b")).toBe(false);

    fixture.matter.setRestraint("blob-b", 0.8);
    fixture.matter.setDigestionProgress("blob-b", 0.5);
    expect(fixture.setRestraint).not.toHaveBeenCalled();
    expect(fixture.setDigestionProgress).not.toHaveBeenCalled();

    fixture.matter.setRestraint("blob-a", 1.4);
    fixture.matter.setDigestionProgress("blob-a", -0.4);
    expect(fixture.setRestraint).toHaveBeenLastCalledWith(1);
    expect(fixture.setDigestionProgress).toHaveBeenLastCalledWith(0);

    fixture.matter.release("blob-b");
    expect(fixture.matter.isClaimedBy("blob-a")).toBe(true);
    fixture.matter.release("blob-a");
    expect(fixture.matter.isClaimedBy("blob-a")).toBe(false);
    expect(fixture.setRestraint).toHaveBeenLastCalledWith(0);
    expect(fixture.setDigestionProgress).toHaveBeenLastCalledWith(0);
    expect(fixture.matter.tryClaim("blob-b")).toBe(true);
  });

  it("mantiene el claim al pasar de vivo a cadaver y solo entonces permite consumir", () => {
    const fixture = organicFixture({ yieldNodes: 7 });
    expect(fixture.matter.tryClaim("blob-a")).toBe(true);
    fixture.matter.setRestraint("blob-a", 0.76);

    expect(fixture.matter.consume("blob-a")).toBe(0);
    expect(fixture.matter.isAvailable()).toBe(true);
    expect(fixture.matter.isClaimedBy("blob-a")).toBe(true);

    fixture.setAlive(false);
    expect(fixture.matter.isAlive()).toBe(false);
    expect(fixture.matter.isClaimedBy("blob-a")).toBe(true);
    fixture.matter.setDigestionProgress("blob-a", 0.6);

    expect(fixture.matter.consume("blob-a")).toBe(7);
    expect(fixture.onConsumed).toHaveBeenCalledTimes(1);
    expect(fixture.setRestraint).toHaveBeenLastCalledWith(0);
    expect(fixture.setDigestionProgress).toHaveBeenLastCalledWith(1);
    expect(fixture.matter.isAvailable()).toBe(false);
    expect(fixture.matter.tryClaim("blob-b")).toBe(false);
    expect(fixture.matter.consume("blob-a")).toBe(0);
  });

  it("expone posicion viva, sanea propiedades y calcula rendimiento sin cap", () => {
    const fixture = organicFixture({
      position: new Vector3(3, 2, -4),
      radius: -1,
      mass: -20,
      yieldNodes: 3.7,
    });
    const out = new Vector3();

    expect(fixture.matter.getPosition(out)).toBe(out);
    expect(out).toEqual(new Vector3(3, 2, -4));
    fixture.position.set(-2, 0.5, 8);
    expect(fixture.matter.getPosition()).toEqual(new Vector3(-2, 0.5, 8));
    expect(fixture.matter.radius).toBe(0.05);
    expect(fixture.matter.mass).toBe(0.1);
    expect(fixture.matter.yieldNodes).toBe(4);
    expect(organicYieldForMass(6)).toBe(1);
    expect(organicYieldForMass(60)).toBe(5);
    expect(organicYieldForMass(240)).toBe(20);
  });
});

function organicFixture(
  options: {
    position?: Vector3;
    radius?: number;
    mass?: number;
    yieldNodes?: number;
  } = {},
) {
  let alive = true;
  const position = options.position?.clone() ?? new Vector3(1, 0, 2);
  const setRestraint = vi.fn();
  const setDigestionProgress = vi.fn();
  const onConsumed = vi.fn();
  const matter = new OrganicMatterController({
    id: "prey",
    characterId: "zombie",
    radius: options.radius ?? 0.35,
    mass: options.mass ?? 60,
    yieldNodes: options.yieldNodes ?? 5,
    getPosition: (out) => out.copy(position),
    isAlive: () => alive,
    setRestraint,
    setDigestionProgress,
    onConsumed,
  });
  return {
    matter,
    position,
    setAlive: (value: boolean) => {
      alive = value;
    },
    setRestraint,
    setDigestionProgress,
    onConsumed,
  };
}
