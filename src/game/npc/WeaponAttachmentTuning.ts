import type { Object3D } from "three";

/**
 * Override mutable del attachment de armas a las manos de NPCs.
 * Los valores acá se aplican en runtime sobre el `weaponModel` adjuntado,
 * permitiendo tuneo visual via el panel de debug.
 *
 * `worldScale` es el tamaño visual en metros mundo (se compensa por la
 * escala acumulada del esqueleto antes de aplicar como local scale).
 */
export interface WeaponAttachmentPose {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  worldScale: number;
}

export type WeaponAttachmentKey = "ar3" | "pistol" | "smg" | "crowbar";

export const WeaponAttachmentTuning: Record<WeaponAttachmentKey, WeaponAttachmentPose> = {
  ar3: {
    positionX: 0.06,
    positionY: 0.2,
    positionZ: 0,
    rotationX: 0.1,
    rotationY: 0.22,
    rotationZ: -1.57,
    worldScale: 0.38,
  },
  pistol: {
    positionX: -0.01,
    positionY: 0.23,
    positionZ: 0.02,
    rotationX: 0.15,
    rotationY: 0.22,
    rotationZ: -1.31,
    worldScale: 0.13,
  },
  smg: {
    positionX: 0,
    positionY: 0.11,
    positionZ: 0,
    rotationX: 0,
    rotationY: Math.PI / 2,
    rotationZ: -Math.PI / 2,
    worldScale: 0.28,
  },
  crowbar: {
    positionX: 0,
    positionY: 0.11,
    positionZ: 0,
    rotationX: 0.15,
    rotationY: -Math.PI / 2 - 0.35,
    rotationZ: -0.22,
    worldScale: 0.28,
  },
};

interface RegisteredAttachment {
  weapon: Object3D;
  weaponId: WeaponAttachmentKey;
  /** Escala acumulada del parent (1 si no hay bone parent con scale). */
  accumulatedScale: number;
  /** `'hand'` aplica position/rotation/scale; `'pickup'` solo scale. */
  kind: "hand" | "pickup";
}

const REGISTRY = new Set<RegisteredAttachment>();

export function registerAttachment(entry: RegisteredAttachment): () => void {
  REGISTRY.add(entry);
  return () => {
    REGISTRY.delete(entry);
  };
}

export function applyAttachmentTuning(): void {
  for (const entry of REGISTRY) {
    applyToAttachment(entry);
  }
}

export function applyToAttachment(entry: RegisteredAttachment): void {
  const tuning = WeaponAttachmentTuning[entry.weaponId];
  if (!tuning) return;

  if (entry.kind === "pickup") {
    entry.weapon.scale.setScalar(tuning.worldScale);
    return;
  }

  const scaleFactor = entry.accumulatedScale > 0 ? entry.accumulatedScale : 1;
  entry.weapon.position
    .set(tuning.positionX, tuning.positionY, tuning.positionZ)
    .divideScalar(scaleFactor);
  entry.weapon.rotation.set(tuning.rotationX, tuning.rotationY, tuning.rotationZ);
  const localScale =
    entry.accumulatedScale > 0
      ? tuning.worldScale / entry.accumulatedScale
      : tuning.worldScale;
  entry.weapon.scale.setScalar(localScale);
}

export function isWeaponAttachmentKey(id: string): id is WeaponAttachmentKey {
  return id in WeaponAttachmentTuning;
}

export type { RegisteredAttachment };
