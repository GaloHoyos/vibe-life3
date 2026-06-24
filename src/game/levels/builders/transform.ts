import { Euler, Quaternion, Vector3 } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type {
  DynamicBoxDefinition,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import type { BuildingArtifact, BuildingEnvelope, Doorway, Room } from '@game/levels/buildings/BuildingArtifact';

/**
 * Horneado de rotacion para la geometria que producen los builders multi-caja
 * (edificios/casas/rampas/props). Rota cada caja alrededor de un pivote comun y
 * le compone su orientacion, manteniendo el `LevelDefinition` como datos planos
 * (sin un concepto de "grupo" en runtime; la nav deriva de la colision rotada).
 *
 * Para los AABB semanticos (`rooms`/`envelope`, que la IA usa para tagging) se
 * recalcula el bounding box de las 8 esquinas rotadas: exacto en multiplos de
 * 90 grados, conservador (agrandado) en angulos libres — preferible a un AABB
 * mal orientado. Ver el caveat de rotacion de edificios.
 */

export function quatFromEuler(euler: VectorTuple): Quaternion {
  return new Quaternion().setFromEuler(new Euler(euler[0], euler[1], euler[2]));
}

export function isIdentityRotation(euler: VectorTuple | undefined): boolean {
  return !euler || (euler[0] === 0 && euler[1] === 0 && euler[2] === 0);
}

const tmpPivot = new Vector3();

function rotatePoint(point: VectorTuple, pivot: Vector3, quat: Quaternion): VectorTuple {
  const v = new Vector3(point[0], point[1], point[2]).sub(pivot).applyQuaternion(quat).add(pivot);
  return [v.x, v.y, v.z];
}

function rotateDirection(dir: VectorTuple, quat: Quaternion): VectorTuple {
  const v = new Vector3(dir[0], dir[1], dir[2]).applyQuaternion(quat);
  return [v.x, v.y, v.z];
}

/** Euler del producto `delta ∘ existente`, para componer la orientacion propia de la caja. */
function composeEuler(existing: VectorTuple | undefined, delta: Quaternion): VectorTuple {
  const base = existing ? quatFromEuler(existing) : new Quaternion();
  const combined = delta.clone().multiply(base);
  const e = new Euler().setFromQuaternion(combined);
  return [e.x, e.y, e.z];
}

function rotateBox<T extends StaticBoxDefinition | DynamicBoxDefinition>(
  box: T,
  pivot: Vector3,
  quat: Quaternion,
): T {
  return {
    ...box,
    position: rotatePoint(box.position, pivot, quat),
    rotation: composeEuler(box.rotation, quat),
  };
}

export function rotateBoxesAbout<T extends StaticBoxDefinition | DynamicBoxDefinition>(
  boxes: readonly T[],
  pivot: VectorTuple,
  euler: VectorTuple,
): T[] {
  if (isIdentityRotation(euler)) return [...boxes];
  const p = tmpPivot.set(pivot[0], pivot[1], pivot[2]).clone();
  const quat = quatFromEuler(euler);
  return boxes.map((box) => rotateBox(box, p, quat));
}

function rotateAabb(min: VectorTuple, max: VectorTuple, pivot: Vector3, quat: Quaternion): { min: VectorTuple; max: VectorTuple } {
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i += 1) {
    const corner = new Vector3(
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    )
      .sub(pivot)
      .applyQuaternion(quat)
      .add(pivot);
    lo.min(corner);
    hi.max(corner);
  }
  return { min: [lo.x, lo.y, lo.z], max: [hi.x, hi.y, hi.z] };
}

export function rotateArtifact(
  artifact: BuildingArtifact,
  pivot: VectorTuple,
  euler: VectorTuple,
): BuildingArtifact {
  if (isIdentityRotation(euler)) return artifact;
  const p = new Vector3(pivot[0], pivot[1], pivot[2]);
  const quat = quatFromEuler(euler);
  const rooms: Room[] = artifact.rooms.map((room) => ({
    ...room,
    ...rotateAabb(room.min, room.max, p, quat),
  }));
  const doorways: Doorway[] = artifact.doorways.map((d) => ({
    ...d,
    position: rotatePoint(d.position, p, quat),
    normal: rotateDirection(d.normal, quat),
  }));
  const envelope: BuildingEnvelope = rotateAabb(artifact.envelope.min, artifact.envelope.max, p, quat);
  return {
    ...artifact,
    boxes: artifact.boxes.map((box) => rotateBox(box, p, quat)),
    rooms,
    doorways,
    envelope,
  };
}
