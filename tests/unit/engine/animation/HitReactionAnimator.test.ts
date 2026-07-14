import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { HitReactionAnimator } from "@engine/animation/HitReactionAnimator";

describe("HitReactionAnimator", () => {
  it("no agrega una segunda inclinación sostenida por correr", () => {
    const root = new Object3D();
    const animator = createAnimator(root);

    animator.update({
      velocity: new Vector3(0, 0, 6),
      acceleration: new Vector3(),
      yawDelta: 0,
      balanceIntensity: 0,
      deltaTime: 1 / 60,
    });

    expect(root.rotation.x).toBe(0);
  });

  it("conserva la inclinación cuando el NPC está tropezando", () => {
    const root = new Object3D();
    const animator = createAnimator(root);

    animator.update({
      velocity: new Vector3(0, 0, 6),
      acceleration: new Vector3(),
      yawDelta: 0,
      balanceIntensity: 1,
      deltaTime: 1 / 60,
    });

    expect(root.rotation.x).toBeCloseTo(0.16);
  });
});

function createAnimator(root: Object3D): HitReactionAnimator {
  return new HitReactionAnimator(root, {
    swayStrength: 1,
    turnLagStrength: 0.08,
    flinchStrength: 0.42,
    stumbleLean: 0.16,
  });
}
