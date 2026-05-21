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

interface StairAnchor {
  group: string;
  index: number;
}

interface SampledNavNode {
  id: number;
  position: Vector3;
  gridX: number;
  gridZ: number;
  stair: StairAnchor | null;
}

interface SurfaceCandidate {
  position: Vector3;
  stair: StairAnchor | null;
  surfaceId: string;
}

type StairConnectionKind = "normal" | "chain" | "endpoint" | "reject";

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
  /** Separación máxima entre muestras de soporte al validar un edge. */
  supportSampleSpacing?: number;
  /** Penalización de coste por metro vertical para preferir rutas suaves. */
  verticalCostMultiplier?: number;
}

const tmpDown = new Vector3(0, -1, 0);
const tmpUp = new Vector3(0, 1, 0);
const edgeProbe = new Vector3();
const NODE_LIFT = 0.1;

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
    const supportSampleSpacing = options.supportSampleSpacing ?? 1.4;
    const verticalCostMultiplier = options.verticalCostMultiplier ?? 1.35;
    const nodeLift = NODE_LIFT;

    const graph = new NavGraph();
    const bounds = this.computeBounds(level);
    if (!bounds) return graph;

    const sampledNodes: SampledNavNode[] = [];
    const nodeByCell = new Map<string, SampledNavNode[]>();
    const occupiedSamples = new Set<string>();

    let candidatesSampled = 0;
    let hitsByKind: Record<string, number> = {};
    let hitsNone = 0;
    let surfaceNodes = 0;
    let rejectedByClearance = 0;

    let gridX = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
      let gridZ = 0;
      for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
        candidatesSampled += 1;
        if (level.terrain) {
          const origin = new Vector3(x, castFromY, z);
          const hit = raycast.cast(origin, tmpDown, castDepth);
          if (!hit) {
            hitsNone += 1;
          } else {
            const k = hit.metadata?.kind ?? "(none)";
            hitsByKind[k] = (hitsByKind[k] ?? 0) + 1;
          }
          if (hit?.metadata?.id === level.terrain.id) {
            const position = hit.point.clone();
            position.y += nodeLift;
            if (this.hasCharacterClearance(raycast, position)) {
              this.addSampledNode(
                graph,
                sampledNodes,
                nodeByCell,
                occupiedSamples,
                position,
                gridX,
                gridZ,
                null,
                level.terrain.id,
              );
            } else {
              rejectedByClearance += 1;
            }
          }
        }
        gridZ += 1;
      }
      gridX += 1;
    }

    const surfaces = this.collectStaticSurfaceCandidates(level, spacing, nodeLift);
    for (const surface of surfaces) {
      const sampleGridX = Math.round((surface.position.x - bounds.minX) / spacing);
      const sampleGridZ = Math.round((surface.position.z - bounds.minZ) / spacing);
      const isStairSurface = surface.stair !== null;
      if (
        isStairSurface ||
        this.hasCharacterClearance(raycast, surface.position)
      ) {
        this.addSampledNode(
          graph,
          sampledNodes,
          nodeByCell,
          occupiedSamples,
          surface.position,
          sampleGridX,
          sampleGridZ,
          surface.stair,
          surface.surfaceId,
        );
        surfaceNodes += 1;
      } else {
        rejectedByClearance += 1;
      }
    }

    const stairGroupMaxIndex = new Map<string, number>();
    for (const node of sampledNodes) {
      if (!node.stair) continue;
      const current = stairGroupMaxIndex.get(node.stair.group) ?? -1;
      if (node.stair.index > current) {
        stairGroupMaxIndex.set(node.stair.group, node.stair.index);
      }
    }

    let edgeAttempts = 0;
    let edgesAccepted = 0;
    let explicitStairEdges = 0;
    let rejectedByDistance = 0;
    let rejectedByStep = 0;
    let rejectedByStair = 0;
    let rejectedBySupport = 0;
    let rejectedByLos = 0;
    let losBlockerByKind: Record<string, number> = {};

    const neighborRange = Math.ceil(maxEdgeDistance / spacing);
    for (const a of sampledNodes) {
      for (let dx = -neighborRange; dx <= neighborRange; dx += 1) {
        for (let dz = -neighborRange; dz <= neighborRange; dz += 1) {
          const bucket = nodeByCell.get(gridKey(a.gridX + dx, a.gridZ + dz));
          if (!bucket) continue;
          for (const b of bucket) {
            if (a.id >= b.id) continue;
            edgeAttempts += 1;
            const stairConnection = this.stairConnectionKind(
              a,
              b,
              stairGroupMaxIndex,
            );
            if (stairConnection === "reject") {
              rejectedByStair += 1;
              continue;
            }
            const dist = a.position.distanceTo(b.position);
            if (dist > maxEdgeDistance) {
              rejectedByDistance += 1;
              continue;
            }
            if (Math.abs(a.position.y - b.position.y) > maxStepHeight) {
              rejectedByStep += 1;
              continue;
            }
            if (stairConnection === "chain") {
              graph.addEdge(
                a.id,
                b.id,
                this.edgeCost(a.position, b.position, verticalCostMultiplier),
              );
              edgesAccepted += 1;
              explicitStairEdges += 1;
              continue;
            }
            if (
              !this.hasEdgeSupport(
                raycast,
                a.position,
                b.position,
                maxStepHeight,
                supportSampleSpacing,
              )
            ) {
              rejectedBySupport += 1;
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
            graph.addEdge(
              a.id,
              b.id,
              this.edgeCost(a.position, b.position, verticalCostMultiplier),
            );
            edgesAccepted += 1;
          }
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
      surfaceCandidates: surfaces.length,
      surfaceNodes,
      stairGroups: stairGroupMaxIndex.size,
      nodesCreated: graph.nodeCount(),
      nodesWithoutEdges,
      edgeAttempts,
      edgesAccepted,
      explicitStairEdges,
      rejectedByDistance,
      rejectedByStep,
      rejectedByStair,
      rejectedBySupport,
      rejectedByLos,
      rejectedByClearance,
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
    if (hit.metadata?.kind !== "static" && hit.metadata?.kind !== "door") {
      return { ok: true };
    }
    return { ok: false, blockerKind: hit.metadata?.kind };
  }

  private hasEdgeSupport(
    raycast: Raycast,
    a: Vector3,
    b: Vector3,
    maxStepHeight: number,
    sampleSpacing: number,
  ): boolean {
    const sampleCount = Math.max(3, Math.ceil(a.distanceTo(b) / sampleSpacing));
    for (let i = 1; i < sampleCount; i += 1) {
      edgeProbe.copy(a).lerp(b, i / sampleCount);
      const expectedY = edgeProbe.y;
      edgeProbe.y += 0.7;
      const hit = raycast.cast(edgeProbe, tmpDown, maxStepHeight + 1.0);
      if (!hit) return false;
      if (hit.metadata?.kind === "door") return false;
      if (hit.metadata?.kind !== "static") continue;
      const supportedY = hit.point.y + NODE_LIFT;
      if (Math.abs(supportedY - expectedY) > maxStepHeight) {
        return false;
      }
    }
    return true;
  }

  private edgeCost(
    a: Vector3,
    b: Vector3,
    verticalCostMultiplier: number,
  ): number {
    const horizontal = Math.hypot(a.x - b.x, a.z - b.z);
    const vertical = Math.abs(a.y - b.y);
    return a.distanceTo(b) + vertical * verticalCostMultiplier + horizontal * 0.02;
  }

  private collectStaticSurfaceCandidates(
    level: LevelDefinition,
    spacing: number,
    nodeLift: number,
  ): SurfaceCandidate[] {
    const out: SurfaceCandidate[] = [];
    const halfStep = spacing / 2;
    for (const box of level.staticBoxes) {
      if (!this.isWalkableBox(box)) continue;
      const [cx, cy, cz] = box.position;
      const [sx, sy, sz] = box.size;
      const minX = cx - sx / 2 + Math.min(halfStep, sx / 2);
      const maxX = cx + sx / 2 - Math.min(halfStep, sx / 2);
      const minZ = cz - sz / 2 + Math.min(halfStep, sz / 2);
      const maxZ = cz + sz / 2 - Math.min(halfStep, sz / 2);
      const y = cy + sy / 2 + nodeLift;

      const stair = this.parseStairId(box.id);
      for (let x = minX; x <= maxX + 0.001; x += spacing) {
        for (let z = minZ; z <= maxZ + 0.001; z += spacing) {
          out.push({
            position: new Vector3(x, y, z),
            stair,
            surfaceId: box.id,
          });
        }
      }
    }
    return out;
  }

  /**
   * Reconoce nodos generados sobre escalones de un `buildRamp` (id =
   * `<grupo>-step-<n>`). El builder usa esto para que solo el primer y
   * último escalón de cada grupo se conecten con nodos ajenos al staircase;
   * los intermedios quedan unidos a sus vecinos del mismo grupo y nada más.
   */
  private parseStairId(id: string): StairAnchor | null {
    const match = /^(.+)-step-(\d+)$/.exec(id);
    if (!match) return null;
    const index = Number.parseInt(match[2], 10);
    if (!Number.isFinite(index)) return null;
    return { group: match[1], index };
  }

  /**
   * Clasifica conexiones de escalera para tratarlas como links explícitos.
   * Las cadenas internas no dependen de soporte ni LOS porque cada escalón
   * ya es la superficie caminable; las entradas y salidas siguen validando
   * el entorno como cualquier edge normal.
   */
  private stairConnectionKind(
    a: SampledNavNode,
    b: SampledNavNode,
    maxIndexByGroup: Map<string, number>,
  ): StairConnectionKind {
    if (a.stair && b.stair) {
      const sameAdjacentGroup =
        a.stair.group === b.stair.group &&
        Math.abs(a.stair.index - b.stair.index) <= 1;
      return sameAdjacentGroup ? "chain" : "reject";
    }
    const stair = a.stair ?? b.stair;
    if (!stair) return "normal";
    const maxIndex = maxIndexByGroup.get(stair.group) ?? 0;
    return stair.index === 0 || stair.index === maxIndex
      ? "endpoint"
      : "reject";
  }

  private isWalkableBox(box: LevelDefinition["staticBoxes"][number]): boolean {
    const [, sy] = box.size;
    if (sy > 0.75) return false;
    if (
      box.material !== "floor" &&
      box.material !== "trim" &&
      box.material !== "roof" &&
      box.material !== "rock"
    ) {
      return false;
    }
    return !/(wall|rail|mast|cross|pipe|stack|console|lightbar|barrier)/i.test(box.id);
  }

  private hasCharacterClearance(raycast: Raycast, position: Vector3): boolean {
    const origin = position.clone();
    origin.y += 0.1;
    const hit = raycast.cast(origin, tmpUp, 1.65);
    if (!hit) return true;
    return hit.metadata?.kind !== "static" && hit.metadata?.kind !== "door";
  }

  private addSampledNode(
    graph: NavGraph,
    sampledNodes: SampledNavNode[],
    nodeByCell: Map<string, SampledNavNode[]>,
    occupiedSamples: Set<string>,
    position: Vector3,
    gridX: number,
    gridZ: number,
    stair: StairAnchor | null,
    surfaceId: string,
  ): void {
    const sampleKey = [
      Math.round(position.x * 10),
      Math.round(position.y * 10),
      Math.round(position.z * 10),
    ].join(":");
    if (occupiedSamples.has(sampleKey)) {
      return;
    }
    occupiedSamples.add(sampleKey);
    const node: SampledNavNode = {
      id: graph.addNode(position, {
        ...(stair
          ? { stairGroup: stair.group, stairIndex: stair.index }
          : {}),
        surfaceId,
      }),
      position,
      gridX,
      gridZ,
      stair,
    };
    sampledNodes.push(node);
    const key = gridKey(gridX, gridZ);
    const bucket = nodeByCell.get(key) ?? [];
    bucket.push(node);
    nodeByCell.set(key, bucket);
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
