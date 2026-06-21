import type { VectorTuple } from '@shared/math/VectorTuple';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';

export type DoorwaySide = 'north' | 'south' | 'east' | 'west';

/**
 * Apertura navegable entre dos zonas. Puede ser un hueco libre o una puerta
 * operable (cuando `doorId` está poblado). El navspace lo materializa como un
 * portal tipo `door`, costo y resolución de "abrir si está cerrada" los maneja
 * el `DoorInteractor` runtime.
 *
 * `rooms[0]` y `rooms[1]` son los ids de las habitaciones a cada lado del
 * doorway. `null` representa "exterior" (fuera del edificio).
 */
export interface Doorway {
  id: string;
  position: VectorTuple;
  /** Normal unitaria apuntando desde `rooms[0]` hacia `rooms[1]`. */
  normal: VectorTuple;
  width: number;
  height: number;
  doorId?: string;
  rooms: [string | null, string | null];
}

export interface Room {
  id: string;
  min: VectorTuple;
  max: VectorTuple;
  volume: number;
  label?: string;
}

export interface BuildingEnvelope {
  min: VectorTuple;
  max: VectorTuple;
}

export interface BuildingArtifact {
  id: string;
  boxes: StaticBoxDefinition[];
  doorways: Doorway[];
  rooms: Room[];
  envelope: BuildingEnvelope;
}

export function normalForSide(side: DoorwaySide): VectorTuple {
  switch (side) {
    case 'north':
      return [0, 0, -1];
    case 'south':
      return [0, 0, 1];
    case 'east':
      return [1, 0, 0];
    case 'west':
      return [-1, 0, 0];
  }
}
