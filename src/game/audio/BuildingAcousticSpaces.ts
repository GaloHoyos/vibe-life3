import { Vector3 } from "three";
import type {
  AcousticPortal,
  AcousticSpace,
  AcousticSpaceProvider,
} from "@engine/audio/spatial/AcousticSpaceProvider";
import type { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";

/**
 * Implementa el contrato acústico del motor sobre las habitaciones y vanos que
 * ya produce `BuildingBuilder`.
 *
 * Es una mejora sobre la sonda por rayos, no un reemplazo: aporta la noción de
 * "otro cuarto" (que un rayo no distingue de "detrás de una columna") y la
 * posición del vano por el que se cuela el sonido. Donde no hay edificios, el
 * proveedor no se registra y la sonda sigue sola.
 */

const Exterior: AcousticSpace = { id: "exterior", volume: Number.POSITIVE_INFINITY };

/** Lo mínimo que hace falta del sistema de puertas (testeable con un stub). */
export interface DoorOpenState {
  isOpen(doorId: string): boolean;
}

export class BuildingAcousticSpaces implements AcousticSpaceProvider {
  constructor(
    private readonly buildings: BuildingRegistry,
    private readonly doors: DoorOpenState | null,
  ) {}

  spaceAt(position: Vector3): AcousticSpace {
    const found = this.buildings.roomContaining(position);
    if (!found) {
      return Exterior;
    }
    return {
      id: `${found.building.id}/${found.room.id}`,
      volume: found.room.volume,
    };
  }

  portalBetween(listener: Vector3, source: Vector3): AcousticPortal | null {
    // Se busca desde el lado que está adentro: el vano pertenece al edificio.
    const inside = this.buildings.containing(listener) ?? this.buildings.containing(source);
    if (!inside) {
      return null;
    }

    const from = this.buildings.containing(listener) ? listener : source;
    const doorway = this.buildings.nearestDoorway(from, inside);
    if (!doorway) {
      return null;
    }

    return {
      position: new Vector3(
        doorway.position[0],
        doorway.position[1],
        doorway.position[2],
      ),
      width: doorway.width,
      height: doorway.height,
      open: this.opennessOf(doorway.doorId),
    };
  }

  private opennessOf(doorId: string | undefined): number {
    if (!doorId || !this.doors) {
      // Un vano sin puerta siempre está abierto.
      return 1;
    }
    return this.doors.isOpen(doorId) ? 1 : 0;
  }
}
