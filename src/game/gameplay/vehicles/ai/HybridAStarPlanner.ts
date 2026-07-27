import type {
  VehicleHybridPath,
  VehicleHybridPathPoint,
  VehicleNavigationProfile,
  VehicleNavCell,
  VehicleNavGrid,
  VehicleNavPoint,
  VehiclePose2D,
} from './VehicleAiTypes';
import {
  headingToVector,
  normalizeAngle,
  planarDistance,
} from './VehicleAiMath';

export const VEHICLE_HYBRID_HEADING_COUNT = 16;
const HEADING_STEP = (Math.PI * 2) / VEHICLE_HYBRID_HEADING_COUNT;

export interface HybridAStarOptions {
  maxExpandedStates?: number;
  goalTolerance?: number;
  headingTolerance?: number;
  reversePenalty?: number;
  directionChangePenalty?: number;
  steeringPenalty?: number;
}

interface SearchState {
  key: string;
  cell: VehicleNavCell;
  headingIndex: number;
  direction: 1 | -1;
  cost: number;
}

interface PreviousState {
  key: string;
}

export class HybridAStarPlanner {
  private readonly cellsByKey: ReadonlyMap<string, VehicleNavCell>;
  private readonly minimumCellCost: number;

  constructor(
    private readonly grid: VehicleNavGrid,
    private readonly profile: VehicleNavigationProfile,
  ) {
    this.cellsByKey = new Map(grid.cells.map((cell) => [cell.key, cell]));
    this.minimumCellCost = grid.cells.reduce(
      (minimum, cell) => Math.min(minimum, cell.cost),
      1,
    );
  }

  plan(
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options: HybridAStarOptions = {},
  ): VehicleHybridPath | null {
    const startCell = this.nearestCell(start.position, this.grid.cellSize * 2.5);
    const goalCell = this.nearestCell(goal.position, this.grid.cellSize * 2.5);
    if (!startCell || !goalCell) return null;

    const startHeading = headingIndex(start.heading);
    const startState: SearchState = {
      key: stateKey(startCell.key, startHeading, 1),
      cell: startCell,
      headingIndex: startHeading,
      direction: 1,
      cost: 0,
    };
    const open = new StateQueue();
    const states = new Map<string, SearchState>([[startState.key, startState]]);
    const previous = new Map<string, PreviousState>();
    const costs = new Map<string, number>([[startState.key, 0]]);
    open.push(
      startState.key,
      heuristic(startCell.position, goalCell.position, this.minimumCellCost),
      0,
    );

    const maximumExpandedStates = Math.max(64, options.maxExpandedStates ?? 20_000);
    const goalTolerance = Math.max(
      this.grid.cellSize,
      options.goalTolerance ?? this.grid.cellSize * 1.5,
    );
    const headingTolerance = Math.max(
      HEADING_STEP,
      options.headingTolerance ?? HEADING_STEP * 1.5,
    );
    let expandedStates = 0;
    let best = startState;
    let bestDistance = planarDistance(startCell.position, goalCell.position);

    while (open.size > 0 && expandedStates < maximumExpandedStates) {
      const queued = open.pop();
      if (!queued) break;
      const current = states.get(queued.key);
      if (!current) continue;
      if (queued.pathCost > (costs.get(current.key) ?? Infinity) + 1e-8) continue;
      expandedStates += 1;
      const distanceToGoal = planarDistance(current.cell.position, goalCell.position);
      if (distanceToGoal < bestDistance) {
        best = current;
        bestDistance = distanceToGoal;
      }
      if (
        distanceToGoal <= goalTolerance &&
        Math.abs(normalizeAngle(indexHeading(current.headingIndex) - goal.heading)) <= headingTolerance
      ) {
        return reconstruct(current, previous, states, expandedStates, true);
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
            heuristic(successor.cell.position, goalCell.position, this.minimumCellCost),
          successor.cost,
        );
      }
    }

