import { Vector3 } from "three";

interface NavNode {
  id: number;
  position: Vector3;
  edges: Array<{ to: number; cost: number }>;
}

export interface NavGraphDebugNode {
  id: number;
  position: Vector3;
  edgeCount: number;
  componentId: number | null;
}

export interface NavGraphDebugEdge {
  from: Vector3;
  to: Vector3;
}

export interface NavGraphDebugSnapshot {
  nodes: NavGraphDebugNode[];
  edges: NavGraphDebugEdge[];
  totalNodes: number;
}

export interface NavGraphExportEdge {
  to: number;
  cost: number;
}

export interface NavGraphExportNode {
  id: number;
  position: Vector3;
  componentId: number | null;
  edgeCount: number;
  edges: NavGraphExportEdge[];
}

export interface NavGraphExportComponent {
  id: number;
  nodeCount: number;
  edgeCount: number;
  isolatedNodeCount: number;
  boundsMin: Vector3;
  boundsMax: Vector3;
  centroid: Vector3;
}

export interface NavGraphExportSnapshot {
  generatedAt: string;
  totalNodes: number;
  totalEdges: number;
  components: NavGraphExportComponent[];
  nodes: NavGraphExportNode[];
}

export type NavPathStatus =
  | "ok"
  | "direct-start-missing"
  | "direct-same-node"
  | "empty-goal-missing"
  | "empty-no-route";

export interface NavPathResult {
  path: Vector3[];
  status: NavPathStatus;
  startNodeId: number | null;
  goalNodeId: number | null;
  startComponentId: number | null;
  goalComponentId: number | null;
  startNodePosition: Vector3 | null;
  goalNodePosition: Vector3 | null;
}

/**
 * Grafo de navegación. Nodos colocados en posiciones walkables del mundo +
 * edges entre vecinos con visibility check. La generación es externa
 * (`NavGraphBuilder`); este archivo sólo guarda la data y resuelve A*.
 *
 * Los NPCs llaman `findPath(from, to)` y reciben una lista de waypoints
 * world-space que el `motor` puede consumir secuencialmente. Si no hay
 * camino o ambos puntos están en el mismo nodo, devuelve el endpoint directo.
 */
export class NavGraph {
  private readonly nodes: NavNode[] = [];
  private spatialIndex: Map<string, number[]> | null = null;
  private componentIds: number[] | null = null;
  private readonly spatialCellSize = 8;
  private readonly pathCache = new Map<string, number[] | null>();
  private readonly pathCacheMaxEntries = 768;

  addNode(position: Vector3): number {
    const id = this.nodes.length;
    this.nodes.push({ id, position: position.clone(), edges: [] });
    this.spatialIndex = null;
    this.componentIds = null;
    this.pathCache.clear();
    return id;
  }

  addEdge(a: number, b: number, cost: number): void {
    const nodeA = this.nodes[a];
    const nodeB = this.nodes[b];
    if (!nodeA || !nodeB) return;
    nodeA.edges.push({ to: b, cost });
    nodeB.edges.push({ to: a, cost });
    this.spatialIndex = null;
    this.componentIds = null;
    this.pathCache.clear();
  }

  nodeCount(): number {
    return this.nodes.length;
  }

  edgeCountOf(id: number): number {
    return this.nodes[id]?.edges.length ?? 0;
  }

  getNode(id: number): Vector3 | null {
    return this.nodes[id]?.position.clone() ?? null;
  }

  connectedComponentOf(id: number): number | null {
    if (!this.nodes[id]) return null;
    this.ensureComponents();
    return this.componentIds?.[id] ?? null;
  }

  edgeCount(): number {
    let count = 0;
    for (const node of this.nodes) {
      for (const edge of node.edges) {
        if (node.id < edge.to) {
          count += 1;
        }
      }
    }
    return count;
  }

