import { Vector3 } from "three";
import { NavGraph } from "@engine/ai/NavGraph";
import type { Raycast } from "@engine/physics/Raycast";
import type { LevelDefinition } from "./LevelDefinition";

interface LevelBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface SampledNavNode {
  id: number;
  position: Vector3;
  gridX: number;
  gridZ: number;
}

export interface NavGraphBuildOptions {
  /** Distancia entre nodos del grid de muestreo. Menor = mÃ¡s denso. */
  spacing?: number;
  /** Distancia mÃ¡xima permitida para un edge entre dos nodos. */
  maxEdgeDistance?: number;
  /** Delta vertical mÃ¡xima entre dos nodos conectables (rechaza escalones altos). */
  maxStepHeight?: number;
  /** Altura desde la que se hace el raycast para encontrar suelo. */
  castFromY?: number;
  /** Profundidad mÃ¡xima del raycast. */
  castDepth?: number;
  /** Altura del rayo de visibility entre nodos (~rodilla del NPC). */
  losHeight?: number;
}

const tmpDown = new Vector3(0, -1, 0);

/**
 * Genera un `NavGraph` automÃ¡ticamente desde la geometrÃ­a del nivel.
 *
 * Algoritmo:
 *  1. Calcula bounds XZ a partir del terreno o de los staticBoxes.
 *  2. Samplea un grid 2D con `spacing` metros.
 *  3. En cada candidate, raycast hacia abajo desde Y alto. Si el primer hit
 *     es `static`, agrega un nodo en hit.point + offset chico.
 *  4. Conecta vecinos cercanos del grid si:
 *     - distancia â‰¤ `maxEdgeDistance`
 *     - delta vertical â‰¤ `maxStepHeight`
 *     - raycast a altura `losHeight` entre ambos no choca con geometrÃ­a sÃ³lida
 *
 * Los nodos sobre techos quedan automÃ¡ticamente aislados (sus LOS hacia
 * vecinos de suelo estÃ¡n bloqueados por las paredes) â€” el `NavGraph` los
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

    const sampledNodes: SampledNavNode[] = [];
    const nodeByGrid = new Map<string, SampledNavNode>();

    let candidatesSampled = 0;
    let hitsByKind: Record<string, number> = {};
    let hitsNone = 0;

    let gridX = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
      let gridZ = 0;
      for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
        candidatesSampled += 1;
        const origin = new Vector3(x, castFromY, z);
        const hit = raycast.cast(origin, tmpDown, castDepth);
        if (!hit) {
          hitsNone += 1;
        } else {
          const k = hit.metadata?.kind ?? "(none)";
          hitsByKind[k] = (hitsByKind[k] ?? 0) + 1;
        }
        if (hit && hit.metadata?.kind === "static") {
          const position = hit.point.clone();
          position.y += 0.1;
          const node = {
            id: graph.addNode(position),
            position,
            gridX,
            gridZ,
          };
          sampledNodes.push(node);
          nodeByGrid.set(gridKey(gridX, gridZ), node);
        }
        gridZ += 1;
      }
      gridX += 1;
    }

    let edgeAttempts = 0;
    let edgesAccepted = 0;
    let rejectedByDistance = 0;
    let rejectedByStep = 0;
    let rejectedByLos = 0;
    let losBlockerByKind: Record<string, number> = {};

    const neighborRange = Math.ceil(maxEdgeDistance / spacing);
    for (const a of sampledNodes) {
      for (let dx = -neighborRange; dx <= neighborRange; dx += 1) {
        for (let dz = -neighborRange; dz <= neighborRange; dz += 1) {
          if (dx < 0 || (dx === 0 && dz <= 0)) continue;
          const b = nodeByGrid.get(gridKey(a.gridX + dx, a.gridZ + dz));
          if (!b) continue;
          edgeAttempts += 1;
          const dist = a.position.distanceTo(b.position);
          if (dist > maxEdgeDistance) {
            rejectedByDistance += 1;
            continue;
          }
          if (Math.abs(a.position.y - b.position.y) > maxStepHeight) {
            rejectedByStep += 1;
            continue;
          }
          const losResult = this.lineOfSightWithReason(
            raycast,
            a.position,
            b.position,
            losHeight,
          );
          if (!losResult.ok) {
            rejectedByLos += 1;
            const k = losResult.blockerKind ?? "(none)";
            losBlockerByKind[k] = (losBlockerByKind[k] ?? 0) + 1;
            continue;
          }
          graph.addEdge(a.id, b.id, dist);
          edgesAccepted += 1;
        }
      }
    }

    let nodesWithoutEdges = 0;
    for (let i = 0; i < graph.nodeCount(); i += 1) {
      if (graph.edgeCountOf(i) === 0) nodesWithoutEdges += 1;
    }

    console.info("[NavGraphBuilder] build stats", {
      candidatesSampled,
      hitsNone,
      hitsByKind,
      nodesCreated: graph.nodeCount(),
      nodesWithoutEdges,
      edgeAttempts,
      edgesAccepted,
      rejectedByDistance,
      rejectedByStep,
      rejectedByLos,
      losBlockerByKind,
    });

    return graph;
  }

  private lineOfSightWithReason(
    raycast: Raycast,
    a: Vector3,
    b: Vector3,
    heightOffset: number,
  ): { ok: boolean; blockerKind?: string } {
    const from = a.clone();
    from.y += heightOffset;
    const to = b.clone();
    to.y += heightOffset;
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance < 0.001) return { ok: true };
    direction.divideScalar(distance);
    const hit = raycast.cast(from, direction, distance - 0.05);
    if (!hit) return { ok: true };
    if (hit.metadata?.kind !== "static") return { ok: true };
    return { ok: false, blockerKind: hit.metadata?.kind };
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

function gridKey(x: number, z: number): string {
  return `${x}:${z}`;
}
