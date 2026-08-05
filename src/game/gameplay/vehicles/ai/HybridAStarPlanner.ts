import type {
  VehicleHybridPath,
  VehicleHybridPathPoint,
  VehicleNavigationProfile,
  VehicleNavGrid,
  VehicleNavPoint,
  VehiclePose2D,
} from './VehicleAiTypes';
import {
  headingToVector,
  normalizeAngle,
  planarDistance,
} from './VehicleAiMath';
import { NO_ROW, VehicleNavGridIndex } from './VehicleNavGridIndex';
import { dubinsShortestPath } from './VehicleDubins';

export const VEHICLE_HYBRID_HEADING_COUNT = 16;
const HEADING_STEP = (Math.PI * 2) / VEHICLE_HYBRID_HEADING_COUNT;

export interface HybridAStarOptions {
  maxExpandedStates?: number;
  goalTolerance?: number;
  headingTolerance?: number;
  reversePenalty?: number;
  directionChangePenalty?: number;
  steeringPenalty?: number;
  /**
   * Estorbos que no están en el bake: otros vehículos, puertas cerradas,
   * chatarra. Vedan celdas para esta búsqueda y nada más, sin rehornear.
   */
  blockers?: readonly VehicleNavBlocker[];
  /**
   * Atajo de Dubins hacia el objetivo. Encendido por defecto; apagarlo deja la
   * salida cuantizada a los 16 rumbos de la búsqueda, que es lo que hace falta
   * para verificar la búsqueda en sí.
   */
  analyticExpansion?: boolean;
}

export interface VehicleNavBlocker {
  position: VehicleNavPoint;
  radius: number;
}

const NO_BLOCKERS: ReadonlySet<number> = new Set();
/** Desnivel perdonado entre celdas vecinas, igual que en el bake: un cordón. */
const STEP_TOLERANCE = 0.25;
/**
 * Tope del campo de consultas. Más lejos que esto la comparación "vehículo o a
 * pie" ya no decide nada: ninguna de las dos opciones es razonable.
 */
const MAX_QUERY_DISTANCE = 400;
/** Cada cuántas expansiones se prueba el atajo analítico lejos del objetivo. */
const ANALYTIC_ATTEMPT_INTERVAL = 25;
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

interface SearchState {
  key: string;
  row: number;
  position: VehicleNavPoint;
  headingIndex: number;
  direction: 1 | -1;
  cost: number;
}

interface PreviousState {
  key: string;
}

export class HybridAStarPlanner {
  private readonly cells: VehicleNavGridIndex;
  private readonly cellSize: number;
  private readonly minimumCellCost: number;
  /** Reutilizado entre planes: reservarlo por llamada cuesta medio mega. */
  private readonly field: Float64Array;
  /** Campo de las consultas de distancia, cacheado por celda de destino. */
  private readonly queryField: Float64Array;
  private queryGoalRow = NO_ROW;
  private blocked: ReadonlySet<number> = NO_BLOCKERS;

  constructor(grid: VehicleNavGrid, private readonly profile: VehicleNavigationProfile) {
    this.cells = new VehicleNavGridIndex(grid);
    this.cellSize = grid.cellSize;
    this.minimumCellCost = this.cells.minimumCost;
    this.field = new Float64Array(this.cells.count);
    this.queryField = new Float64Array(this.cells.count);
  }

  /** Si el segmento recto entre dos puntos queda entero sobre terreno manejable. */
  isClearBetween(from: VehicleNavPoint, to: VehicleNavPoint): boolean {
    const steps = Math.max(
      1,
      Math.ceil(planarDistance(from, to) / (this.cellSize * 0.45)),
    );
    for (let step = 0; step <= steps; step += 1) {
      const alpha = step / steps;
      if (
        this.containingRow(
          from[0] + (to[0] - from[0]) * alpha,
          from[2] + (to[2] - from[2]) * alpha,
        ) === NO_ROW
      ) {
        return false;
      }
    }
    return true;
  }

