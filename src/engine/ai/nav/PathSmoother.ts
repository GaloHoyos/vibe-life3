import { Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Raycast } from '@engine/physics/Raycast';
import type { NavSpace, NavPath } from './NavSpace';

const tmpDir = new Vector3();
const tmpRight = new Vector3();
const tmpFrom = new Vector3();
const tmpTo = new Vector3();
const UP = new Vector3(0, 1, 0);

export interface SmoothPathOptions {
  /** Clamp lateral de los waypoints de portal (evita rozar marcos de puerta). */
  margin?: number;
  /** Posicion real del agente: la poda arranca desde aca y elimina el "volver al centro de mi celda". */
  from?: Vector3;
  /** Si esta presente, la poda exige LOS fisico ademas del corredor de celdas. */
  raycast?: Raycast;
  /** Cuerpo propio del agente, excluido del LOS (el ray nace dentro de su capsula). */
  excludeBody?: RAPIER.RigidBody;
  /** Altura del LOS fisico sobre la superficie. */
  losHeight?: number;
}

/** Paso de muestreo del corredor al validar un atajo. */
const SAMPLE_STEP = 0.45;
/**
 * Offset lateral de los rays extra del LOS fisico (~radio de la capsula).
 * Un ray unico que roza la esquina de una baranda/marco "pasa", pero el
 * cuerpo no entra y el motor lo deja deslizando contra la cara.
 */
const LOS_LATERAL_MARGIN = 0.3;
/** Distancia horizontal maxima muestra→celda para considerar el suelo continuo. */
const CORRIDOR_TOLERANCE = 0.9;
/** Delta Y maxima entre la altura interpolada y la celda real bajo la muestra. */
const VERTICAL_TOLERANCE = 0.8;
/** Largo maximo de un atajo: corta la poda greedy antes de volverse cuadratica. */
const MAX_SHORTCUT_DISTANCE = 24;

interface RawPoint {
  point: Vector3;
  /** No podable: el waypoint sobrevive, pero se puede atajar HASTA el. */
  mandatory: boolean;
  /**
   * Barrera de poda: ni se ataja hasta el ni a traves de el. Las celdas de
   * escalera lo usan para que el NPC siga la cadena exacta (entrar por la
   * base, salir por el tope) en vez de cortar camino contra el lateral.
   */
  barrier: boolean;
}

export interface SmoothedPath {
  points: Vector3[];
  /** `stair[i]` = el waypoint i esta sobre una celda de escalera/rampa. */
  stair: boolean[];
}

/**
 * Convierte un `NavPath` en waypoints Vector3 con string-pulling en dos fases:
 * primero materializa portal points (clampeados al ancho util) y centros de
 * celda, despues poda greedy los puntos intermedios que se pueden saltear en
 * linea recta. Un atajo es valido si el corredor de celdas bajo el segmento es
 * continuo (no hay vacios: cutouts de escalera, bordes de losa) y, si hay
 * `raycast`, el LOS fisico a `losHeight` esta libre (no corta esquinas a
 * traves de paredes finas).
 */
export function smoothPathDetailed(
  navSpace: NavSpace,
  path: NavPath,
  options: SmoothPathOptions = {},
): SmoothedPath {
  const margin = options.margin ?? 0.25;
  const losHeight = options.losHeight ?? 0.9;
  const raw = buildRawPoints(navSpace, path, margin);
  if (raw.length === 0) return { points: [], stair: [] };

  const points: Vector3[] = [];
  const stair: boolean[] = [];
  let cursor: Vector3;
  let i: number;
  if (options.from) {
    cursor = options.from;
    i = 0;
  } else {
    cursor = raw[0].point;
    points.push(raw[0].point);
    stair.push(raw[0].barrier);
    i = 1;
  }

  while (i < raw.length) {
    let furthest = i;
    for (let j = i; j < raw.length; j += 1) {
      if (raw[j].barrier) {
        if (j > i) break;
      } else if (canShortcut(navSpace, cursor, raw[j].point, options, losHeight)) {
        furthest = j;
      }
      if (raw[j].mandatory) break;
    }
    points.push(raw[furthest].point);
    stair.push(raw[furthest].barrier);
    cursor = raw[furthest].point;
    i = furthest + 1;
  }
  return { points, stair };
}

