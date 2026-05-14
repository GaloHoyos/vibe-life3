import type { BoneMapper } from './BoneMapper';
import type { ProceduralAnimationState } from './ProceduralCharacterAnimator';

export interface AnimationDebugSnapshot {
  state: ProceduralAnimationState;
  ragdollActive: boolean;
  ragdollBodies: number;
  foundBones: string[];
  missingBones: string[];
}

export class AnimationDebug {
  private enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  logMapping(mapper: BoneMapper): void {
    if (!this.enabled) {
      return;
    }

    console.info('[AnimationDebug] Bones found:', mapper.getFoundNames());
    console.info('[AnimationDebug] Bones missing:', mapper.getMissingNames());
  }

  snapshot(snapshot: AnimationDebugSnapshot): void {
    if (!this.enabled) {
      return;
    }

    console.info('[AnimationDebug] Snapshot:', snapshot);
  }
}