  /** Islas de conectividad del bake: `false` significa "no se llega manejando". */
  isReachable(from: VehicleNavPoint, to: VehicleNavPoint): boolean {
    const fromRow = this.cells.nearestRow(from, this.cellSize * 2.5);
    const toRow = this.cells.nearestRow(to, this.cellSize * 2.5);
    if (fromRow === NO_ROW || toRow === NO_ROW) return false;
    return this.cells.component(fromRow) === this.cells.component(toRow);
  }

  /**
   * Largo del recorrido manejable entre dos puntos, sin resolver la cinemática.
   * Es lo que responde "¿me conviene el vehículo o voy a pie?": el Hybrid A*
   * completo es demasiado caro para una pregunta que se hace cada medio segundo.
   *
   * El campo se cachea por celda de destino porque el caso normal es varios NPCs
   * midiendo contra el mismo blanco: el primero lo paga y el resto lee.
   */
  travelDistance(from: VehicleNavPoint, to: VehicleNavPoint): number | null {
    const fromRow = this.cells.nearestRow(from, this.cellSize * 2.5);
    const toRow = this.cells.nearestRow(to, this.cellSize * 2.5);
    if (fromRow === NO_ROW || toRow === NO_ROW) return null;
    if (this.cells.component(fromRow) !== this.cells.component(toRow)) return null;
    if (this.queryGoalRow !== toRow) {
      fillDistanceField(
        this.queryField,
        this.cells,
        this.profile,
        toRow,
        NO_ROW,
        NO_BLOCKERS,
        MAX_QUERY_DISTANCE,
      );
      this.queryGoalRow = toRow;
    }
    const distance = this.queryField[fromRow] ?? Infinity;
    return Number.isFinite(distance) ? distance : null;
  }

  plan(
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options: HybridAStarOptions = {},
  ): VehicleHybridPath | null {
    this.blocked = this.blockedRows(options.blockers);
    const startRow = this.freeRow(start.position, this.cellSize * 2.5);
    const goalRow = this.freeRow(goal.position, this.cellSize * 2.5);
    if (startRow === NO_ROW || goalRow === NO_ROW) return null;
    // Dos islas distintas no se conectan manejando: sale gratis y evita quemar
    // los 20.000 estados barriendo un componente entero para no llegar.
    if (this.cells.component(startRow) !== this.cells.component(goalRow)) return null;
    const goalPosition = this.cells.position(goalRow);
    if (!this.buildDistanceField(goalRow, startRow)) return null;

    const startHeading = headingIndex(start.heading);
    const startState: SearchState = {
      key: stateKey(startRow, startHeading, 1),
      row: startRow,
      position: this.cells.position(startRow),
      headingIndex: startHeading,
      direction: 1,
      cost: 0,
    };
    const open = new StateQueue();
    const states = new Map<string, SearchState>([[startState.key, startState]]);
    const previous = new Map<string, PreviousState>();
    const costs = new Map<string, number>([[startState.key, 0]]);
    open.push(startState.key, this.heuristic(startRow, startState.position, goalPosition), 0);

    const maximumExpandedStates = Math.max(64, options.maxExpandedStates ?? 20_000);
    const goalTolerance = Math.max(
      this.cellSize,
      options.goalTolerance ?? this.cellSize * 1.5,
    );
    const headingTolerance = Math.max(
      HEADING_STEP,
      options.headingTolerance ?? HEADING_STEP * 1.5,
    );
    const analyticRange = this.profile.minTurnRadius * 4;
    let expandedStates = 0;
    let best = startState;
    let bestDistance = planarDistance(startState.position, goalPosition);

    while (open.size > 0 && expandedStates < maximumExpandedStates) {
      const queued = open.pop();
      if (!queued) break;
      const current = states.get(queued.key);
      if (!current) continue;
      if (queued.pathCost > (costs.get(current.key) ?? Infinity) + 1e-8) continue;
      expandedStates += 1;
      const distanceToGoal = planarDistance(current.position, goalPosition);
      if (distanceToGoal < bestDistance) {
        best = current;
        bestDistance = distanceToGoal;
      }
      if (
        distanceToGoal <= goalTolerance &&
        Math.abs(normalizeAngle(indexHeading(current.headingIndex) - goal.heading)) <= headingTolerance
      ) {
        return reconstruct(current, previous, states, this.cells, expandedStates, true);
      }

      // Expansión analítica: cerca del objetivo, intentar cerrar de una sola vez
      // con una curva exacta en vez de seguir expandiendo. Es lo que permite
      // clavar el heading pedido sin gastar cientos de estados en el último
      // tramo, donde la cuantización a 16 rumbos es más grosera que la
      // tolerancia.
      if (
        options.analyticExpansion !== false &&
        current.direction > 0 &&
        (distanceToGoal <= analyticRange || expandedStates % ANALYTIC_ATTEMPT_INTERVAL === 0)
      ) {
        const tail = this.analyticShot(current, goalPosition, goal.heading);
        if (tail) {
          return reconstruct(current, previous, states, this.cells, expandedStates, true, tail);
        }
      }

      for (const successor of this.successors(current, options)) {
        const knownCost = costs.get(successor.key);
        if (knownCost !== undefined && successor.cost >= knownCost - 1e-8) continue;
        costs.set(successor.key, successor.cost);
        states.set(successor.key, successor);
        previous.set(successor.key, { key: current.key });
        open.push(
          successor.key,
          successor.cost +
            this.heuristic(successor.row, successor.position, goalPosition),
          successor.cost,
        );
      }
    }

    if (best.key === startState.key) return null;
    return reconstruct(best, previous, states, this.cells, expandedStates, false);
  }

