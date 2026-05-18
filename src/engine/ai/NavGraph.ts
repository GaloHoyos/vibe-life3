import { Vector3 } from "three";

interface NavNode {
  id: number;
  position: Vector3;
  edges: Array<{ to: number; cost: number }>;
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

  addNode(position: Vector3): number {
    const id = this.nodes.length;
    this.nodes.push({ id, position: position.clone(), edges: [] });
    return id;
  }

  addEdge(a: number, b: number, cost: number): void {
    const nodeA = this.nodes[a];
    const nodeB = this.nodes[b];
    if (!nodeA || !nodeB) return;
    nodeA.edges.push({ to: b, cost });
    nodeB.edges.push({ to: a, cost });
  }

  nodeCount(): number {
    return this.nodes.length;
  }

  getNode(id: number): Vector3 | null {
    return this.nodes[id]?.position.clone() ?? null;
  }

  /**
   * Encuentra el nodo navegable más cercano a `position`. Considera solo
   * nodos con al menos 1 edge (un nodo aislado, e.g. en un techo, no sirve
   * como entry point). Devuelve null si todo está aislado.
   */
  nearestConnectedNode(position: Vector3, maxDistance = 12): number | null {
    let best = -1;
    let bestDistSq = maxDistance * maxDistance;
    for (const node of this.nodes) {
      if (node.edges.length === 0) continue;
      const dSq = node.position.distanceToSquared(position);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = node.id;
      }
    }
    return best >= 0 ? best : null;
  }

  /**
   * A* entre dos posiciones world-space. Snapea a los nodos navegables más
   * cercanos, busca el path, devuelve la lista de positions (incluyendo el
   * `to` final). Si no hay camino, devuelve `[to]` para que el caller siga
   * usando steering directo.
   */
  findPath(from: Vector3, to: Vector3): Vector3[] {
    const startId = this.nearestConnectedNode(from);
    const goalId = this.nearestConnectedNode(to);
    if (startId === null || goalId === null) {
      return [to.clone()];
    }
    if (startId === goalId) {
      return [to.clone()];
    }

    const path = this.aStar(startId, goalId);
    if (!path) return [to.clone()];

    const positions: Vector3[] = [];
    for (const id of path) {
      positions.push(this.nodes[id].position.clone());
    }
    positions.push(to.clone());
    return positions;
  }

  private aStar(start: number, goal: number): number[] | null {
    const goalPos = this.nodes[goal].position;
    const openSet = new Set<number>([start]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();
    gScore.set(start, 0);
    fScore.set(start, this.heuristic(this.nodes[start].position, goalPos));

    while (openSet.size > 0) {
      let current = -1;
      let currentF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < currentF) {
          currentF = f;
          current = id;
        }
      }
      if (current === goal) {
        return this.reconstructPath(cameFrom, current);
      }
      openSet.delete(current);

      for (const edge of this.nodes[current].edges) {
        const tentative = (gScore.get(current) ?? Infinity) + edge.cost;
        if (tentative < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentative);
          fScore.set(
            edge.to,
            tentative + this.heuristic(this.nodes[edge.to].position, goalPos),
          );
          openSet.add(edge.to);
        }
      }
    }

    return null;
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
}
