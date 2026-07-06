import type { Vector3 } from 'three';
import type { NavCell, NavEdge } from './NavCell';
import type { NavPortal } from './NavPortal';
import { AStar, type PathFilter, PERMISSIVE_FILTER } from './AStar';

const HASH_CELL_SIZE = 4;

/**
 * Una ruta concreta sobre el NavSpace. `cells` es la secuencia de indices de
 * celda inclusiva (start + goal). `portals` mapea uno-a-uno con los edges
 * cruzados — `portals[i]` es el portal usado entre `cells[i]` y `cells[i+1]`,
 * o -1 si fue una vecindad simple. `length` es la longitud euclidiana total
 * (suma de distancias entre centros).
 */
export interface NavPath {
  readonly cells: readonly number[];
  readonly portals: readonly number[];
  readonly length: number;
}

/**
 * Link runtime entre dos celdas NO adyacentes (portal gun u otro teleport).
 * Se materializa como edge dirigido `fromCell -> toCell` con un `NavPortal`
 * kind `warp` cuyo `position` es el punto de cruce fisico del lado de entrada.
 */
export interface NavDynamicLink {
  fromCell: number;
  toCell: number;
  cost: number;
  portal: NavPortal;
}

/** Extremos de un link dinamico, para la heuristica warp-aware del A*. */
export interface NavDynamicLinkEndpoints {
  fromCenter: readonly number[];
  toCenter: readonly number[];
  cost: number;
}

/**
 * Contenedor del grafo navegable post-build. No se modifica en runtime salvo
 * por las queries A* (que reusan buffers internos). Las puertas abriendose o
 * cerrandose NO modifican el grafo: el costo extra se aplica via PathFilter
 * en cada llamada a findPath.
 *
 * Spatial hash: grid 2D XZ con bucket `HASH_CELL_SIZE` (4 m). cellAt() busca
 * en el bucket del punto consultado mas los 8 vecinos. Para 20 NPCs
 * consultando ~10 Hz cada uno con niveles de ~5000 celdas esto da < 0.2 ms.
 */
export class NavSpace {
  private readonly hash = new Map<number, number[]>();
  private readonly astar = new AStar();
  // Overlay runtime sobre el grafo estatico: edges warp de la portal gun.
  private readonly dynamicEdges = new Map<number, NavEdge[]>();
  private dynamicLinkEndpoints: NavDynamicLinkEndpoints[] = [];
  private allPortals: readonly NavPortal[];

  constructor(
    private readonly cells: readonly NavCell[],
    private readonly edges: readonly NavEdge[],
    private readonly portals: readonly NavPortal[],
  ) {
    this.allPortals = portals;
    for (let i = 0; i < cells.length; i += 1) {
      const c = cells[i];
      const key = hashKey(c.center[0], c.center[2]);
      const bucket = this.hash.get(key);
      if (bucket) bucket.push(i);
      else this.hash.set(key, [i]);
    }
  }

  getCells(): readonly NavCell[] {
    return this.cells;
  }

  getEdges(): readonly NavEdge[] {
    return this.edges;
  }

  getPortals(): readonly NavPortal[] {
    return this.allPortals;
  }

  /**
   * Reemplaza el set completo de links dinamicos (idempotente; pasar [] para
   * limpiar). Los edges resultantes participan del A* como cualquier otro,
   * pero pueden cruzar componentes desconectados del grafo estatico.
   */
  setDynamicLinks(links: readonly NavDynamicLink[]): void {
    this.dynamicEdges.clear();
    const valid = links.filter(
      (link) =>
        link.fromCell >= 0 &&
        link.fromCell < this.cells.length &&
        link.toCell >= 0 &&
        link.toCell < this.cells.length &&
        link.fromCell !== link.toCell,
    );
    this.dynamicLinkEndpoints = valid.map((link) => ({
      fromCenter: this.cells[link.fromCell].center,
      toCenter: this.cells[link.toCell].center,
      cost: link.cost,
    }));
    this.allPortals =
      valid.length === 0
        ? this.portals
        : [...this.portals, ...valid.map((link) => link.portal)];
    valid.forEach((link, i) => {
      const edge: NavEdge = {
        toCell: link.toCell,
        cost: link.cost,
        portalIndex: this.portals.length + i,
      };
      const bucket = this.dynamicEdges.get(link.fromCell);
      if (bucket) bucket.push(edge);
      else this.dynamicEdges.set(link.fromCell, [edge]);
    });
  }

  hasDynamicLinks(): boolean {
    return this.dynamicEdges.size > 0;
  }

  getDynamicLinkEndpoints(): readonly NavDynamicLinkEndpoints[] {
    return this.dynamicLinkEndpoints;
  }

