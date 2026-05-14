import type { ProceduralAnimatorUpdate, ProceduralCharacterAnimator } from './ProceduralCharacterAnimator';

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

  update(animatorUpdates: Map<ProceduralCharacterAnimator, ProceduralAnimatorUpdate>): void {
    this.animators.forEach((animator) => {
      const update = animatorUpdates.get(animator);
      if (update) {
        animator.update(update);
      }
    });
  }
}