export function smoothPath(
  navSpace: NavSpace,
  path: NavPath,
  options: SmoothPathOptions = {},
): Vector3[] {
  return smoothPathDetailed(navSpace, path, options).points;
}

function buildRawPoints(navSpace: NavSpace, path: NavPath, margin: number): RawPoint[] {
  const cells = navSpace.getCells();
  const portals = navSpace.getPortals();
  const raw: RawPoint[] = [];
  for (let i = 0; i < path.cells.length; i += 1) {
    const cell = cells[path.cells[i]];
    const portalIdx = i < path.portals.length ? path.portals[i] : -1;
    if (portalIdx >= 0) {
      const portal = portals[portalIdx];
      const halfWidth = Math.max(0.1, portal.width / 2 - margin);
      tmpDir.set(portal.normal[0], portal.normal[1], portal.normal[2]);
      tmpRight.crossVectors(tmpDir, UP).normalize();
      const next = cells[path.cells[i + 1]];
      const lateralDelta =
        (next.center[0] - portal.position[0]) * tmpRight.x +
        (next.center[2] - portal.position[2]) * tmpRight.z;
      const lateralOffset = Math.max(-halfWidth, Math.min(halfWidth, lateralDelta));
      raw.push({
        point: new Vector3(
          portal.position[0] + tmpRight.x * lateralOffset,
          // El portal esta centrado a media altura del hueco; el waypoint va al piso.
          Math.min(cell.center[1], next.center[1]),
          portal.position[2] + tmpRight.z * lateralOffset,
        ),
        mandatory: true,
        barrier: false,
      });
    }
    const isStair = cell.surface === 'stair';
    raw.push({
      point: new Vector3(cell.center[0], cell.center[1], cell.center[2]),
      mandatory: isStair,
      barrier: isStair,
    });
  }
  if (raw.length > 0) raw[raw.length - 1].mandatory = true;
  return raw;
}

function canShortcut(
  navSpace: NavSpace,
  a: Vector3,
  b: Vector3,
  options: SmoothPathOptions,
  losHeight: number,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > MAX_SHORTCUT_DISTANCE) return false;
  // Mas vertical que horizontal no es un atajo caminable: es el piso de
  // arriba/abajo en la misma columna (el camino real va por la escalera).
  const dy = Math.abs(b.y - a.y);
  if (dy > dist * 0.9 + 0.3) return false;
  if (dist < SAMPLE_STEP) return true;

  const steps = Math.ceil(dist / SAMPLE_STEP);
  for (let k = 1; k < steps; k += 1) {
    const t = k / steps;
    const sx = a.x + dx * t;
    const sy = a.y + (b.y - a.y) * t;
    const sz = a.z + dz * t;
    const cell = navSpace.cellAtRaw(sx, sy, sz);
    if (!cell) return false;
    const hx = cell.center[0] - sx;
    const hz = cell.center[2] - sz;
    if (hx * hx + hz * hz > CORRIDOR_TOLERANCE * CORRIDOR_TOLERANCE) return false;
    if (Math.abs(cell.center[1] - sy) > VERTICAL_TOLERANCE) return false;
  }

  if (options.raycast) {
    // Perpendicular XZ unitaria del segmento, para los rays con margen lateral.
    const rightX = dz / dist;
    const rightZ = -dx / dist;
    for (const off of [0, LOS_LATERAL_MARGIN, -LOS_LATERAL_MARGIN]) {
      tmpFrom.set(a.x + rightX * off, a.y + losHeight, a.z + rightZ * off);
      tmpTo.set(b.x + rightX * off, b.y + losHeight, b.z + rightZ * off);
      tmpDir.copy(tmpTo).sub(tmpFrom);
      const losDist = tmpDir.length();
      if (losDist <= 1e-3) continue;
      const hit = options.raycast.cast(tmpFrom, tmpDir, losDist - 0.05, options.excludeBody);
      // Solo la geometria bloquea el atajo: actores (npc/player/ragdoll) son
      // transitorios y la separacion local los esquiva en runtime.
      const kind = hit?.metadata?.kind;
      if (hit && kind !== 'door' && kind !== 'npc' && kind !== 'player' && kind !== 'ragdoll') {
        return false;
      }
    }
  }
  return true;
}
