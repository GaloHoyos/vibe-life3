import type { VectorTuple } from '@shared/math/VectorTuple';

/**
 * Interfaz estructural que el `NavSpaceBuilder` necesita de cada edificio del
 * nivel. Vive en `engine` para preservar la regla de capa: engine no importa
 * de game. El tipo `BuildingArtifact` de `game/levels/buildings/` la satisface
 * por shape sin necesidad de implements explicito.
 */
export interface BuildingRoomInput {
  id: string;
  min: VectorTuple;
  max: VectorTuple;
}

export interface BuildingDoorwayInput {
  id: string;
  position: VectorTuple;
  normal: VectorTuple;
  width: number;
  height: number;
  doorId?: string;
  rooms: readonly [string | null, string | null];
}

export interface BuildingInput {
  id: string;
  envelope: { min: VectorTuple; max: VectorTuple };
  rooms: readonly BuildingRoomInput[];
  doorways: readonly BuildingDoorwayInput[];
}
