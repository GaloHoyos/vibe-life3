import { Vector3 } from 'three';
import type { Raycast } from '@engine/physics/Raycast';
import type { BuildingInput, BuildingDoorwayInput } from './BuildingInput';
import type { NavCell, NavEdge, NavSurface } from './NavCell';
import type { NavPortal } from './NavPortal';
import { NavSpace } from './NavSpace';

export interface NavSpaceBuildOptions {
  /** Bounds XZ donde escanear celdas. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Paso de la grilla fina (zonas de edificios). Default 0.75. */
  cellSize?: number;
  /**
   * Multiplicador del paso en area abierta (exterior lejos de edificios).
   * Las columnas gruesas viven en la misma grilla fina (indices multiplos de
   * este factor), asi el stitching fino↔grueso es buscar el primer vecino no
   * vacio a 1..coarseFactor pasos. Default 2 (1.5 m).
   */
  coarseFactor?: number;
  /** Altura desde la que se raycastea hacia abajo buscando superficies. */
  castFromY?: number;
  castDepth?: number;
  /** Delta Y maxima entre celdas vecinas para que conecten. */
  maxStepHeight?: number;
  /** Altura del LOS check entre vecinos. */
  losHeight?: number;
  /** Headroom libre minimo sobre la superficie para que un punto sea celda. */
  agentHeight?: number;
  /** Radio libre de paredes (chequeado solo en zonas refinadas). */
  agentRadius?: number;
  /** Margen alrededor del envelope de cada edificio que tambien se refina. */
  refineMargin?: number;
  /** Capas verticales maximas por columna (pisos apilados, puentes). */
  maxLayers?: number;
  /** Componentes conexas con menos celdas que esto se descartan (ruido: topes de pared, cornisas). */
  minComponentCells?: number;
}

interface ResolvedParams {
  bounds: NavSpaceBuildOptions['bounds'];
  cellSize: number;
  coarseFactor: number;
  castFromY: number;
  castDepth: number;
  maxStepHeight: number;
  losHeight: number;
  agentHeight: number;
  agentRadius: number;
  refineMargin: number;
  maxLayers: number;
  minComponentCells: number;
}

interface CellDraft {
  center: [number, number, number];
  surface: NavSurface;
  roomId: string | null;
  buildingId: string | null;
  edges: NavEdge[];
  componentId: number;
}

interface RefineZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const tmpDown = new Vector3(0, -1, 0);
const tmpUp = new Vector3(0, 1, 0);
const tmpFrom = new Vector3();
const tmpTo = new Vector3();
const tmpDir = new Vector3();
const NODE_LIFT = 0.1;
/** Separacion vertical minima entre el hit de una capa y el cast de la siguiente. */
const LAYER_SKIP = 0.3;
/** normal.y minima para considerar una superficie caminable (~49 grados). */
const MIN_WALKABLE_NORMAL_Y = 0.65;
/** Direcciones unitarias XZ para el chequeo de clearance lateral. */
const CLEARANCE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];
const NEIGHBOR_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/**
 * Delta Y que el motor puede subir como un escalon seco (stepOffset del NPC
 * ~0.4–0.45 + jitter). Por encima de esto y hasta maxStepHeight, el edge solo
 * conecta si el tramo es una pendiente real (escalera/rampa/terreno) — el
 * chequeo de punto medio descarta bordes secos: el lateral de un escalon
 * intermedio, una losa elevada, una caja alta.
 */
const DIRECT_STEP_MAX = 0.5;
/** Tolerancia entre la altura del suelo en el punto medio y el promedio de las celdas. */
const SLOPE_MIDPOINT_TOLERANCE = 0.35;

