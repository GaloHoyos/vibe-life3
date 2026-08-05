import { Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import type { VehicleCrewRole } from '@game/config/vehicles.config';
import { isAtTheControls } from '@game/config/vehicles.config';
import type { VehicleAccessPolicy } from '@game/levels/LevelDefinition';
import type { NpcVehicleCapability } from '@game/npc/core/INpc';
import { canUseVehicleRole } from '@game/gameplay/vehicles/VehicleAccessPolicy';
import type { VehicleNavPoint } from './VehicleAiTypes';

/** Asiento libre de un vehículo utilizable, tal como lo ve un NPC a pie. */
export interface VehicleSeatOffer {
  readonly vehicleId: string;
  readonly profileId: string;
  readonly seatId: string;
  readonly role: VehicleCrewRole;
  /** Centro del vehículo. */
  readonly position: Vector3;
  /** Por dónde se sube: la salida del asiento. */
  readonly boarding: Vector3;
  /** Velocidad que este vehículo sostiene de verdad. */
  readonly cruiseSpeed: number;
  /** Ya hay alguien a los mandos, propio o ajeno. */
  readonly hasDriver: boolean;
  /** Lo que decide quién puede usarlo. */
  readonly access: {
    readonly accessPolicy?: VehicleAccessPolicy;
    readonly faction?: Faction;
  };
  /** El nivel lo asignó a un setpiece: la oportunidad no lo toca. */
  readonly authored: boolean;
}

export interface VehicleOpportunityActor {
  readonly id: string;
  readonly faction: Faction;
  readonly vehicleCapability?: NpcVehicleCapability | null;
}

/**
 * Catálogo consultable de asientos libres, en el mismo espíritu que el
 * `TacticalMap` de cobertura: `VehicleSystem` republica la foto cada tick y los
 * sensores de cada NPC preguntan. Depende sólo de datos planos para que la
 * decisión de embarque se pueda probar sin levantar física ni nivel.
 */
export class VehicleOpportunityRegistry {
  private offers: readonly VehicleSeatOffer[] = [];
  private travel: (profileId: string, from: VehicleNavPoint, to: VehicleNavPoint) => number | null =
    () => null;

  publish(
    offers: readonly VehicleSeatOffer[],
    travelDistance?: (profileId: string, from: VehicleNavPoint, to: VehicleNavPoint) => number | null,
  ): void {
    this.offers = offers;
    if (travelDistance) this.travel = travelDistance;
  }

  /**
   * Asientos que este actor puede ocupar, del más cercano al más lejano. Los
   * mandos van primero a igual distancia: un vehículo sin conductor no le sirve
   * a nadie, así que conviene que el primero que llegue se ponga a manejar.
   */
  offersFor(
    actor: VehicleOpportunityActor,
    position: Vector3,
    radius: number,
  ): VehicleSeatOffer[] {
    const radiusSquared = radius * radius;
    return this.offers
      .filter((offer) => {
        if (offer.authored) return false;
        if (position.distanceToSquared(offer.position) > radiusSquared) return false;
        return canUseVehicleRole(
          { kind: 'npc', faction: actor.faction, vehicleCapability: actor.vehicleCapability },
          offer.access,
          offer.role,
        );
      })
      .sort((first, second) => {
        const byControls = Number(isAtTheControls(second.role)) - Number(isAtTheControls(first.role));
        if (byControls !== 0) return byControls;
        return (
          position.distanceToSquared(first.position) -
          position.distanceToSquared(second.position)
        );
      });
  }

  /** Metros manejables entre dos puntos para el perfil de la oferta. */
  travelDistance(offer: VehicleSeatOffer, to: Vector3): number | null {
    return this.travel(
      offer.profileId,
      [offer.position.x, offer.position.y, offer.position.z],
      [to.x, to.y, to.z],
    );
  }

  clear(): void {
    this.offers = [];
  }
}