  getDynamicEdges(cellIndex: number): readonly NavEdge[] | undefined {
    return this.dynamicEdges.get(cellIndex);
  }

  cellCount(): number {
    return this.cells.length;
  }

  portalCount(): number {
    return this.portals.length;
  }

  /**
   * Devuelve la celda mas cercana en distancia 3D al punto, dentro de un
   * radio de busqueda razonable (~5 m). Devuelve null si no hay celda cerca
   * — el caller decide si caer en steering directo o cancelar la accion.
   */
  cellAt(pos: Vector3): NavCell | null {
    return this.cellAtRaw(pos.x, pos.y, pos.z);
  }

  cellAtRaw(x: number, y: number, z: number): NavCell | null {
    const cx = Math.floor(x / HASH_CELL_SIZE);
    const cz = Math.floor(z / HASH_CELL_SIZE);
    let best = -1;
    let bestDist = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = this.hash.get(packCoord(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const idx of bucket) {
          const c = this.cells[idx].center;
          const ex = c[0] - x;
          const ey = c[1] - y;
          const ez = c[2] - z;
          const d = ex * ex + ey * ey * 4 + ez * ez;
          if (d < bestDist) {
            bestDist = d;
            best = idx;
          }
        }
      }
    }
    return best >= 0 ? this.cells[best] : null;
  }

  findPath(from: Vector3, to: Vector3, filter: PathFilter = PERMISSIVE_FILTER): NavPath | null {
    const start = this.cellAt(from);
    let goal = this.cellAt(to);
    if (!start || !goal) return null;
    if (goal.componentId !== start.componentId) {
      // Los links warp pueden puentear componentes desconectados: intentar el
      // path directo antes de degradar el goal.
      if (this.hasDynamicLinks()) {
        const direct = this.findPathBetween(start.index, goal.index, filter);
        if (direct) return direct;
      }
      // La celda mas cercana al goal puede ser una micro-isla (tope de un
      // sandbag, techo sin acceso). En vez de fallar, ir al punto alcanzable
      // mas proximo al objetivo dentro del componente del NPC.
      goal = this.cellNearestInComponent(to, start.componentId);
      if (!goal) return null;
    }
    return this.findPathBetween(start.index, goal.index, filter);
  }

  /** Celda mas cercana al punto cuyo `componentId` coincida, en un radio de ~3 buckets (12 m). */
  cellNearestInComponent(pos: Vector3, componentId: number): NavCell | null {
    const cx = Math.floor(pos.x / HASH_CELL_SIZE);
    const cz = Math.floor(pos.z / HASH_CELL_SIZE);
    let best = -1;
    let bestDist = Infinity;
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dz = -3; dz <= 3; dz += 1) {
        const bucket = this.hash.get(packCoord(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const idx of bucket) {
          const cell = this.cells[idx];
          if (cell.componentId !== componentId) continue;
          const c = cell.center;
          const ex = c[0] - pos.x;
          const ey = c[1] - pos.y;
          const ez = c[2] - pos.z;
          const d = ex * ex + ey * ey * 4 + ez * ez;
          if (d < bestDist) {
            bestDist = d;
            best = idx;
          }
        }
      }
    }
    return best >= 0 ? this.cells[best] : null;
  }

  findPathBetween(startCell: number, goalCell: number, filter: PathFilter = PERMISSIVE_FILTER): NavPath | null {
    const indices = this.astar.findPath(this, startCell, goalCell, filter);
    if (!indices) return null;
    const portals: number[] = [];
    let length = 0;
    for (let i = 0; i < indices.length - 1; i += 1) {
      const a = this.cells[indices[i]];
      const b = this.cells[indices[i + 1]];
      portals.push(this.edgePortalIndex(a, b.index));
      const dx = a.center[0] - b.center[0];
      const dy = a.center[1] - b.center[1];
      const dz = a.center[2] - b.center[2];
      length += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return { cells: indices, portals, length };
  }

  private edgePortalIndex(from: NavCell, toIndex: number): number {
    const end = from.edgeStart + from.edgeCount;
    for (let i = from.edgeStart; i < end; i += 1) {
      if (this.edges[i].toCell === toIndex) return this.edges[i].portalIndex;
    }
    const dynamic = this.dynamicEdges.get(from.index);
    if (dynamic) {
      for (const edge of dynamic) {
        if (edge.toCell === toIndex) return edge.portalIndex;
      }
    }
    return -1;
  }
}

function hashKey(x: number, z: number): number {
  return packCoord(Math.floor(x / HASH_CELL_SIZE), Math.floor(z / HASH_CELL_SIZE));
}

function packCoord(cx: number, cz: number): number {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