  private successors(
    state: SearchState,
    options: HybridAStarOptions,
  ): SearchState[] {
    const successors: SearchState[] = [];
    const directions: readonly (1 | -1)[] = this.profile.reverseAllowed &&
        !this.cells.hasFlag(state.row, 'noReverse')
      ? [1, -1]
      : [1];
    for (const direction of directions) {
      for (const steering of [-1, 0, 1] as const) {
        const next = this.advance(state, direction, steering);
        if (!next || (direction < 0 && this.cells.hasFlag(next.row, 'noReverse'))) continue;
        const travelDistance = planarDistance(state.position, next.position);
        const reversePenalty = direction < 0 ? options.reversePenalty ?? 1.35 : 1;
        const directionPenalty = direction !== state.direction
          ? options.directionChangePenalty ?? 2.25
          : 0;
        const steeringPenalty = Math.abs(steering) * (options.steeringPenalty ?? 0.12);
        next.cost =
          state.cost +
          travelDistance * this.cells.cost(next.row) * reversePenalty +
          directionPenalty +
          steeringPenalty;
        successors.push(next);
      }
    }
    return successors;
  }

  private advance(
    state: SearchState,
    direction: 1 | -1,
    steering: -1 | 0 | 1,
  ): SearchState | null {
    const currentHeading = indexHeading(state.headingIndex);
    const headingDelta = steering * direction * HEADING_STEP;
    const arcLength = steering === 0
      ? this.cellSize
      : this.profile.minTurnRadius * HEADING_STEP;
    const clampedHeadingDelta = steering === 0 ? 0 : headingDelta;
    const resolvedHeading = normalizeAngle(currentHeading + clampedHeadingDelta);
    const travelHeading = normalizeAngle(
      currentHeading + clampedHeadingDelta * 0.5 + (direction < 0 ? Math.PI : 0),
    );
    const travel = headingToVector(travelHeading);
    const displacement = steering === 0
      ? arcLength
      : 2 * this.profile.minTurnRadius *
        Math.sin(Math.abs(clampedHeadingDelta) * 0.5);
    const target: VehicleNavPoint = [
      state.position[0] + travel[0] * displacement,
      state.position[1],
      state.position[2] + travel[1] * displacement,
    ];
    const nextRow = this.freeRow(target, this.cellSize * 0.9);
    if (nextRow === NO_ROW || nextRow === state.row) return null;
    if (
      !this.motionIsTraversable(
        state.position,
        currentHeading,
        direction,
        clampedHeadingDelta,
        displacement,
      )
    ) return null;
    const nextHeadingIndex = headingIndex(resolvedHeading);
    return {
      key: stateKey(nextRow, nextHeadingIndex, direction),
      row: nextRow,
      position: this.cells.position(nextRow),
      headingIndex: nextHeadingIndex,
      direction,
      cost: Infinity,
    };
  }