/**
 * Construye un NavSpace muestreando la geometria fisica real: cada columna XZ
 * se raycastea hacia abajo en multiples capas (pisos apilados, puentes,
 * escaleras internas) y cada hit caminable se valida con headroom y clearance
 * lateral antes de volverse celda. Las paredes interiores, escaleras, props y
 * cutouts quedan reflejados automaticamente porque la navegacion deriva de la
 * colision, no de AABBs declarados.
 *
 * Los `BuildingInput` ya no generan celdas: solo aportan semantica — zonas de
 * refinado (grilla fina dentro y alrededor del edificio), tagging de
 * room/building por AABB y portales por doorway (costo de puertas para el
 * PathFilter y metadata de breach para la IA).
 *
 * Limitaciones:
 *  - Las cajas dinamicas se tratan como obstaculo en su posicion de carga;
 *    si despues se mueven, el grafo no se actualiza (el steering local y el
 *    stuck-detection del NPC absorben la diferencia).
 *  - Sin jump portals automaticos.
 */
export class NavSpaceBuilder {
  build(
    raycast: Raycast,
    buildings: readonly BuildingInput[],
    options: NavSpaceBuildOptions,
  ): NavSpace {
    const p: ResolvedParams = {
      bounds: options.bounds,
      cellSize: options.cellSize ?? 0.75,
      coarseFactor: Math.max(1, Math.round(options.coarseFactor ?? 2)),
      castFromY: options.castFromY ?? 40,
      castDepth: options.castDepth ?? 60,
      maxStepHeight: options.maxStepHeight ?? 1.0,
      losHeight: options.losHeight ?? 0.9,
      agentHeight: options.agentHeight ?? 1.8,
      agentRadius: options.agentRadius ?? 0.34,
      refineMargin: options.refineMargin ?? 2.0,
      maxLayers: options.maxLayers ?? 4,
      minComponentCells: options.minComponentCells ?? 4,
    };
    const zones: RefineZone[] = buildings.map((b) => ({
      minX: b.envelope.min[0] - p.refineMargin,
      maxX: b.envelope.max[0] + p.refineMargin,
      minZ: b.envelope.min[2] - p.refineMargin,
      maxZ: b.envelope.max[2] + p.refineMargin,
    }));

    const drafts: CellDraft[] = [];
    const columns = new Map<number, number[]>();
    this.scanColumns(raycast, buildings, zones, p, drafts, columns);
    this.refineStairs(raycast, buildings, p, drafts, columns);
    connectNeighbors(drafts, columns, p, raycast);
    symmetrizeEdges(drafts);

    const portals: NavPortal[] = [];
    for (const b of buildings) {
      for (const doorway of b.doorways) {
        const portal = buildPortal(doorway, drafts, portals.length);
        if (portal) portals.push(portal);
      }
    }
    tagDoorwayEdges(drafts, buildings, portals);

    assignComponents(drafts);
    return finalize(drafts, portals, p.minComponentCells);
  }

  private scanColumns(
    raycast: Raycast,
    buildings: readonly BuildingInput[],
    zones: readonly RefineZone[],
    p: ResolvedParams,
    drafts: CellDraft[],
    columns: Map<number, number[]>,
  ): void {
    const cols = Math.ceil((p.bounds.maxX - p.bounds.minX) / p.cellSize);
    const rows = Math.ceil((p.bounds.maxZ - p.bounds.minZ) / p.cellSize);
    for (let iz = 0; iz <= rows; iz += 1) {
      for (let ix = 0; ix <= cols; ix += 1) {
        const x = p.bounds.minX + ix * p.cellSize;
        const z = p.bounds.minZ + iz * p.cellSize;
        const refined = inRefineZone(x, z, zones);
        if (!refined && (ix % p.coarseFactor !== 0 || iz % p.coarseFactor !== 0)) {
          continue;
        }
        const cells = this.scanColumn(raycast, buildings, x, z, refined, p, drafts);
        if (cells.length > 0) {
          columns.set(packGrid(ix, iz), cells);
        }
      }
    }
  }

