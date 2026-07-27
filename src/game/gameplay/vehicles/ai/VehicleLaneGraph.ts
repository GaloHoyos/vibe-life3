import type { VehicleNavLaneDefinition } from '@game/levels/LevelDefinition';
import type {
  VehicleLaneEdge,
  VehicleLaneGraphData,
  VehicleLaneNode,
  VehicleLaneRoute,
  VehicleNavPoint,
} from './VehicleAiTypes';
import { distance3, planarDistance } from './VehicleAiMath';

export interface VehicleLaneGraphOptions {
  endpointConnectionDistance?: number;
  maxVerticalConnection?: number;
  defaultSpeedLimit?: number;
}

export function buildVehicleLaneGraph(
  lanes: readonly VehicleNavLaneDefinition[],
  options: VehicleLaneGraphOptions = {},
): VehicleLaneGraphData {
  const nodes: VehicleLaneNode[] = [];
  const edges: VehicleLaneEdge[] = [];
  const endpoints: Array<{ node: VehicleLaneNode; lane: VehicleNavLaneDefinition }> = [];
  const defaultSpeedLimit = Math.max(1, options.defaultSpeedLimit ?? 14);

  for (const lane of [...lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    const laneNodes = lane.points.map<VehicleLaneNode>((position, pointIndex) => ({
      id: `${lane.id}:${pointIndex}`,
      position: [...position],
      laneId: lane.id,
      pointIndex,
    }));
    nodes.push(...laneNodes);
    if (laneNodes.length > 0) {
      endpoints.push({ node: laneNodes[0], lane });
      if (laneNodes.length > 1) endpoints.push({ node: laneNodes[laneNodes.length - 1], lane });
    }
    for (let index = 0; index + 1 < laneNodes.length; index += 1) {
      const forward = laneNodes[index];
      const backward = laneNodes[index + 1];
      if (lane.direction === 'forward' || lane.direction === 'both') {
        edges.push(createLaneEdge(lane, forward, backward, defaultSpeedLimit, 'forward'));
      }
      if (lane.direction === 'backward' || lane.direction === 'both') {
        edges.push(createLaneEdge(lane, backward, forward, defaultSpeedLimit, 'backward'));
      }
    }
  }

  const maximumConnectionDistance = Math.max(0, options.endpointConnectionDistance ?? 2);
  const maximumVerticalConnection = Math.max(0, options.maxVerticalConnection ?? 1.25);
  for (let first = 0; first < endpoints.length; first += 1) {
    const a = endpoints[first];
    for (let second = first + 1; second < endpoints.length; second += 1) {
      const b = endpoints[second];
      if (a.lane.id === b.lane.id) continue;
      const horizontal = planarDistance(a.node.position, b.node.position);
      const vertical = Math.abs(a.node.position[1] - b.node.position[1]);
      const authoredConnectionDistance = Math.min(
        maximumConnectionDistance,
        Math.max(0.25, (a.lane.width + b.lane.width) * 0.5),
      );
      if (horizontal > authoredConnectionDistance || vertical > maximumVerticalConnection) continue;
      const width = Math.min(a.lane.width, b.lane.width);
      const speedLimit = Math.min(
        a.lane.speedLimit ?? defaultSpeedLimit,
        b.lane.speedLimit ?? defaultSpeedLimit,
      );
      const tags = sortedUnique([...(a.lane.tags ?? []), ...(b.lane.tags ?? []), 'junction']);
      edges.push(
        createConnectorEdge(a.node, b.node, width, speedLimit, tags),
        createConnectorEdge(b.node, a.node, width, speedLimit, tags),
      );
    }
  }

  return {
    nodes,
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export class VehicleLaneGraph {
  private readonly nodesById: ReadonlyMap<string, VehicleLaneNode>;
  private readonly edgesById: ReadonlyMap<string, VehicleLaneEdge>;
  private readonly outgoingByNode: ReadonlyMap<string, readonly VehicleLaneEdge[]>;
  private readonly minimumCostPerMeter: number;

  constructor(readonly data: VehicleLaneGraphData) {
    this.nodesById = new Map(data.nodes.map((node) => [node.id, node]));
    this.edgesById = new Map(data.edges.map((edge) => [edge.id, edge]));
    const outgoing = new Map<string, VehicleLaneEdge[]>();
    for (const edge of data.edges) {
      const list = outgoing.get(edge.from);
      if (list) list.push(edge);
      else outgoing.set(edge.from, [edge]);
    }
    for (const list of outgoing.values()) {
      list.sort((a, b) => a.travelCost - b.travelCost || a.id.localeCompare(b.id));
    }
    this.outgoingByNode = outgoing;
    this.minimumCostPerMeter = data.edges.reduce(
      (minimum, edge) =>
        edge.length > 1e-6
          ? Math.min(minimum, edge.travelCost / edge.length)
          : minimum,
      Infinity,
    );
  }

  node(id: string): VehicleLaneNode | null {
    return this.nodesById.get(id) ?? null;
  }

  edge(id: string): VehicleLaneEdge | null {
    return this.edgesById.get(id) ?? null;
  }

  outgoing(nodeId: string): readonly VehicleLaneEdge[] {
    return this.outgoingByNode.get(nodeId) ?? [];
  }

  nearestNode(position: VehicleNavPoint, maxDistance = Infinity): VehicleLaneNode | null {
    let nearest: VehicleLaneNode | null = null;
    let nearestDistance = maxDistance;
    for (const node of this.data.nodes) {
      const distance = planarDistance(position, node.position);
      if (
        distance < nearestDistance ||
        (distance === nearestDistance && nearest !== null && node.id.localeCompare(nearest.id) < 0)
      ) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  findRoute(from: VehicleNavPoint, to: VehicleNavPoint): VehicleLaneRoute | null {
    const start = this.nearestNode(from);
    const goal = this.nearestNode(to);
    if (!start || !goal) return null;
    if (start.id === goal.id) {
      return { nodeIds: [start.id], edgeIds: [], points: [start.position], cost: 0 };
    }

    const open = new MinQueue();
    const cost = new Map<string, number>([[start.id, 0]]);
    const previous = new Map<string, { nodeId: string; edgeId: string }>();
    open.push(
      start.id,
      planarDistance(start.position, goal.position) * finiteMinimum(this.minimumCostPerMeter),
      0,
    );

    while (open.size > 0) {
      const queued = open.pop();
      if (!queued) break;
      const currentId = queued.id;
      const currentCost = cost.get(currentId);
      if (currentCost === undefined) continue;
      if (queued.pathCost > currentCost + 1e-9) continue;
      if (currentId === goal.id) return this.reconstruct(start.id, goal.id, previous, cost);
      for (const edge of this.outgoing(currentId)) {
        const candidate = currentCost + edge.travelCost;
        const known = cost.get(edge.to);
        if (known !== undefined && candidate >= known - 1e-9) continue;
        const next = this.node(edge.to);
        if (!next) continue;
        cost.set(edge.to, candidate);
        previous.set(edge.to, { nodeId: currentId, edgeId: edge.id });
        open.push(
          edge.to,
          candidate +
            planarDistance(next.position, goal.position) *
              finiteMinimum(this.minimumCostPerMeter),
          candidate,
        );
      }
    }
    return null;
  }

  private reconstruct(
    startId: string,
    goalId: string,
    previous: ReadonlyMap<string, { nodeId: string; edgeId: string }>,
    costs: ReadonlyMap<string, number>,
  ): VehicleLaneRoute | null {
    const nodeIds = [goalId];
    const edgeIds: string[] = [];
    let cursor = goalId;
    while (cursor !== startId) {
      const parent = previous.get(cursor);
      if (!parent) return null;
      nodeIds.push(parent.nodeId);
      edgeIds.push(parent.edgeId);
      cursor = parent.nodeId;
    }
    nodeIds.reverse();
    edgeIds.reverse();
    const points = nodeIds
      .map((id) => this.node(id)?.position)
      .filter((point): point is VehicleNavPoint => point !== undefined);
    return { nodeIds, edgeIds, points, cost: costs.get(goalId) ?? Infinity };
  }
}

function createLaneEdge(
  lane: VehicleNavLaneDefinition,
  from: VehicleLaneNode,
  to: VehicleLaneNode,
  defaultSpeedLimit: number,
  suffix: string,
): VehicleLaneEdge {
  const length = distance3(from.position, to.position);
  const speedLimit = Math.max(1, lane.speedLimit ?? defaultSpeedLimit);
  const priority = lane.priority ?? 0;
  const priorityFactor = 1 / Math.max(0.35, 1 + priority * 0.08);
  const tags = sortedUnique(lane.tags ?? []);
  return {
    id: `${lane.id}:${from.pointIndex}-${to.pointIndex}:${suffix}`,
    from: from.id,
    to: to.id,
    laneId: lane.id,
    length,
    travelCost: (length / speedLimit) * priorityFactor,
    speedLimit,
    priority,
    width: lane.width,
    tags,
    reservable: isReservable(tags, lane.width),
  };
}

function createConnectorEdge(
  from: VehicleLaneNode,
  to: VehicleLaneNode,
  width: number,
  speedLimit: number,
  tags: readonly string[],
): VehicleLaneEdge {
  const length = distance3(from.position, to.position);
  return {
    id: `connector:${from.id}->${to.id}`,
    from: from.id,
    to: to.id,
    laneId: null,
    length,
    travelCost: length / Math.max(1, speedLimit),
    speedLimit,
    priority: 0,
    width,
    tags,
    reservable: true,
  };
}

function isReservable(tags: readonly string[], width: number): boolean {
  return width < 3.2 || tags.some((tag) =>
    tag === 'intersection' ||
    tag === 'junction' ||
    tag === 'narrow' ||
    tag === 'singleLane' ||
    tag === 'bridge'
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function finiteMinimum(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

class MinQueue {
  private readonly entries: Array<{
    id: string;
    score: number;
    pathCost: number;
    serial: number;
  }> = [];
  private serial = 0;

  get size(): number {
    return this.entries.length;
  }

  push(id: string, score: number, pathCost: number): void {
    this.entries.push({ id, score, pathCost, serial: this.serial++ });
    this.entries.sort((a, b) => a.score - b.score || a.serial - b.serial);
  }

  pop(): { id: string; pathCost: number } | null {
    return this.entries.shift() ?? null;
  }
}