    if (best.key === startState.key) return null;
    return reconstruct(best, previous, states, expandedStates, false);
  }

  private successors(
    state: SearchState,
    options: HybridAStarOptions,
  ): SearchState[] {
    const successors: SearchState[] = [];
    const directions: readonly (1 | -1)[] = this.profile.reverseAllowed &&
        !state.cell.flags.includes('noReverse')
      ? [1, -1]
      : [1];
    for (const direction of directions) {
      for (const steering of [-1, 0, 1] as const) {
        const next = this.advance(state, direction, steering);
        if (!next || (direction < 0 && next.cell.flags.includes('noReverse'))) continue;
        const travelDistance = planarDistance(state.cell.position, next.cell.position);
        const reversePenalty = direction < 0 ? options.reversePenalty ?? 1.35 : 1;
        const directionPenalty = direction !== state.direction
          ? options.directionChangePenalty ?? 2.25
          : 0;
        const steeringPenalty = Math.abs(steering) * (options.steeringPenalty ?? 0.12);
        next.cost =
          state.cost +
          travelDistance * next.cell.cost * reversePenalty +
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
      ? this.grid.cellSize
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
      state.cell.position[0] + travel[0] * displacement,
      state.cell.position[1],
      state.cell.position[2] + travel[1] * displacement,
    ];
    const nextCell = this.nearestCell(target, this.grid.cellSize * 0.9);
    if (!nextCell || nextCell.key === state.cell.key) return null;
    if (
      !this.motionIsTraversable(
        state.cell.position,
        currentHeading,
        direction,
        clampedHeadingDelta,
        displacement,
      )
    ) return null;
    const nextHeadingIndex = headingIndex(resolvedHeading);
    return {
      key: stateKey(nextCell.key, nextHeadingIndex, direction),
      cell: nextCell,
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
    const steps = Math.max(1, Math.ceil(displacement / (this.grid.cellSize * 0.45)));
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
      if (!this.nearestCell(point, this.grid.cellSize * 0.8)) return false;
    }
    return true;
  }

  private nearestCell(position: VehicleNavPoint, maxDistance: number): VehicleNavCell | null {
    const estimatedIx = Math.floor((position[0] - this.grid.origin[0]) / this.grid.cellSize);
    const estimatedIz = Math.floor((position[2] - this.grid.origin[1]) / this.grid.cellSize);
    const searchRadius = Math.max(1, Math.ceil(maxDistance / this.grid.cellSize));
    let nearest: VehicleNavCell | null = null;
    let nearestDistance = maxDistance;
    for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
      for (let offsetZ = -searchRadius; offsetZ <= searchRadius; offsetZ += 1) {
        const cell = this.cellsByKey.get(`${estimatedIx + offsetX}:${estimatedIz + offsetZ}`);
        if (!cell) continue;
        const distance = planarDistance(position, cell.position);
        if (distance < nearestDistance) {
          nearest = cell;
          nearestDistance = distance;
        }
      }
    }
    return nearest;
  }
}

function reconstruct(
  goal: SearchState,
  previous: ReadonlyMap<string, PreviousState>,
  states: ReadonlyMap<string, SearchState>,
  expandedStates: number,
  reachedGoal: boolean,
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
    position: state.cell.position,
    heading: indexHeading(state.headingIndex),
    direction: state.direction < 0 ? 'reverse' : 'forward',
    speedLimit: state.cell.speedLimit,
  }));
  return { points, cost: goal.cost, expandedStates, reachedGoal };
}

function stateKey(cellKey: string, heading: number, direction: 1 | -1): string {
  return `${cellKey}:${heading}:${direction}`;
}

function headingIndex(heading: number): number {
  const normalized = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / HEADING_STEP) % VEHICLE_HYBRID_HEADING_COUNT;
}

function indexHeading(index: number): number {
  return normalizeAngle(index * HEADING_STEP);
}

function heuristic(
  from: VehicleNavPoint,
  to: VehicleNavPoint,
  minimumCellCost: number,
): number {
  return planarDistance(from, to) * Math.max(0, minimumCellCost);
}

class StateQueue {
  private readonly entries: Array<{
    key: string;
    score: number;
    pathCost: number;
    serial: number;
  }> = [];
  private serial = 0;

  get size(): number {
    return this.entries.length;
  }

  push(key: string, score: number, pathCost: number): void {
    this.entries.push({ key, score, pathCost, serial: this.serial++ });
    this.entries.sort((a, b) => a.score - b.score || a.serial - b.serial);
  }

  pop(): { key: string; score: number; pathCost: number } | null {
    return this.entries.shift() ?? null;
  }
}
