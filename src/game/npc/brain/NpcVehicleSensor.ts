import type { Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import type { NavAgentProfile } from '@engine/ai/navigation/NavigationTypes';
import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';
import {
  compareTravelOptions,
  type VehicleTravelComparison,
} from '@game/gameplay/vehicles/ai/VehicleCrewUtility';
import type {
  VehicleOpportunityActor,
  VehicleOpportunityRegistry,
  VehicleSeatOffer,
} from '@game/gameplay/vehicles/ai/VehicleOpportunityRegistry';
import type { NpcVehicleCapability } from '@game/npc/core/INpc';
import type { NpcNavigationQueries, NpcVehicleHandle } from './NpcBrainContext';

/**
 * Quien concede los asientos. Lo implementa el director de tripulacion: el
 * sensor decide que le conviene y el director arbitra entre facciones y cupos.
 */
export interface NpcVehicleSeatBroker {
  requestSeat(actor: VehicleOpportunityActor, offer: VehicleSeatOffer): boolean;
  releaseSeat(actorId: string): void;
}

/**
 * Cuantas ofertas se miden por evaluacion. Cada una puede costar un camino
 * peatonal, asi que conviene un tope: la lista viene ordenada por cercania y con
 * los mandos primero, o sea que las que importan estan al principio.
 */
const MAX_EVALUATED_OFFERS = 3;

/** Por qué la última evaluación terminó como terminó. Para debug y tuning. */
export type NpcVehicleVerdict =
  | 'sin-objetivo'
  | 'objetivo-cerca'
  | 'sin-vehiculo'
  | 'no-se-llega'
  | 'no-compensa'
  | 'conviene'
  | 'reservado';

export interface NpcVehicleDecisionTrace {
  readonly verdict: NpcVehicleVerdict;
  readonly vehicleId: string | null;
  /** Segundos estimados a pie; `null` si no se llegó a medir. */
  readonly footSeconds: number | null;
  readonly vehicleSeconds: number | null;
}

/**
 * Decide si a este NPC le conviene un vehiculo. Espeja a `NpcCoverSensor`:
 * evalua con su propio throttle, es el unico dueno de la reserva, y expone a
 * las tasks un handle angosto.
 */
export class NpcVehicleSensor implements NpcVehicleHandle {
  private nextEvaluateAt = 0;
  private offer: VehicleSeatOffer | null = null;
  private claimedVehicleId: string | null = null;
  private committedUntil = 0;
  private elapsed = 0;
  private lastEvaluatedAt = 0;
  private trackedSeparation = 0;
  private trackedVisible = false;
  private separationRate = 0;
  private trace: NpcVehicleDecisionTrace = {
    verdict: 'sin-objetivo',
    vehicleId: null,
    footSeconds: null,
    vehicleSeconds: null,
  };

  constructor(
    private readonly npcId: string,
    private readonly faction: Faction,
    private readonly capability: NpcVehicleCapability | null,
    private readonly registry: VehicleOpportunityRegistry,
    private readonly broker: NpcVehicleSeatBroker,
    private readonly footSpeed: number,
  ) {}

  update(
    elapsed: number,
    self: Vector3,
    goal: Vector3 | null,
    /** El blanco se ve AHORA. Sin esto `goal` es un ultimo-visto congelado. */
    visible: boolean,
    navigation: NpcNavigationQueries,
    profile: NavAgentProfile,
  ): void {
    this.elapsed = elapsed;
    if (this.claimedVehicleId !== null && elapsed < this.committedUntil) return;
    if (elapsed < this.nextEvaluateAt) return;
    const sinceLast = elapsed - this.lastEvaluatedAt;
    this.lastEvaluatedAt = elapsed;
    this.nextEvaluateAt = elapsed + VEHICLE_CREW_DECISION.evaluateSeconds;

    if (!goal) {
      this.separationRate = 0;
      this.trackedVisible = false;
      this.reject('sin-objetivo');
      return;
    }

    const separation = self.distanceTo(goal);
    // El ritmo de separacion solo tiene sentido entre dos medidas del blanco a
    // la vista: contra un ultimo-visto congelado siempre daria cero, y a traves
    // del salto de "visible" a "recordado" daria un valor inventado.
    this.separationRate =
      visible && this.trackedVisible && sinceLast > 1e-3
        ? (separation - this.trackedSeparation) / sinceLast
        : 0;
    this.trackedSeparation = separation;
    this.trackedVisible = visible;

    // Cerca no hay nada que discutir: el rodeo hasta el vehiculo ya perdio.
    if (separation < VEHICLE_CREW_DECISION.minGoalDistance && !this.isLosingGround()) {
      this.reject('objetivo-cerca');
      return;
    }

    const candidates = this.registry
      .offersFor(this.actor(), self, VEHICLE_CREW_DECISION.searchRadius)
      .slice(0, MAX_EVALUATED_OFFERS);
    if (candidates.length === 0) {
      this.reject('sin-vehiculo');
      return;
    }

    const footDistance =
      navigation.pathDistance(profile, self, goal) ?? self.distanceTo(goal);
    let verdict: NpcVehicleVerdict = 'no-se-llega';
    let closest: VehicleTravelComparison | null = null;
    for (const candidate of candidates) {
      const driveDistance = this.registry.travelDistance(candidate, goal);
      if (driveDistance === null) continue;
      const approachDistance =
        navigation.pathDistance(profile, self, candidate.boarding) ??
        self.distanceTo(candidate.boarding);
      const comparison = compareTravelOptions({
        footDistance,
        footSpeed: this.footSpeed,
        approachDistance,
        driveDistance,
        driveSpeed: candidate.cruiseSpeed * VEHICLE_CREW_DECISION.driveSpeedFactor,
      });
      const faster =
        candidate.cruiseSpeed * VEHICLE_CREW_DECISION.driveSpeedFactor > this.footSpeed;
      if (comparison.worthIt || (this.isLosingGround() && faster)) {
        this.offer = candidate;
        this.trace = {
          verdict: 'conviene',
          vehicleId: candidate.vehicleId,
          footSeconds: comparison.footSeconds,
          vehicleSeconds: comparison.vehicleSeconds,
        };
        return;
      }
      // Se llegaba pero no compensaba: es un veredicto distinto de "no se llega"
      // y la diferencia importa para tunear el margen.
      verdict = 'no-compensa';
      if (!closest || comparison.vehicleSeconds < closest.vehicleSeconds) {
        closest = comparison;
      }
    }
    this.offer = null;
    this.trace = {
      verdict,
      vehicleId: null,
      footSeconds: closest?.footSeconds ?? null,
      vehicleSeconds: closest?.vehicleSeconds ?? null,
    };
  }

  /** Se le esta escapando: a pie ya no lo alcanza, mida lo que mida. */
  private isLosingGround(): boolean {
    return this.separationRate >= VEHICLE_CREW_DECISION.recedingSpeed;
  }

  private reject(verdict: NpcVehicleVerdict): void {
    this.offer = null;
    this.trace = { verdict, vehicleId: null, footSeconds: null, vehicleSeconds: null };
  }

  /** Por qué este NPC eligió lo que eligió. Sólo para debug y tuning. */
  decisionTrace(): NpcVehicleDecisionTrace {
    if (this.claimedVehicleId !== null) {
      return { ...this.trace, verdict: 'reservado', vehicleId: this.claimedVehicleId };
    }
    return this.trace;
  }

  /** Hay algo que conviene y todavia no se reservo. */
  isVehicleUseful(): boolean {
    return this.offer !== null && this.claimedVehicleId === null;
  }

  bestOffer(): VehicleSeatOffer | null {
    return this.offer;
  }

  requestSeat(): boolean {
    const offer = this.offer;
    if (!offer || this.claimedVehicleId !== null) return false;
    if (!this.broker.requestSeat(this.actor(), offer)) return false;
    this.claimedVehicleId = offer.vehicleId;
    // Compromiso: una vez concedido no se vuelve a comparar por un rato, o el
    // NPC se queda dudando en la puerta del vehículo.
    this.committedUntil = this.elapsed + VEHICLE_CREW_DECISION.commitSeconds;
    return true;
  }

  private actor(): VehicleOpportunityActor {
    return { id: this.npcId, faction: this.faction, vehicleCapability: this.capability };
  }

  releaseSeat(): void {
    if (this.claimedVehicleId === null) return;
    this.broker.releaseSeat(this.npcId);
    this.claimedVehicleId = null;
    this.offer = null;
  }

  dispose(): void {
    this.releaseSeat();
  }
}