  /**
   * Pase 2: toda celda 'stair'/'ramp' detectada con la grilla gruesa fuerza un
   * re-scan fino a su alrededor. En rampas empinadas el paso grueso saltea
   * escalones (dy entre muestras > maxStepHeight) y la cadena se corta; el
   * paso fino garantiza muestras con dy conectable sin pagar grilla fina en
   * todo el exterior.
   */
  private refineStairs(
    raycast: Raycast,
    buildings: readonly BuildingInput[],
    p: ResolvedParams,
    drafts: CellDraft[],
    columns: Map<number, number[]>,
  ): void {
    if (p.coarseFactor <= 1) return;
    const pad = p.cellSize * p.coarseFactor;
    const stairZones: RefineZone[] = [];
    for (const d of drafts) {
      if (d.surface !== 'stair') continue;
      stairZones.push({
        minX: d.center[0] - pad,
        maxX: d.center[0] + pad,
        minZ: d.center[2] - pad,
        maxZ: d.center[2] + pad,
      });
    }
    if (stairZones.length === 0) return;
    const cols = Math.ceil((p.bounds.maxX - p.bounds.minX) / p.cellSize);
    const rows = Math.ceil((p.bounds.maxZ - p.bounds.minZ) / p.cellSize);
    const visited = new Set<number>();
    for (const zone of stairZones) {
      const ix0 = Math.max(0, Math.floor((zone.minX - p.bounds.minX) / p.cellSize));
      const ix1 = Math.min(cols, Math.ceil((zone.maxX - p.bounds.minX) / p.cellSize));
      const iz0 = Math.max(0, Math.floor((zone.minZ - p.bounds.minZ) / p.cellSize));
      const iz1 = Math.min(rows, Math.ceil((zone.maxZ - p.bounds.minZ) / p.cellSize));
      for (let iz = iz0; iz <= iz1; iz += 1) {
        for (let ix = ix0; ix <= ix1; ix += 1) {
          const key = packGrid(ix, iz);
          if (visited.has(key) || columns.has(key)) continue;
          visited.add(key);
          const x = p.bounds.minX + ix * p.cellSize;
          const z = p.bounds.minZ + iz * p.cellSize;
          const cells = this.scanColumn(raycast, buildings, x, z, true, p, drafts);
          if (cells.length > 0) {
            columns.set(key, cells);
          }
        }
      }
    }
  }

  /** Raycastea la columna (x, z) de arriba hacia abajo capturando cada superficie caminable. */
  private scanColumn(
    raycast: Raycast,
    buildings: readonly BuildingInput[],
    x: number,
    z: number,
    refined: boolean,
    p: ResolvedParams,
    drafts: CellDraft[],
  ): number[] {
    const created: number[] = [];
    const minY = p.castFromY - p.castDepth;
    let fromY = p.castFromY;
    let casts = 0;
    const maxCasts = p.maxLayers * 4;
    while (fromY > minY && casts < maxCasts && created.length < p.maxLayers) {
      casts += 1;
      tmpFrom.set(x, fromY, z);
      const hit = raycast.cast(tmpFrom, tmpDown, fromY - minY);
      if (!hit) break;
      const y = hit.point.y;
      // La siguiente capa siempre arranca por debajo de este hit: garantiza progreso.
      fromY = Math.min(fromY, y) - LAYER_SKIP;
      const meta = hit.metadata;
      if (meta?.kind && meta.kind !== 'static') continue;
      if ((hit.normal?.y ?? 1) < MIN_WALKABLE_NORMAL_Y) continue;
      if (!this.hasHeadroom(raycast, x, y, z, p.agentHeight)) continue;
      if (refined && !this.hasClearance(raycast, x, y, z, p.agentRadius)) continue;
      const tag = tagRoom(x, y, z, buildings);
      const idx = drafts.length;
      drafts.push({
        center: [x, y + NODE_LIFT, z],
        surface: inferSurface(meta?.id),
        roomId: tag.roomId,
        buildingId: tag.buildingId,
        edges: [],
        componentId: -1,
      });
      created.push(idx);
    }
    return created;
  }

  private hasHeadroom(
    raycast: Raycast,
    x: number,
    y: number,
    z: number,
    agentHeight: number,
  ): boolean {
    tmpFrom.set(x, y + 0.1, z);
    const hit = raycast.cast(tmpFrom, tmpUp, agentHeight - 0.1);
    if (!hit) return true;
    // Los paneles de puerta no cuentan: el doorway debe quedar navegable
    // aunque la puerta este cerrada al momento del build.
    return hit.metadata?.kind === 'door';
  }