  private motionIsTraversable(
    from: VehicleNavPoint,
    heading: number,
    direction: 1 | -1,
    headingDelta: number,
    displacement: number,
  ): boolean {
    const steps = Math.max(1, Math.ceil(displacement / (this.cellSize * 0.45)));
    for (let step = 1; step <= steps; step += 1) {
      const alpha = step / steps;
      const partialDelta = headingDelta * alpha;
      const partialDistance = Math.abs(headingDelta) < 1e-7
        ? displacement * alpha
        : 2 * this.profile.minTurnRadius * Math.sin(Math.abs(partialDelta) * 0.5);
      const travelHeading = normalizeAngle(
        heading + partialDelta * 0.5 + (direction < 0 ? Math.PI : 0),
      );
      const travel = headingToVector(travelHeading);
      const point: VehicleNavPoint = [
        from[0] + travel[0] * partialDistance,
        from[1],
        from[2] + travel[1] * partialDistance,
      ];
      if (this.freeRow(point, this.cellSize * 0.8) === NO_ROW) return false;
    }
    return true;
  }

  /**
   * Heurística "holonomic with obstacles" del Hybrid A* clásico: ve el callejón
   * sin salida que la distancia en línea recta no ve, y sin ella la búsqueda
   * gasta su presupuesto explorando ramales cerrados. Devuelve `false` si el
   * goal no alcanza al arranque ni siendo holonómico.
   */
  private buildDistanceField(goalRow: number, startRow: number): boolean {
    // Un plan invalida el campo de consultas: comparten la geometría pero no los
    // estorbos de runtime ni el corte temprano.
    this.queryGoalRow = NO_ROW;
    fillDistanceField(this.field, this.cells, this.profile, goalRow, startRow, this.blocked);
    return Number.isFinite(this.field[startRow] ?? Infinity);
  }

  /**
   * Cota inferior del costo restante. El campo es más ajustado que la línea
   * recta donde llegó; fuera de su alcance queda la euclídea, que también es
   * cota inferior, así que el máximo de las dos sigue siendo admisible.
   */
  private heuristic(
    row: number,
    from: VehicleNavPoint,
    to: VehicleNavPoint,
  ): number {
    const straight = planarDistance(from, to) * Math.max(0, this.minimumCellCost);
    const field = this.field[row] ?? Infinity;
    return Number.isFinite(field) ? Math.max(field, straight) : straight;
  }

  private blockedRows(
    blockers: readonly VehicleNavBlocker[] | undefined,
  ): ReadonlySet<number> {
    if (!blockers || blockers.length === 0) return NO_BLOCKERS;
    const rows = new Set<number>();
    for (const blocker of blockers) {
      const reach = Math.max(this.cellSize, blocker.radius);
      const span = Math.ceil(reach / this.cellSize);
      const centerIx = Math.floor((blocker.position[0] - this.cells.origin[0]) / this.cellSize);
      const centerIz = Math.floor((blocker.position[2] - this.cells.origin[1]) / this.cellSize);
      for (let offsetX = -span; offsetX <= span; offsetX += 1) {
        for (let offsetZ = -span; offsetZ <= span; offsetZ += 1) {
          const row = this.cells.row(centerIx + offsetX, centerIz + offsetZ);
          if (row === NO_ROW) continue;
          const distance = Math.hypot(
            blocker.position[0] - this.cells.x(row),
            blocker.position[2] - this.cells.z(row),
          );
          if (distance <= reach) rows.add(row);
        }
      }
    }
    return rows;
  }

