import type { Vector3 } from 'three';
import type { BuildingArtifact, Doorway, Room } from './BuildingArtifact';

/**
 * Índice runtime sobre los `BuildingArtifact[]` que aporta un nivel. La IA
 * consulta este servicio para decidir breach/sweep/shove sobre edificios.
 * Construido en `LevelLoader` y expuesto vía `GameTokens.BuildingRegistry`.
 *
 * Las queries no asumen ningún cache externo: cada llamada recorre las
 * estructuras. Para 20-30 NPCs preguntando ~10 Hz cada uno con típicamente
 * < 10 buildings por nivel, está dentro del budget. Si crece se agrega
 * spatial hash sobre `envelope`.
 */
export class BuildingRegistry {
  private readonly buildings: readonly BuildingArtifact[];

  constructor(buildings: readonly BuildingArtifact[]) {
    this.buildings = buildings;
  }

  all(): readonly BuildingArtifact[] {
    return this.buildings;
  }

  containing(pos: Vector3): BuildingArtifact | null {
    for (const b of this.buildings) {
      if (pointInEnvelope(pos, b)) return b;
    }
    return null;
  }

  roomContaining(pos: Vector3): { building: BuildingArtifact; room: Room } | null {
    for (const b of this.buildings) {
      if (!pointInEnvelope(pos, b)) continue;
      for (const room of b.rooms) {
        if (pointInRoom(pos, room)) return { building: b, room };
      }
    }
    return null;
  }

  sameRoom(a: Vector3, b: Vector3): boolean {
    const ra = this.roomContaining(a);
    if (!ra) return false;
    const rb = this.roomContaining(b);
    if (!rb) return false;
    return ra.building.id === rb.building.id && ra.room.id === rb.room.id;
  }

  roomVolumeAt(pos: Vector3): number {
    return this.roomContaining(pos)?.room.volume ?? Infinity;
  }

  /**
   * Doorway más cercano (en distancia euclidiana al `from`) que toca el
   * `target` building. No usa pathfinding; eso lo hace `BreachBuilding`
   * después corriendo A* sobre los top-K candidatos.
   */
  nearestDoorway(from: Vector3, target: BuildingArtifact): Doorway | null {
    let best: Doorway | null = null;
    let bestDist = Infinity;
    for (const d of target.doorways) {
      const dx = d.position[0] - from.x;
      const dy = d.position[1] - from.y;
      const dz = d.position[2] - from.z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }
}

function pointInEnvelope(p: Vector3, b: BuildingArtifact): boolean {
  const { min, max } = b.envelope;
  return (
    p.x >= min[0] && p.x <= max[0] &&
    p.y >= min[1] && p.y <= max[1] &&
    p.z >= min[2] && p.z <= max[2]
  );
}

function pointInRoom(p: Vector3, room: Room): boolean {
  return (
    p.x >= room.min[0] && p.x <= room.max[0] &&
    p.y >= room.min[1] && p.y <= room.max[1] &&
    p.z >= room.min[2] && p.z <= room.max[2]
  );
}