  getExportSnapshot(): NavGraphExportSnapshot {
    this.ensureComponents();
    const componentStats = new Map<number, NavGraphExportComponent>();
    const nodes: NavGraphExportNode[] = [];
    let totalEdges = 0;

    for (const node of this.nodes) {
      const componentId = this.componentIds?.[node.id] ?? null;
      if (componentId !== null) {
        let stats = componentStats.get(componentId);
        if (!stats) {
          stats = {
            id: componentId,
            nodeCount: 0,
            edgeCount: 0,
            isolatedNodeCount: 0,
            boundsMin: new Vector3(Infinity, Infinity, Infinity),
            boundsMax: new Vector3(-Infinity, -Infinity, -Infinity),
            centroid: new Vector3(),
          };
          componentStats.set(componentId, stats);
        }
        stats.nodeCount += 1;
        stats.boundsMin.min(node.position);
        stats.boundsMax.max(node.position);
        stats.centroid.add(node.position);
        if (node.edges.length === 0) {
          stats.isolatedNodeCount += 1;
        }
      }

      for (const edge of node.edges) {
        if (node.id < edge.to) {
          totalEdges += 1;
          if (componentId !== null) {
            componentStats.get(componentId)!.edgeCount += 1;
          }
        }
      }

      nodes.push({
        id: node.id,
        position: node.position.clone(),
        componentId,
        edgeCount: node.edges.length,
        edges: node.edges.map((edge) => ({ to: edge.to, cost: edge.cost })),
      });
    }

    const components = [...componentStats.values()]
      .map((component) => ({
        ...component,
        boundsMin: component.boundsMin.clone(),
        boundsMax: component.boundsMax.clone(),
        centroid:
          component.nodeCount > 0
            ? component.centroid.clone().divideScalar(component.nodeCount)
            : component.centroid.clone(),
      }))
      .sort((a, b) => a.id - b.id);

    return {
      generatedAt: new Date().toISOString(),
      totalNodes: this.nodes.length,
      totalEdges,
      components,
      nodes,
    };
  }

  exportDebugText(): string {
    const snapshot = this.getExportSnapshot();
    const largestComponent = snapshot.components.reduce<NavGraphExportComponent | null>(
      (best, component) =>
        best === null || component.nodeCount > best.nodeCount ? component : best,
      null,
    );
    const lines: string[] = [];

    lines.push("==== NavGraph Debug Export ====");
    lines.push(`Generated:  ${snapshot.generatedAt}`);
    lines.push(`Nodes:      ${snapshot.totalNodes}`);
    lines.push(`Edges:      ${snapshot.totalEdges}`);
    lines.push(`Components: ${snapshot.components.length}`);
    lines.push("");

    lines.push("---- Components ----");
    for (const component of snapshot.components) {
      const main = component.id === largestComponent?.id ? " main=1" : "";
      lines.push(
        `component ${component.id}${main} nodes=${component.nodeCount} edges=${component.edgeCount}` +
          ` isolated=${component.isolatedNodeCount}` +
          ` centroid=${formatNavVec(component.centroid)}` +
          ` bounds=${formatNavVec(component.boundsMin)}..${formatNavVec(component.boundsMax)}`,
      );
    }
    lines.push("");

    lines.push("---- Nodes ----");
    for (const node of snapshot.nodes) {
      const edges =
        node.edges.length > 0
          ? node.edges
              .map((edge) => `${edge.to}(${edge.cost.toFixed(1)})`)
              .join(",")
          : "-";
      lines.push(
        `node ${node.id} comp=${node.componentId ?? "-"} pos=${formatNavVec(node.position)}` +
          ` edges=${node.edgeCount} to=${edges}`,
      );
    }

    return lines.join("\n");
  }

  getDebugSnapshot(
    center: Vector3,
    radius = 55,
    maxNodes = 360,
  ): NavGraphDebugSnapshot {
    const radiusSq = radius * radius;
    const selectedIds = new Set<number>();
    const nodes: NavGraphDebugNode[] = [];

    for (const node of this.nodes) {
      if (nodes.length >= maxNodes) {
        break;
      }
      if (node.position.distanceToSquared(center) > radiusSq) {
        continue;
      }
      selectedIds.add(node.id);
      nodes.push({
        id: node.id,
        position: node.position.clone(),
        edgeCount: node.edges.length,
        componentId: this.connectedComponentOf(node.id),
      });
    }

    const edges: NavGraphDebugEdge[] = [];
    for (const node of this.nodes) {
      if (!selectedIds.has(node.id)) {
        continue;
      }
      for (const edge of node.edges) {
        if (node.id >= edge.to || !selectedIds.has(edge.to)) {
          continue;
        }
        edges.push({
          from: node.position.clone(),
          to: this.nodes[edge.to].position.clone(),
        });
      }
    }

    return { nodes, edges, totalNodes: this.nodes.length };
  }