  /**
   * Curva de Dubins desde el estado hasta la pose objetivo, o `null` si no
   * resuelve o si algún punto del arco cae fuera del terreno manejable.
   */
  private analyticShot(
    state: SearchState,
    goalPosition: VehicleNavPoint,
    goalHeading: number,
  ): VehicleHybridPathPoint[] | null {
    const samples = dubinsShortestPath(
      {
        x: state.position[0],
        z: state.position[2],
        heading: indexHeading(state.headingIndex),
      },
      { x: goalPosition[0], z: goalPosition[2], heading: goalHeading },
      this.profile.minTurnRadius,
      this.cellSize * 0.45,
    );
    if (!samples) return null;

    const points: VehicleHybridPathPoint[] = [];
    for (const sample of samples) {
      const row = this.containingRow(sample.x, sample.z);
      if (row === NO_ROW) return null;
      points.push({
        // La posición es la del arco, no la del centro de celda: redondearla
        // al grid tiraría justamente la suavidad que este tramo aporta.
        position: [sample.x, this.cells.y(row), sample.z],
        heading: sample.heading,
        direction: 'forward',
        speedLimit: this.cells.speedLimit(row),
      });
    }
    return points;
  }

  /**
   * Celda que CONTIENE el punto, sin tolerancia. `freeRow` busca la más cercana
   * dentro de un radio, que sirve para enganchar un estado al grid pero no para
   * validar una curva libre: con esa holgura los puntos que caen dentro de un
   * muro de una celda se enganchan al vecino y el arco lo atraviesa.
   */
  private containingRow(x: number, z: number): number {
    const row = this.cells.row(
      Math.floor((x - this.cells.origin[0]) / this.cellSize),
      Math.floor((z - this.cells.origin[1]) / this.cellSize),
    );
    return row !== NO_ROW && this.blocked.has(row) ? NO_ROW : row;
  }

  private freeRow(position: VehicleNavPoint, maxDistance: number): number {
    const row = this.cells.nearestRow(position, maxDistance);
    return row !== NO_ROW && this.blocked.has(row) ? NO_ROW : row;
  }
}

function reconstruct(
  goal: SearchState,
  previous: ReadonlyMap<string, PreviousState>,
  states: ReadonlyMap<string, SearchState>,
  cells: VehicleNavGridIndex,
  expandedStates: number,
  reachedGoal: boolean,
  tail: readonly VehicleHybridPathPoint[] = [],
): VehicleHybridPath {
  const ordered = [goal];
  let cursor = goal;
  while (true) {
    const parent = previous.get(cursor.key);
    if (!parent) break;
    const state = states.get(parent.key);
    if (!state) break;
    ordered.push(state);
    cursor = state;
  }
  ordered.reverse();
  const points: VehicleHybridPathPoint[] = ordered.map((state) => ({
    position: state.position,
    heading: indexHeading(state.headingIndex),
    direction: state.direction < 0 ? 'reverse' : 'forward',
    speedLimit: cells.speedLimit(state.row),
  }));
  points.push(...tail);
  return { points, cost: goal.cost, expandedStates, reachedGoal };
}

function stateKey(row: number, heading: number, direction: 1 | -1): string {
  return `${row}:${heading}:${direction}`;
}

function headingIndex(heading: number): number {
  const normalized = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / HEADING_STEP) % VEHICLE_HYBRID_HEADING_COUNT;
}

function indexHeading(index: number): number {
  return normalizeAngle(index * HEADING_STEP);
}

/**
 * Dijkstra desde `goalRow` sobre la grilla, con la misma tolerancia de escalón
 * que usa el bake para armar las islas. `stopAtRow` corta apenas esa fila queda
 * asentada (más un margen para los rodeos que A* todavía puede querer); con
 * `NO_ROW` se barre hasta `maxCost`.
 */