  private hasClearance(
    raycast: Raycast,
    x: number,
    y: number,
    z: number,
    agentRadius: number,
  ): boolean {
    for (const [dx, dz] of CLEARANCE_DIRS) {
      tmpFrom.set(x, y + 0.55, z);
      tmpDir.set(dx, 0, dz);
      const hit = raycast.cast(tmpFrom, tmpDir, agentRadius);
      if (hit && hit.metadata?.kind !== 'door') return false;
    }
    return true;
  }
}

function inferSurface(id: string | undefined): NavSurface {
  if (!id) return 'terrain';
  if (id.includes('roof')) return 'roof';
  if (id.includes('stair') || id.includes('ramp')) return 'stair';
  if (id.includes('floor')) return 'floor';
  return 'terrain';
}

function inRefineZone(x: number, z: number, zones: readonly RefineZone[]): boolean {
  for (const zone of zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return true;
  }
  return false;
}

function tagRoom(
  x: number,
  y: number,
  z: number,
  buildings: readonly BuildingInput[],
): { roomId: string | null; buildingId: string | null } {
  for (const b of buildings) {
    const env = b.envelope;
    if (x < env.min[0] || x > env.max[0] || z < env.min[2] || z > env.max[2]) continue;
    for (const room of b.rooms) {
      if (
        x >= room.min[0] &&
        x <= room.max[0] &&
        z >= room.min[2] &&
        z <= room.max[2] &&
        y >= room.min[1] - 0.3 &&
        y <= room.max[1] + 0.5
      ) {
        return { roomId: room.id, buildingId: b.id };
      }
    }
    // Dentro del envelope pero fuera de todo room: escalera embebida en muro,
    // techo walkable, etc. Tagueamos el building para queries de breach.
    return { roomId: null, buildingId: b.id };
  }
  return { roomId: null, buildingId: null };
}

function packGrid(ix: number, iz: number): number {
  return ((ix & 0xffff) << 16) | (iz & 0xffff);
}

function connectNeighbors(
  drafts: CellDraft[],
  columns: Map<number, number[]>,
  p: ResolvedParams,
  raycast: Raycast,
): void {
  for (const [key, cellIdxs] of columns) {
    const ix = (key >> 16) & 0xffff;
    const iz = key & 0xffff;
    for (const fromIdx of cellIdxs) {
      const from = drafts[fromIdx];
      for (const [dx, dz] of NEIGHBOR_DIRS) {
        // Busca hacia afuera hasta lograr UNA conexion: a 1 paso (vecino fino)
        // o hasta coarseFactor pasos (stitching con la grilla gruesa). Una
        // columna no vacia pero sin capa compatible (ej. solo tiene celdas de
        // techo) no corta la busqueda.
        for (let step = 1; step <= p.coarseFactor; step += 1) {
          const neighborCol = columns.get(packGrid(ix + dx * step, iz + dz * step));
          if (!neighborCol) continue;
          let best = -1;
          let bestDy = Infinity;
          for (const candidate of neighborCol) {
            const dy = Math.abs(from.center[1] - drafts[candidate].center[1]);
            if (dy < bestDy) {
              bestDy = dy;
              best = candidate;
            }
          }
          if (best >= 0 && bestDy <= p.maxStepHeight) {
            const to = drafts[best];
            const traversable =
              bestDy <= DIRECT_STEP_MAX || isSlopeBetween(raycast, from, to);
            if (traversable && losClear(from, to, raycast, p.losHeight)) {
              from.edges.push({ toCell: best, cost: edgeCost(from, to), portalIndex: -1 });
              break;
            }
          }
        }
      }
    }
  }
}

/**
 * La seleccion de vecinos puede ser asimetrica (cada celda elige la primera
 * columna conectable hacia afuera, y A y B pueden elegir columnas distintas).
 * Un grafo dirigido asimetrico rompe A* segun la direccion de la query, asi
 * que todo edge a→b gana su reverso b→a. El LOS ya validado es simetrico
 * (mismo par de puntos), por lo que el reverso no necesita re-chequeo.
 */