  /**
   * Encuentra el nodo navegable más cercano a `position`. Considera solo
   * nodos con al menos 1 edge (un nodo aislado, e.g. en un techo, no sirve
   * como entry point). Devuelve null si todo está aislado.
   */
  nearestConnectedNode(
    position: Vector3,
    maxDistance = 12,
    maxVerticalDistance = 2.2,
  ): number | null {
    this.ensureSpatialIndex();
    let best = -1;
    let bestDistSq = maxDistance * maxDistance;
    const cellRadius = Math.ceil(maxDistance / this.spatialCellSize);
    const cx = Math.floor(position.x / this.spatialCellSize);
    const cz = Math.floor(position.z / this.spatialCellSize);

    for (let x = cx - cellRadius; x <= cx + cellRadius; x += 1) {
      for (let z = cz - cellRadius; z <= cz + cellRadius; z += 1) {
        const ids = this.spatialIndex?.get(navCellKey(x, z));
        if (!ids) continue;
        for (const id of ids) {
          const node = this.nodes[id];
          if (Math.abs(node.position.y - position.y) > maxVerticalDistance) {
            continue;
          }
          const dSq = node.position.distanceToSquared(position);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            best = node.id;
          }
        }
      }
    }
    return best >= 0 ? best : null;
  }

  /**
   * A* entre dos posiciones world-space. Snapea a los nodos navegables más
   * cercanos, busca el path, devuelve la lista de positions (incluyendo el
   * `to` final). Si el NPC no puede snapear al graph, conserva el fallback
   * directo. Si el destino no tiene nodo cercano navegable, devuelve `[]`
   * para no caminar hacia pisos o techos inalcanzables.
   */
  findPath(from: Vector3, to: Vector3): Vector3[] {
    return this.findPathDetailed(from, to).path;
  }

  findPathDetailed(from: Vector3, to: Vector3): NavPathResult {
    const startId = this.nearestConnectedNode(from);
    const goalId = this.nearestConnectedNode(to);
    const startNode = startId === null ? null : this.nodes[startId];
    const goalNode = goalId === null ? null : this.nodes[goalId];
    const startComponentId =
      startId === null ? null : this.connectedComponentOf(startId);
    const goalComponentId =
      goalId === null ? null : this.connectedComponentOf(goalId);
    if (startId === null) {
      return {
        path: [to.clone()],
        status: "direct-start-missing",
        startNodeId: null,
        goalNodeId: goalId,
        startComponentId: null,
        goalComponentId,
        startNodePosition: null,
        goalNodePosition: goalNode?.position.clone() ?? null,
      };
    }
    if (goalId === null) {
      return {
        path: [],
        status: "empty-goal-missing",
        startNodeId: startId,
        goalNodeId: null,
        startComponentId,
        goalComponentId: null,
        startNodePosition: startNode?.position.clone() ?? null,
        goalNodePosition: null,
      };
    }
    if (startId === goalId) {
      return {
        path: [to.clone()],
        status: "direct-same-node",
        startNodeId: startId,
        goalNodeId: goalId,
        startComponentId,
        goalComponentId,
        startNodePosition: startNode?.position.clone() ?? null,
        goalNodePosition: goalNode?.position.clone() ?? null,
      };
    }

    const path = this.aStar(startId, goalId);
    if (!path) {
      return {
        path: [],
        status: "empty-no-route",
        startNodeId: startId,
        goalNodeId: goalId,
        startComponentId,
        goalComponentId,
        startNodePosition: startNode?.position.clone() ?? null,
        goalNodePosition: goalNode?.position.clone() ?? null,
      };
    }

    // Las positions de los nodos viajan por referencia. Los callers (NpcPathFollower,
    // NpcSteering) solo leen — si en el futuro alguno muta, agregar .clone() acá.
    const positions: Vector3[] = path.map((id) => this.nodes[id].position);
    positions.push(to.clone());
    return {
      path: positions,
      status: "ok",
      startNodeId: startId,
      goalNodeId: goalId,
      startComponentId,
      goalComponentId,
      startNodePosition: startNode?.position.clone() ?? null,
      goalNodePosition: goalNode?.position.clone() ?? null,
    };
  }

  pathDistance(from: Vector3, to: Vector3): number | null {
    const startId = this.nearestConnectedNode(from);
    const goalId = this.nearestConnectedNode(to);
    if (startId === null || goalId === null) {
      return null;
    }
    if (startId === goalId) {
      return from.distanceTo(to);
    }

    const path = this.aStar(startId, goalId);
    if (!path) return null;

    let distance = from.distanceTo(this.nodes[path[0]].position);
    for (let i = 1; i < path.length; i += 1) {
      distance += this.nodes[path[i - 1]].position.distanceTo(
        this.nodes[path[i]].position,
      );
    }
    distance += this.nodes[path[path.length - 1]].position.distanceTo(to);
    return distance;
  }

  private aStar(start: number, goal: number): number[] | null {
    const cacheKey = `${start}:${goal}`;
    if (this.pathCache.has(cacheKey)) {
      return this.pathCache.get(cacheKey) ?? null;
    }

    const goalPos = this.nodes[goal].position;
    const openSet = new MinHeap();
    openSet.push({ id: start, score: 0 });
    const closed = new Set<number>();
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();
    gScore.set(start, 0);
    fScore.set(start, this.heuristic(this.nodes[start].position, goalPos));

    while (openSet.size() > 0) {
      const item = openSet.pop();
      if (!item) break;
      const current = item.id;
      if (closed.has(current)) continue;
      if (current === goal) {
        return this.cachePath(cacheKey, this.reconstructPath(cameFrom, current));
      }
      closed.add(current);

      for (const edge of this.nodes[current].edges) {
        if (closed.has(edge.to)) continue;
        const tentative = (gScore.get(current) ?? Infinity) + edge.cost;
        if (tentative < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentative);
          const score =
            tentative + this.heuristic(this.nodes[edge.to].position, goalPos);
          fScore.set(edge.to, score);
          openSet.push({ id: edge.to, score });
        }
      }
    }

    return this.cachePath(cacheKey, null);
  }

  private reconstructPath(cameFrom: Map<number, number>, end: number): number[] {
    const path = [end];
    let current = end;
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      path.unshift(current);
    }
    return path;
  }

  private heuristic(a: Vector3, b: Vector3): number {
    return a.distanceTo(b);
  }

  private cachePath(key: string, path: number[] | null): number[] | null {
    if (this.pathCache.size >= this.pathCacheMaxEntries) {
      const oldest = this.pathCache.keys().next().value as string | undefined;
      if (oldest) {
        this.pathCache.delete(oldest);
      }
    }
    this.pathCache.set(key, path);
    return path;
  }

  private ensureSpatialIndex(): void {
    if (this.spatialIndex) {
      return;
    }
    const index = new Map<string, number[]>();
    for (const node of this.nodes) {
      if (node.edges.length === 0) continue;
      const x = Math.floor(node.position.x / this.spatialCellSize);
      const z = Math.floor(node.position.z / this.spatialCellSize);
      const key = navCellKey(x, z);
      const ids = index.get(key) ?? [];
      ids.push(node.id);
      index.set(key, ids);
    }
    this.spatialIndex = index;
  }

  private ensureComponents(): void {
    if (this.componentIds) {
      return;
    }

    const ids = new Array<number>(this.nodes.length).fill(-1);
    const stack: number[] = [];
    let componentId = 0;

    for (const node of this.nodes) {
      if (ids[node.id] !== -1) {
        continue;
      }

      ids[node.id] = componentId;
      stack.push(node.id);

      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) {
          continue;
        }

        for (const edge of this.nodes[current].edges) {
          if (ids[edge.to] !== -1) {
            continue;
          }
          ids[edge.to] = componentId;
          stack.push(edge.to);
        }
      }

      componentId += 1;
    }

    this.componentIds = ids;
  }
}

interface QueueItem {
  id: number;
  score: number;
}

class MinHeap {
  private readonly items: QueueItem[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: QueueItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): QueueItem | null {
    if (this.items.length === 0) {
      return null;
    }
    const root = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return root;
  }

  private bubbleUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.items[parent].score <= this.items[child].score) {
        break;
      }
      this.swap(parent, child);
      child = parent;
    }
  }

  private sinkDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (
        left < this.items.length &&
        this.items[left].score < this.items[smallest].score
      ) {
        smallest = left;
      }
      if (
        right < this.items.length &&
        this.items[right].score < this.items[smallest].score
      ) {
        smallest = right;
      }
      if (smallest === parent) {
        break;
      }
      this.swap(parent, smallest);
      parent = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}

function navCellKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function formatNavVec(v: Vector3): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}
