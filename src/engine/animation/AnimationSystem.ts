import type { AnimationInput } from "./AnimationInput";
import type { ProceduralCharacterAnimator } from "@engine/animation/procedural/ProceduralCharacterAnimator";

/**
 * Container plano de animators. Actualmente no se usa en runtime â€” los NPC
 * llaman directo a su `ProceduralCharacterAnimator` via `NpcAnimationBridge`.
 * Se conserva para casos batch (cinemÃ¡ticas, lod, escenas pre-render).
 */
export class AnimationSystem {
  private readonly animators = new Set<ProceduralCharacterAnimator>();

  add(animator: ProceduralCharacterAnimator): void {
    this.animators.add(animator);
  }

  remove(animator: ProceduralCharacterAnimator): void {
    this.animators.delete(animator);
  }

  clear(): void {
    this.animators.clear();
  }

  update(animatorInputs: Map<ProceduralCharacterAnimator, AnimationInput>): void {
    this.animators.forEach((animator) => {
      const input = animatorInputs.get(animator);
      if (input) {
        animator.update(input);
      }
    });
  }
}