function symmetrizeEdges(drafts: CellDraft[]): void {
  const n = drafts.length;
  const seen = new Set<number>();
  for (let a = 0; a < n; a += 1) {
    for (const e of drafts[a].edges) {
      seen.add(a * n + e.toCell);
    }
  }
  const missing: Array<{ from: number; to: number; cost: number; portalIndex: number }> = [];
  for (let a = 0; a < n; a += 1) {
    for (const e of drafts[a].edges) {
      if (!seen.has(e.toCell * n + a)) {
        seen.add(e.toCell * n + a);
        missing.push({ from: e.toCell, to: a, cost: e.cost, portalIndex: e.portalIndex });
      }
    }
  }
  for (const m of missing) {
    drafts[m.from].edges.push({ toCell: m.to, cost: m.cost, portalIndex: m.portalIndex });
  }
}

/**
 * Un edge empinado es transitable solo si el suelo del punto medio acompana la
 * pendiente (escalera muestreada a sub-paso, rampa, ladera). Si el punto medio
 * sigue a la altura de la celda baja (o ya esta a la de la alta) es un borde
 * seco que el stepOffset del motor no sube.
 */
function isSlopeBetween(raycast: Raycast, a: CellDraft, b: CellDraft): boolean {
  const midX = (a.center[0] + b.center[0]) / 2;
  const midZ = (a.center[2] + b.center[2]) / 2;
  const topY = Math.max(a.center[1], b.center[1]) + 1.0;
  tmpFrom.set(midX, topY, midZ);
  const hit = raycast.cast(tmpFrom, tmpDown, 4.0);
  if (!hit) return false;
  const expected = (a.center[1] + b.center[1]) / 2;
  return Math.abs(hit.point.y - expected) <= SLOPE_MIDPOINT_TOLERANCE;
}

function losClear(a: CellDraft, b: CellDraft, raycast: Raycast, losHeight: number): boolean {
  tmpFrom.set(a.center[0], a.center[1] + losHeight, a.center[2]);
  tmpTo.set(b.center[0], b.center[1] + losHeight, b.center[2]);
  tmpDir.copy(tmpTo).sub(tmpFrom);
  const dist = tmpDir.length();
  if (dist < 1e-3) return true;
  const hit = raycast.cast(tmpFrom, tmpDir, dist - 0.05);
  if (!hit) return true;
  return hit.metadata?.kind === 'door';
}

