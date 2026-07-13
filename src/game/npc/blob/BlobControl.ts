import type {
  BlobControlEvent,
  BlobPoseDefinition,
} from '@engine/blob/BlobTypes';

export {
  BLOB_POSE_KINDS,
  type BlobControlEvent,
  type BlobPoseDefinition,
  type BlobPoseKind,
} from '@engine/blob/BlobTypes';

export type BlobControlCommand = 'setPose' | 'resetPose' | 'split' | 'merge';

/**
 * Cara pública del organismo para scripting. Las operaciones encolan trabajo;
 * sus finales (o errores) se obtienen con `drainEvents()` una sola vez.
 */
export interface NpcBlobControlHandle {
  /** Recibe una definición espacial: el binder ya resolvió marker/targetMarker. */
  setPose(pose: BlobPoseDefinition): void;
  resetPose(): void;
  split(components?: number): void;
  merge(): void;
  drainEvents(): BlobControlEvent[];
}
