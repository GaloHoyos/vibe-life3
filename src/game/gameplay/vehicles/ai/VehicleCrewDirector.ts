import type { Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';
import type { VehicleCrewRole } from '@game/config/vehicles.config';
import type { NpcVehicleSeatBroker } from '@game/npc/brain/NpcVehicleSensor';
import type {
  VehicleOpportunityActor,
  VehicleSeatOffer,
} from './VehicleOpportunityRegistry';

/**
 * Quien reserva de verdad el asiento y empuja la orden de aproximación.
 * Lo implementa `VehicleSystem`, que sigue siendo la autoridad: el director sólo
 * decide a quién dejar pedir.
 */
export interface VehicleCrewGrantSource {
  grantSeat(
    actorId: string,
    vehicleId: string,
    seatId: string,
    role: VehicleCrewRole,
  ): boolean;
  cancelSeat(actorId: string): void;
}

interface CrewClaim {
  readonly vehicleId: string;
  readonly faction: Faction;
}

/** Pedido de recogida de una facción. Uno por facción: no hay cola. */
export interface VehicleExtractionRequest {
  readonly faction: Faction;
  /** Dónde está la gente que espera. */
  readonly position: Vector3;
  readonly actors: ReadonlySet<string>;
  /** Aparato asignado, o `null` mientras no haya ninguno disponible. */
  readonly vehicleId: string | null;
  readonly requestedAt: number;
}

/**
 * Arbitra el uso oportunista de vehículos por facción, en el mismo molde que el
 * `SquadDirector`: cupo, veda tras una pérdida, y una sola puerta de entrada.
 *
 * El cupo cuenta vehículos distintos, no tripulantes: que tres soldados suban al
 * mismo buggy es justamente lo que se quiere, y lo que no se quiere es que seis
 * soldados salgan corriendo cada uno hacia un vehículo distinto.
 */
export class VehicleCrewDirector implements NpcVehicleSeatBroker {
  private readonly claims = new Map<string, CrewClaim>();
  private readonly cooldownUntil = new Map<Faction, number>();
  private readonly extractions = new Map<Faction, VehicleExtractionRequest>();
  private elapsed = 0;

  constructor(private readonly grants: VehicleCrewGrantSource) {}

  update(elapsed: number): void {
    this.elapsed = elapsed;
  }

  requestSeat(actor: VehicleOpportunityActor, offer: VehicleSeatOffer): boolean {
    if (this.claims.has(actor.id)) return false;
    if (this.elapsed < (this.cooldownUntil.get(actor.faction) ?? 0)) return false;
    if (
      !this.activeVehicles(actor.faction).has(offer.vehicleId) &&
      this.activeVehicles(actor.faction).size >= VEHICLE_CREW_DECISION.maxActivePerFaction
    ) {
      return false;
    }
    if (!this.grants.grantSeat(actor.id, offer.vehicleId, offer.seatId, offer.role)) {
      return false;
    }
    this.claims.set(actor.id, { vehicleId: offer.vehicleId, faction: actor.faction });
    return true;
  }

  releaseSeat(actorId: string): void {
    if (!this.claims.delete(actorId)) return;
    this.grants.cancelSeat(actorId);
  }

  /** Suelta el claim sin cancelar nada: el actor ya subió o murió. */
  forget(actorId: string): void {
    this.claims.delete(actorId);
  }

  /**
   * Un vehículo de la facción quedó destruido o inservible. La veda evita que la
   * escuadra siga mandando gente al mismo lugar de a uno.
   */
  notifyVehicleLost(faction: Faction): void {
    this.cooldownUntil.set(
      faction,
      this.elapsed + VEHICLE_CREW_DECISION.lossCooldownSeconds,
    );
  }

  claimedVehicle(actorId: string): string | null {
    return this.claims.get(actorId)?.vehicleId ?? null;
  }

  activeVehicles(faction: Faction): ReadonlySet<string> {
    const active = new Set<string>();
    for (const claim of this.claims.values()) {
      if (claim.faction === faction) active.add(claim.vehicleId);
    }
    return active;
  }

  /**
   * Pide recogida para un actor. Los pedidos de la misma facción se funden en
   * uno: un aparato baja una vez y sube a todos los que estén esperando, no una
   * pasada por soldado.
   */
  requestExtraction(actor: VehicleOpportunityActor, position: Vector3): void {
    const current = this.extractions.get(actor.faction);
    if (current) {
      this.extractions.set(actor.faction, {
        ...current,
        actors: new Set([...current.actors, actor.id]),
      });
      return;
    }
    this.extractions.set(actor.faction, {
      faction: actor.faction,
      position: position.clone(),
      actors: new Set([actor.id]),
      vehicleId: null,
      requestedAt: this.elapsed,
    });
  }

  extraction(faction: Faction): VehicleExtractionRequest | null {
    return this.extractions.get(faction) ?? null;
  }

  pendingExtractions(): readonly VehicleExtractionRequest[] {
    return [...this.extractions.values()];
  }

  assignExtraction(faction: Faction, vehicleId: string): boolean {
    const current = this.extractions.get(faction);
    if (!current || current.vehicleId !== null) return false;
    this.extractions.set(faction, { ...current, vehicleId });
    return true;
  }

  restoreExtraction(
    faction: Faction,
    position: Vector3,
    actorIds: readonly string[],
    requestedAgoSeconds = 0,
  ): void {
    if (actorIds.length === 0) return;
    this.extractions.set(faction, {
      faction,
      position: position.clone(),
      actors: new Set(actorIds),
      vehicleId: null,
      requestedAt: this.elapsed - Math.max(0, requestedAgoSeconds),
    });
  }

  clearExtraction(faction: Faction): void {
    this.extractions.delete(faction);
  }

  clear(): void {
    this.claims.clear();
    this.cooldownUntil.clear();
    this.extractions.clear();
  }
}
