import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { VectorTuple } from "@shared/math/VectorTuple";

export interface CoverPointDefinition {
  id: string;
  /** PosiciÃ³n world donde el NPC se para para cubrirse. */
  position: VectorTuple;
  /** DirecciÃ³n (normalizada) hacia donde el cover protege. Si el threat
   *  estÃ¡ en esta direcciÃ³n, el obstÃ¡culo bloquea la LOS. */
  normal: VectorTuple;
}

interface CoverPointRuntime {
  def: CoverPointDefinition;
  position: Vector3;
  normal: Vector3;
  occupiedBy: string | null;
  /** Cache del Ãºltimo score evaluado, para que la UI/debug pueda verlo. */
  lastScore: number;
}

const tmpToThreat = new Vector3();
const tmpToNpc = new Vector3();
const tmpEyes = new Vector3();
const tmpDir = new Vector3();

/**
 * Repositorio de cover points del nivel actual.
 *
 * Hand-placed por ahora: el `LevelDefinition` aporta una lista de
 * `CoverPointDefinition`. En S2 sumaremos auto-generaciÃ³n desde
 * `StaticBoxDefinition`. La API que consumen los NPCs es la misma:
 * `findBestCover(npcPosition, threatPosition, excludeOccupied?)`.
 *
 * Scoring por cover (mayor = mejor):
 *  - +30 si bloquea LOS del threat al cover position
 *  - +(1 / distanceToNpc) escalado
 *  - -50 si estÃ¡ ocupado por otro NPC
 *  - -20 si el threat estÃ¡ mÃ¡s cerca del cover que el NPC (cover "delante" del threat)
 *  - +10 si el normal del cover apunta lejos del threat (buena orientaciÃ³n)
 */
export class CoverSystem {
  private readonly points = new Map<string, CoverPointRuntime>();

  constructor(private readonly raycast: Raycast) {}

  load(definitions: readonly CoverPointDefinition[]): void {
    this.points.clear();
    for (const def of definitions) {
      this.points.set(def.id, {
        def,
        position: new Vector3(def.position[0], def.position[1], def.position[2]),
        normal: new Vector3(def.normal[0], def.normal[1], def.normal[2]).normalize(),
        occupiedBy: null,
        lastScore: 0,
      });
    }
  }

  /**
   * Reclama el cover para el NPC indicado. Si ya estaba ocupado por otro
   * NPC, no hace nada y devuelve false. Idempotente para el mismo NPC.
   */
  claim(coverId: string, npcId: string): boolean {
    const point = this.points.get(coverId);
    if (!point) return false;
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) {
      return false;
    }
    point.occupiedBy = npcId;
    return true;
  }

  release(coverId: string, npcId: string): void {
    const point = this.points.get(coverId);
    if (!point) return;
    if (point.occupiedBy === npcId) {
      point.occupiedBy = null;
    }
  }

  /** Libera cualquier cover que tuviera el NPC reservado. */
  releaseAllOf(npcId: string): void {
    for (const point of this.points.values()) {
      if (point.occupiedBy === npcId) {
        point.occupiedBy = null;
      }
    }
  }

  getCoverPosition(coverId: string): Vector3 | null {
    return this.points.get(coverId)?.position.clone() ?? null;
  }

  /**
   * Busca el mejor cover para el NPC dado el threat. Retorna `null` si
   * ningÃºn cover tiene score positivo (todos peor que estar expuesto).
   */
  findBestCover(
    npcId: string,
    npcPosition: Vector3,
    threatPosition: Vector3,
    maxDistance = 25,
  ): { id: string; position: Vector3 } | null {
    let bestId: string | null = null;
    let bestScore = 0;

    for (const point of this.points.values()) {
      const distToNpc = point.position.distanceTo(npcPosition);
      if (distToNpc > maxDistance) continue;
      const score = this.scoreCoverPoint(point, npcId, npcPosition, threatPosition);
      point.lastScore = score;
      if (score > bestScore) {
        bestScore = score;
        bestId = point.def.id;
      }
    }

    if (!bestId) return null;
    return { id: bestId, position: this.points.get(bestId)!.position.clone() };
  }

  /** Devuelve true si el cover actual todavÃ­a protege al NPC del threat. */
  isStillValid(
    coverId: string,
    npcId: string,
    threatPosition: Vector3,
  ): boolean {
    const point = this.points.get(coverId);
    if (!point) return false;
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) return false;
    return this.blocksLineOfSight(point, threatPosition);
  }

  private scoreCoverPoint(
    point: CoverPointRuntime,
    npcId: string,
    npcPosition: Vector3,
    threatPosition: Vector3,
  ): number {
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) {
      return -50;
    }

    let score = 0;
    if (this.blocksLineOfSight(point, threatPosition)) {
      score += 30;
    } else {
      return 0;
    }

    const distToNpc = point.position.distanceTo(npcPosition);
    score += Math.max(0, 15 - distToNpc * 0.6);

    const distToThreat = point.position.distanceTo(threatPosition);
    if (distToThreat < distToNpc * 0.5) {
      score -= 20;
    }
    if (distToThreat < 3) {
      score -= 25;
    }

    tmpToThreat.copy(threatPosition).sub(point.position).setY(0).normalize();
    const facingThreat = point.normal.clone().setY(0).normalize().dot(tmpToThreat);
    if (facingThreat < -0.2) {
      score += 10;
    }

    return score;
  }

  private blocksLineOfSight(
    point: CoverPointRuntime,
    threatPosition: Vector3,
  ): boolean {
    tmpEyes.copy(point.position);
    tmpEyes.y += 1.4;
    tmpDir.copy(threatPosition).sub(tmpEyes);
    const distance = tmpDir.length();
    if (distance < 0.1) return false;
    tmpDir.divideScalar(distance);
    const hit = this.raycast.cast(tmpEyes, tmpDir, distance);
    if (!hit) return false;
    return hit.metadata?.kind === "static" || hit.metadata?.kind === "dynamic";
  }
}