function edgeCost(a: CellDraft, b: CellDraft): number {
  const dx = a.center[0] - b.center[0];
  const dy = a.center[1] - b.center[1];
  const dz = a.center[2] - b.center[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function buildPortal(
  doorway: BuildingDoorwayInput,
  drafts: CellDraft[],
  portalIndex: number,
): NavPortal | null {
  const [roomA, roomB] = doorway.rooms;
  const sideA = findNearestCellForDoorway(drafts, doorway, roomA);
  const sideB = findNearestCellForDoorway(drafts, doorway, roomB);
  if (sideA < 0 || sideB < 0 || sideA === sideB) return null;
  const cost = 0.5 + edgeCost(drafts[sideA], drafts[sideB]);
  drafts[sideA].edges.push({ toCell: sideB, cost, portalIndex });
  drafts[sideB].edges.push({ toCell: sideA, cost, portalIndex });
  return {
    id: doorway.id,
    kind: doorway.doorId ? 'door' : 'open',
    width: doorway.width,
    height: doorway.height,
    position: [doorway.position[0], doorway.position[1], doorway.position[2]],
    normal: [doorway.normal[0], doorway.normal[1], doorway.normal[2]],
    doorId: doorway.doorId,
  };
}

function findNearestCellForDoorway(
  drafts: CellDraft[],
  doorway: BuildingDoorwayInput,
  roomId: string | null,
): number {
  const maxDist2 = 36;
  let best = -1;
  let bestDist = maxDist2;
  const doorBaseY = doorway.position[1] - doorway.height / 2;
  for (let i = 0; i < drafts.length; i += 1) {
    const c = drafts[i];
    if (c.roomId !== roomId) continue;
    const dy = c.center[1] - doorBaseY;
    if (dy < -1.0 || dy > 2.0) continue;
    const dx = c.center[0] - doorway.position[0];
    const dz = c.center[2] - doorway.position[2];
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Los edges de grilla que cruzan un doorway nacen con `portalIndex = -1`
 * (la conexion la creo el scan fisico, no el portal). Para que el PathFilter
 * pueda cobrar el costo de una puerta cerrada, todo edge que cambia de room
 * cerca de un doorway hereda su portalIndex.
 */
function tagDoorwayEdges(
  drafts: CellDraft[],
  buildings: readonly BuildingInput[],
  portals: readonly NavPortal[],
): void {
  if (portals.length === 0) return;
  const doorways: Array<{ portalIndex: number; doorway: BuildingDoorwayInput }> = [];
  let portalCursor = 0;
  for (const b of buildings) {
    for (const doorway of b.doorways) {
      if (portalCursor < portals.length && portals[portalCursor].id === doorway.id) {
        doorways.push({ portalIndex: portalCursor, doorway });
        portalCursor += 1;
      }
    }
  }
  for (const draft of drafts) {
    for (const edge of draft.edges) {
      if (edge.portalIndex >= 0) continue;
      const other = drafts[edge.toCell];
      if (draft.roomId === other.roomId && draft.buildingId === other.buildingId) continue;
      const midX = (draft.center[0] + other.center[0]) / 2;
      const midY = (draft.center[1] + other.center[1]) / 2;
      const midZ = (draft.center[2] + other.center[2]) / 2;
      for (const { portalIndex, doorway } of doorways) {
        const reach = Math.max(doorway.width / 2 + 0.6, 1.2);
        const dx = midX - doorway.position[0];
        const dz = midZ - doorway.position[2];
        const dy = midY - (doorway.position[1] - doorway.height / 2);
        if (dx * dx + dz * dz <= reach * reach && dy >= -1.0 && dy <= 2.0) {
          edge.portalIndex = portalIndex;
          break;
        }
      }
    }
  }
}

function assignComponents(drafts: CellDraft[]): void {
  const comp = new Int32Array(drafts.length).fill(-1);
  let next = 0;
  const queue: number[] = [];
  for (let start = 0; start < drafts.length; start += 1) {
    if (comp[start] !== -1) continue;
    const id = next++;
    comp[start] = id;
    queue.length = 0;
    queue.push(start);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const e of drafts[current].edges) {
        if (comp[e.toCell] !== -1) continue;
        comp[e.toCell] = id;
        queue.push(e.toCell);
      }
    }
  }
  for (let i = 0; i < drafts.length; i += 1) {
    drafts[i].componentId = comp[i];
  }
}

function finalize(
  drafts: CellDraft[],
  portals: NavPortal[],
  minComponentCells: number,
): NavSpace {
  const componentSize = new Map<number, number>();
  for (const d of drafts) {
    componentSize.set(d.componentId, (componentSize.get(d.componentId) ?? 0) + 1);
  }
  const remap = new Int32Array(drafts.length).fill(-1);
  let kept = 0;
  for (let i = 0; i < drafts.length; i += 1) {
    if ((componentSize.get(drafts[i].componentId) ?? 0) >= minComponentCells) {
      remap[i] = kept;
      kept += 1;
    }
  }

  const cells: NavCell[] = [];
  const edges: NavEdge[] = [];
  for (let i = 0; i < drafts.length; i += 1) {
    if (remap[i] < 0) continue;
    const d = drafts[i];
    const edgeStart = edges.length;
    let edgeCount = 0;
    for (const e of d.edges) {
      if (remap[e.toCell] < 0) continue;
      edges.push({ toCell: remap[e.toCell], cost: e.cost, portalIndex: e.portalIndex });
      edgeCount += 1;
    }
    cells.push({
      index: remap[i],
      center: d.center,
      surface: d.surface,
      roomId: d.roomId,
      buildingId: d.buildingId,
      componentId: d.componentId,
      edgeStart,
      edgeCount,
    });
  }
  return new NavSpace(cells, edges, portals);
}
