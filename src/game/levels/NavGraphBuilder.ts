import { Vector3 } from "three";
import { NavGraph } from "../../engine/ai/NavGraph";
import type { Raycast } from "../../engine/physics/Raycast";
import type { LevelDefinition } from "./LevelDefinition";

interface LevelBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NavGraphBuildOptions {
  /** Distancia entre nodos del grid de muestreo. Menor = más denso. */
  spacing?: number;
  /** Distancia máxima permitida para un edge entre dos nodos. */
  maxEdgeDistance?: number;
  /** Delta vertical máxima entre dos nodos conectables (rechaza escalones altos). */
  maxStepHeight?: number;
  /** Altura desde la que se hace el raycast para encontrar suelo. */
  castFromY?: number;
  /** Profundidad máxima del raycast. */
  castDepth?: number;
  /** Altura del rayo de visibility entre nodos (~rodilla del NPC). */
  losHeight?: number;
}

const tmpDown = new Vector3(0, -1, 0);

/**
 * Genera un `NavGraph` automáticamente desde la geometría del nivel.
 *
 * Algoritmo:
 *  1. Calcula bounds XZ a partir del terreno o de los staticBoxes.
 *  2. Samplea un grid 2D con `spacing` metros.
 *  3. En cada candidate, raycast hacia abajo desde Y alto. Si el primer hit
 *     es `static`, agrega un nodo en hit.point + offset chico.
 *  4. Conecta cada par de nodos cercanos si:
 *     - distancia ≤ `maxEdgeDistance`
 *     - delta vertical ≤ `maxStepHeight`
 *     - raycast a altura `losHeight` entre ambos no choca con geometría sólida
 *
 * Los nodos sobre techos quedan automáticamente aislados (sus LOS hacia
 * vecinos de suelo están bloqueados por las paredes) — el `NavGraph` los
 * ignora porque `nearestConnectedNode` salta nodos sin edges.
 */
export class NavGraphBuilder {
  build(
    level: LevelDefinition,
    raycast: Raycast,
    options: NavGraphBuildOptions = {},
  ): NavGraph {
    const spacing = options.spacing ?? 4;
    const maxEdgeDistance = options.maxEdgeDistance ?? spacing * 1.7;
    const maxStepHeight = options.maxStepHeight ?? 1.4;
    const castFromY = options.castFromY ?? 40;
    const castDepth = options.castDepth ?? 60;
    const losHeight = options.losHeight ?? 0.9;

    const graph = new NavGraph();
    const bounds = this.computeBounds(level);
    if (!bounds) return graph;

    const sampledNodes: Array<{ id: number; position: Vector3 }> = [];

    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
        const origin = new Vector3(x, castFromY, z);
        const hit = raycast.cast(origin, tmpDown, castDepth);
        if (!hit || hit.metadata?.kind !== "static") continue;
        const position = hit.point.clone();
        position.y += 0.1;
        const id = graph.addNode(position);
        sampledNodes.push({ id, position });
      }
    }

    for (let i = 0; i < sampledNodes.length; i += 1) {
      const a = sampledNodes[i];
      for (let j = i + 1; j < sampledNodes.length; j += 1) {
        const b = sampledNodes[j];
        const dist = a.position.distanceTo(b.position);
        if (dist > maxEdgeDistance) continue;
        if (Math.abs(a.position.y - b.position.y) > maxStepHeight) continue;
        if (!this.lineOfSight(raycast, a.position, b.position, losHeight))
          continue;
        graph.addEdge(a.id, b.id, dist);
      }
    }

    return graph;
  }

  private lineOfSight(
    raycast: Raycast,
    a: Vector3,
    b: Vector3,
    heightOffset: number,
  ): boolean {
    const from = a.clone();
    from.y += heightOffset;
    const to = b.clone();
    to.y += heightOffset;
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance < 0.001) return true;
    direction.divideScalar(distance);
    const hit = raycast.cast(from, direction, distance - 0.05);
    if (!hit) return true;
    return hit.metadata?.kind !== "static";
  }

  private computeBounds(level: LevelDefinition): LevelBounds | null {
    if (level.terrain) {
      const [sx, sz] = level.terrain.size;
      const cx = level.terrain.position[0];
      const cz = level.terrain.position[2];
      return {
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
      };
    }

    if (level.staticBoxes.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const box of level.staticBoxes) {
      const [x, , z] = box.position;
      const [sx, , sz] = box.size;
      minX = Math.min(minX, x - sx / 2);
      maxX = Math.max(maxX, x + sx / 2);
      minZ = Math.min(minZ, z - sz / 2);
      maxZ = Math.max(maxZ, z + sz / 2);
    }
    const margin = 4;
    return {
      minX: minX - margin,
      maxX: maxX + margin,
      minZ: minZ - margin,
      maxZ: maxZ + margin,
    };
  }
}
