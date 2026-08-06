import { Vector3 } from "three";
import type { RaycastSource } from "@engine/physics/Raycast";

/**
 * Oclusión y obstrucción por geometría, con la distinción que hacen Wwise y
 * FMOD:
 *
 * - **Oclusión**: no hay camino libre. Se apaga el sonido directo *y* su
 *   reverb — el emisor está en otro cuarto.
 * - **Obstrucción**: el camino directo está tapado pero el sonido llega
 *   rodeando (una caja en el medio, la esquina de un pasillo). Se filtra solo
 *   el directo; la reverb sigue entera, que es lo que da la pista de "está
 *   cerca pero no lo veo".
 *
 * Funciones puras + un scheduler; el `RaycastSource` entra inyectado, así el
 * módulo se testea con rayos sintéticos.
 */

export interface OcclusionSample {
  /** 0 = camino libre, 1 = bloqueado por completo. */
  readonly occlusion: number;
  /** 0 = directo limpio, 1 = directo totalmente tapado. */
  readonly obstruction: number;
}

export const OcclusionTuning = {
  clearHz: 20_000,
  /** Corte con oclusión total: lo que queda al otro lado de una pared. */
  occludedHz: 420,
  /** Corte con obstrucción total: apagado pero todavía inteligible. */
  obstructedHz: 1_600,
  occludedGain: 0.32,
  obstructedGain: 0.72,
  /** Separación de los rayos laterales, en metros. */
  spreadMeters: 0.55,
} as const;

const ClearSample: OcclusionSample = { occlusion: 0, obstruction: 0 };
const toSource = new Vector3();
const lateral = new Vector3();
const vertical = new Vector3();
const rayOrigin = new Vector3();
const rayTarget = new Vector3();
const rayDirection = new Vector3();
const worldUp = new Vector3(0, 1, 0);

/** Interpola en octavas: en frecuencia lo perceptible es la razón, no la resta. */
export function occlusionFilterHz(
  fraction: number,
  clearHz: number,
  blockedHz: number,
): number {
  const t = clamp01(fraction);
  return clearHz * (blockedHz / clearHz) ** t;
}

export function occlusionGain(fraction: number, blockedGain: number): number {
  return 1 - clamp01(fraction) * (1 - blockedGain);
}

/**
 * Mide el bloqueo entre oyente y fuente. Tira un rayo al centro y, solo si
 * está tapado, dos laterales: el caso común (línea de vista libre) cuesta un
 * rayo, y los tres únicamente hacen falta para separar "tapado" de "tapado
 * pero rodea".
 */
export function sampleOcclusion(
  raycast: RaycastSource,
  listener: Vector3,
  source: Vector3,
  excludeId?: string,
): OcclusionSample {
  toSource.subVectors(source, listener);
  const distance = toSource.length();
  if (distance < 1e-3) {
    return ClearSample;
  }
  rayDirection.copy(toSource).divideScalar(distance);

  if (!isBlocked(raycast, listener, rayDirection, distance, excludeId)) {
    return ClearSample;
  }

  lateral.crossVectors(rayDirection, worldUp);
  if (lateral.lengthSq() < 1e-6) {
    lateral.set(1, 0, 0);
  }
  lateral.normalize().multiplyScalar(OcclusionTuning.spreadMeters);
  vertical.crossVectors(rayDirection, lateral).normalize()
    .multiplyScalar(OcclusionTuning.spreadMeters);

  let blocked = 1;
  for (const offset of [lateral, vertical]) {
    rayOrigin.copy(listener).add(offset);
    rayTarget.copy(source).add(offset);
    const offsetDistance = rayTarget.distanceTo(rayOrigin);
    rayDirection.subVectors(rayTarget, rayOrigin).divideScalar(offsetDistance);
    if (isBlocked(raycast, rayOrigin, rayDirection, offsetDistance, excludeId)) {
      blocked += 1;
    }
  }

  // 1/3 bloqueado → solo obstruye; 3/3 → ocluye del todo.
  const fraction = blocked / 3;
  return {
    occlusion: clamp01((fraction - 1 / 3) * 1.5),
    obstruction: clamp01(fraction * 1.5),
  };
}

function isBlocked(
  raycast: RaycastSource,
  origin: Vector3,
  direction: Vector3,
  distance: number,
  excludeId?: string,
): boolean {
  const hit = raycast.cast(
    origin,
    direction,
    distance,
    undefined,
    excludeId,
    // Solo la geometría del mundo tapa: un NPC o un barril en el medio no
    // convierten el sonido en "está en otro cuarto".
    (metadata) => metadata?.kind === "static" || metadata?.kind === "door",
  );
  return hit !== null;
}

/**
 * Reparte un presupuesto fijo de sondeos por frame entre las voces vivas, en
 * round-robin. Sin esto, 30 fuentes activas serían 90 rayos por frame.
 */
export class OcclusionScheduler {
  private cursor = 0;

  constructor(private readonly probesPerFrame: number) {}

  /** Índices a refrescar este frame; recorre todas las voces en orden. */
  next(count: number): number[] {
    if (count <= 0) {
      return [];
    }
    const total = Math.min(this.probesPerFrame, count);
    const indices: number[] = [];
    for (let i = 0; i < total; i += 1) {
      indices.push(this.cursor % count);
      this.cursor += 1;
    }
    if (this.cursor >= count) {
      this.cursor %= count;
    }
    return indices;
  }

  reset(): void {
    this.cursor = 0;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