function fillDistanceField(
  field: Float64Array,
  cells: VehicleNavGridIndex,
  profile: VehicleNavigationProfile,
  goalRow: number,
  stopAtRow: number,
  blocked: ReadonlySet<number>,
  maxCost = Infinity,
): void {
  field.fill(Infinity);
  field[goalRow] = 0;
  const queue = new RowQueue();
  queue.push(goalRow, 0);
  const slopeRise = Math.tan(profile.maxSlopeRadians);
  let limit = maxCost;

  while (queue.size > 0) {
    const entry = queue.pop();
    if (!entry) break;
    if (entry.cost > (field[entry.row] ?? Infinity) + 1e-9) continue;
    if (entry.cost > limit) break;
    if (entry.row === stopAtRow) limit = Math.min(limit, entry.cost * 1.3);
    const ix = cells.ix(entry.row);
    const iz = cells.iz(entry.row);
    const y = cells.y(entry.row);
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const neighbor = cells.row(ix + dx, iz + dz);
      if (neighbor === NO_ROW || blocked.has(neighbor)) continue;
      const step = Math.hypot(dx, dz) * cells.cellSize;
      if (Math.abs(cells.y(neighbor) - y) > step * slopeRise + STEP_TOLERANCE) continue;
      const cost = entry.cost + step * cells.cost(neighbor);
      if (cost >= (field[neighbor] ?? Infinity) - 1e-9) continue;
      field[neighbor] = cost;
      queue.push(neighbor, cost);
    }
  }
}

/** Cola de prioridad sobre filas, para el campo de distancia. */
class RowQueue {
  private readonly rows: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.rows.length;
  }

  push(row: number, cost: number): void {
    this.rows.push(row);
    this.costs.push(cost);
    let index = this.rows.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if ((this.costs[parent] ?? 0) <= (this.costs[index] ?? 0)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): { row: number; cost: number } | null {
    const row = this.rows[0];
    const cost = this.costs[0];
    if (row === undefined || cost === undefined) return null;
    const lastRow = this.rows.pop();
    const lastCost = this.costs.pop();
    if (this.rows.length > 0 && lastRow !== undefined && lastCost !== undefined) {
      this.rows[0] = lastRow;
      this.costs[0] = lastCost;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.rows.length && (this.costs[left] ?? 0) < (this.costs[smallest] ?? 0)) {
          smallest = left;
        }
        if (right < this.rows.length && (this.costs[right] ?? 0) < (this.costs[smallest] ?? 0)) {
          smallest = right;
        }
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return { row, cost };
  }

  private swap(a: number, b: number): void {
    const row = this.rows[a];
    const cost = this.costs[a];
    const otherRow = this.rows[b];
    const otherCost = this.costs[b];
    if (row === undefined || cost === undefined) return;
    if (otherRow === undefined || otherCost === undefined) return;
    this.rows[a] = otherRow;
    this.costs[a] = otherCost;
    this.rows[b] = row;
    this.costs[b] = cost;
  }
}

class StateQueue {
  private readonly entries: StateQueueEntry[] = [];
  private serial = 0;

  get size(): number {
    return this.entries.length;
  }

  push(key: string, score: number, pathCost: number): void {
    this.entries.push({ key, score, pathCost, serial: this.serial++ });
    this.siftUp(this.entries.length - 1);
  }

  pop(): { key: string; score: number; pathCost: number } | null {
    const first = this.entries[0];
    if (!first) return null;
    const last = this.entries.pop();
    if (this.entries.length > 0 && last) {
      this.entries[0] = last;
      this.siftDown(0);
    }
    return first;
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const entry = this.entries[index];
      const parent = this.entries[parentIndex];
      if (!entry || !parent || compareQueueEntries(entry, parent) >= 0) break;
      this.entries[index] = parent;
      this.entries[parentIndex] = entry;
      index = parentIndex;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;
      const current = this.entries[smallestIndex];
      const left = this.entries[leftIndex];
      if (left && current && compareQueueEntries(left, current) < 0) {
        smallestIndex = leftIndex;
      }
      const candidate = this.entries[smallestIndex];
      const right = this.entries[rightIndex];
      if (right && candidate && compareQueueEntries(right, candidate) < 0) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) return;
      const entry = this.entries[index];
      const replacement = this.entries[smallestIndex];
      if (!entry || !replacement) return;
      this.entries[index] = replacement;
      this.entries[smallestIndex] = entry;
      index = smallestIndex;
    }
  }
}

interface StateQueueEntry {
  key: string;
  score: number;
  pathCost: number;
  serial: number;
}

function compareQueueEntries(a: StateQueueEntry, b: StateQueueEntry): number {
  return a.score - b.score || a.serial - b.serial;
}
