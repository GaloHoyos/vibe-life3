import type { NavEdge } from './NavCell';
import type { NavPortal } from './NavPortal';
import type { NavSpace } from './NavSpace';
import { BinaryHeap } from './BinaryHeap';

export interface PathFilter {
  /**
   * Decide si un edge es transitable. Por default todos lo son; un preset
   * sin `canJump` rechaza portales `jump`, etc.
   */
  canTraverse(edge: NavEdge, portal: NavPortal | null): boolean;
  /** Costo extra opcional (ej. puerta cerrada → +0.5). */
  extraCost?(edge: NavEdge, portal: NavPortal | null): number;
}

export const PERMISSIVE_FILTER: PathFilter = {
  canTraverse: () => true,
};

/**
 * A* sobre NavSpace. Reusa buffers internos entre llamadas para evitar GC
 * pressure cuando 30 NPCs piden paths secuencialmente. No thread-safe — si
 * fuera necesario en el futuro, instanciar un AStar por worker.
 *
 * Devuelve la lista ordenada de indices de celda desde `startCell` hasta
 * `goalCell` (inclusive ambos), o `null` si no hay camino. La heuristica es
 * Octile 3D — admisible y eficiente para grids con diagonales.
 */
export class AStar {
  private readonly heap = new BinaryHeap();
  private gScore: Float32Array = new Float32Array(0);
  private cameFrom: Int32Array = new Int32Array(0);
  private closed: Uint8Array = new Uint8Array(0);
  private generation = 0;
  private gen: Uint32Array = new Uint32Array(0);

  findPath(
    navSpace: NavSpace,
    startCell: number,
    goalCell: number,
    filter: PathFilter = PERMISSIVE_FILTER,
  ): number[] | null {
    const cells = navSpace.getCells();
    const edges = navSpace.getEdges();
    const portals = navSpace.getPortals();
    const n = cells.length;
    if (startCell < 0 || startCell >= n || goalCell < 0 || goalCell >= n) return null;
    if (startCell === goalCell) return [startCell];
    // Los links dinamicos (warp) pueden puentear componentes: el early-out por
    // componente solo vale sobre el grafo estatico puro.
    if (
      cells[startCell].componentId !== cells[goalCell].componentId &&
      !navSpace.hasDynamicLinks()
    ) {
      return null;
    }

    this.ensureCapacity(n);
    const gen = ++this.generation;
    this.heap.clear();

    const goal = cells[goalCell].center;
    const start = cells[startCell].center;
    // Heuristica warp-aware: un link warp acorta el espacio, asi que la octile
    // directa puede SOBREestimar el costo real (inadmisible) y el A* elegiria
    // el camino largo a pie aunque el portal sea mas corto. El minimo con la
    // ruta "hasta la entrada + costo del warp + desde la salida" restaura la
    // admisibilidad (un nivel alcanza: usar los dos links del par es ida y
    // vuelta, nunca mas corto).
    const warps = navSpace.getDynamicLinkEndpoints();
    const estimate =
      warps.length === 0
        ? (center: readonly number[]): number => heuristic(center, goal)
        : (center: readonly number[]): number => {
            let best = heuristic(center, goal);
            for (const warp of warps) {
              const viaWarp =
                heuristic(center, warp.fromCenter) +
                warp.cost +
                heuristic(warp.toCenter, goal);
              if (viaWarp < best) best = viaWarp;
            }
            return best;
          };
    this.gScore[startCell] = 0;
    this.cameFrom[startCell] = -1;
    this.gen[startCell] = gen;
    // Sin esto, un closed=1 stale de una query anterior descarta el start en
    // el primer pop (gen ya coincide) y el path falla deterministicamente.
    this.closed[startCell] = 0;
    this.heap.push(startCell, estimate(start));

    // Una sola closure por query (no por nodo): lee `current` de la variable
    // mutada por el while, preservando el diseño sin allocations del A*.
    let current = -1;
    const relax = (edge: NavEdge): void => {
      const portal = edge.portalIndex >= 0 ? portals[edge.portalIndex] : null;
      if (!filter.canTraverse(edge, portal)) return;
      const cost = edge.cost + (filter.extraCost?.(edge, portal) ?? 0);
      const tentative = this.gScore[current] + cost;
      const neighbor = edge.toCell;
      if (this.gen[neighbor] !== gen) {
        this.gen[neighbor] = gen;
        this.gScore[neighbor] = Infinity;
        this.closed[neighbor] = 0;
      }
      if (tentative >= this.gScore[neighbor]) return;
      this.gScore[neighbor] = tentative;
      this.cameFrom[neighbor] = current;
      const f = tentative + estimate(cells[neighbor].center);
      this.heap.push(neighbor, f);
    };

    while (this.heap.size() > 0) {
      current = this.heap.pop();
      if (current === goalCell) {
        return reconstruct(this.cameFrom, goalCell);
      }
      if (this.closed[current] === 1 && this.gen[current] === gen) continue;
      this.closed[current] = 1;

      const cell = cells[current];
      const end = cell.edgeStart + cell.edgeCount;
      for (let i = cell.edgeStart; i < end; i += 1) {
        relax(edges[i]);
      }
      const dynamic = navSpace.getDynamicEdges(current);
      if (dynamic) {
        for (const edge of dynamic) {
          relax(edge);
        }
      }
    }
    return null;
  }

  private ensureCapacity(n: number): void {
    if (this.gScore.length >= n) return;
    const grown = Math.max(n, this.gScore.length * 2);
    this.gScore = new Float32Array(grown);
    this.cameFrom = new Int32Array(grown);
    this.closed = new Uint8Array(grown);
    this.gen = new Uint32Array(grown);
  }
}

function heuristic(a: readonly number[], b: readonly number[]): number {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  const dz = Math.abs(a[2] - b[2]);
  const min = Math.min(dx, dz);
  const max = Math.max(dx, dz);
  return max + (Math.SQRT2 - 1) * min + dy;
}

function reconstruct(cameFrom: Int32Array, goal: number): number[] {
  const path: number[] = [];
  let current = goal;
  while (current !== -1) {
    path.push(current);
    current = cameFrom[current];
  }
  path.reverse();
  return path;
}
