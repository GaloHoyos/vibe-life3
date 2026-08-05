import type { RaycastSource } from '@engine/physics/Raycast';
import {
  defaultPilotProfileId,
  pilotProfile,
} from '@game/config/vehicleAi.config';
import type {
  VehiclePresetDefinition,
  VehiclePresetId,
} from '@game/config/vehicles.config';
import type {
  VehicleAiBehavior,
  VehicleAiDefinition,
  VehicleNavMarkerDefinition,
} from '@game/levels/LevelDefinition';
import {
  AirVehicleAiBrain,
  airBrainTuning,
} from './AirVehicleAiBrain';
import type {
  AirBrainContext,
  AirBrainDecision,
  AirControlCommand,
  AirLandingSpot,
  VehicleAirState,
} from './AirVehicleAiTypes';
import {
  AirVehicleNavigation,
  airNavProfileFromPreset,
} from './AirVehicleNavigation';
import { AirVehiclePathFollower } from './AirVehiclePathFollower';
import type { VehicleNavPoint } from './VehicleAiTypes';

export interface AirVehicleAiRegistration {
  vehicleId: string;
  preset: VehiclePresetDefinition;
  ai: VehicleAiDefinition;
}

export interface AirVehicleAiReport {
  behavior: VehicleAiBehavior;
  state: VehicleAirState;
  target: VehicleNavPoint | null;
  targetAltitude: number;
  targetSpeed: number;
  landingSpot: AirLandingSpot | null;
  routeLength: number;
}

/** Cada cuánto se reintenta una ruta que falló, en segundos. */
const PLAN_RETRY_SECONDS = 1.5;
/** Altura desde la que se sondea el terreno buscando dónde posarse. */
const LANDING_SEARCH_HEIGHT = 40;

interface AirVehicleRecord {
  readonly brain: AirVehicleAiBrain;
  readonly follower: AirVehiclePathFollower;
  readonly navigation: AirVehicleNavigation;
  readonly presetId: VehiclePresetId;
  behavior: VehicleAiBehavior;
  route: VehicleNavPoint[] | null;
  landingSpot: AirLandingSpot | null;
  planRetrySeconds: number;
  lastDecision: AirBrainDecision | null;
  lastCommand: AirControlCommand | null;
}

/**
 * Contraparte aérea de `VehicleAiSystem`. Va por separado a propósito: el
 * sistema terrestre está casado con la grilla bakeada, el grafo de carriles y
 * las reservas de carril, y nada de eso significa algo en el aire. Lo que sí
 * comparten es la forma externa —`advance`, `update`, `control`— para que
 * `VehicleSystem` los trate igual.
 */
export class AirVehicleAiSystem {
  private readonly vehicles = new Map<string, AirVehicleRecord>();
  private landingZones: readonly VehicleNavMarkerDefinition[] = [];

  constructor(private readonly raycast: RaycastSource) {}

  /** Marcadores `landingZone` del nivel, en orden de preferencia autorada. */
  setLandingZones(markers: readonly VehicleNavMarkerDefinition[]): void {
    this.landingZones = markers.filter((marker) => marker.kind === 'landingZone');
  }

  hasVehicle(vehicleId: string): boolean {
    return this.vehicles.has(vehicleId);
  }

  registerVehicle(registration: AirVehicleAiRegistration): boolean {
    this.unregisterVehicle(registration.vehicleId);
    if (!registration.ai.enabled) return false;
    if (registration.preset.motor.kind !== 'rotorcraft') return false;

    const profile = pilotProfile(
      registration.ai.pilotProfile ?? defaultPilotProfileId(registration.ai.behavior),
    );
    const tuning = airBrainTuning(
      registration.vehicleId,
      profile,
      registration.ai,
      registration.preset.weapon?.range ?? 0,
    );
    const motor = registration.preset.motor;
    this.vehicles.set(registration.vehicleId, {
      brain: new AirVehicleAiBrain(registration.vehicleId, registration.ai, tuning),
      follower: new AirVehiclePathFollower({
        presetMaxPitch: motor.maxPitch,
        presetMaxRoll: motor.maxRoll,
        // No usar toda la inclinación disponible deja margen al lazo interno
        // para corregir sin saturar los mandos.
        maxTilt: Math.min(motor.maxPitch, motor.maxRoll) * 0.9,
      }),
      navigation: new AirVehicleNavigation(
        this.raycast,
        airNavProfileFromPreset(registration.preset),
        registration.vehicleId,
      ),
      presetId: registration.preset.id,
      behavior: registration.ai.behavior,
      route: null,
      landingSpot: null,
      planRetrySeconds: 0,
      lastDecision: null,
      lastCommand: null,
    });
    return true;
  }

  unregisterVehicle(vehicleId: string): void {
    this.vehicles.delete(vehicleId);
  }

  clear(): void {
    this.vehicles.clear();
    this.landingZones = [];
  }

  setBehavior(vehicleId: string, behavior: VehicleAiBehavior): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.behavior = behavior;
    record.brain.setBehavior(behavior);
    record.route = null;
    return true;
  }

  getState(vehicleId: string): VehicleAirState | null {
    return this.vehicles.get(vehicleId)?.brain.getState() ?? null;
  }

  getReport(vehicleId: string): AirVehicleAiReport | null {
    const record = this.vehicles.get(vehicleId);
    if (!record?.lastDecision) return null;
    return {
      behavior: record.lastDecision.behavior,
      state: record.lastDecision.state,
      target: record.lastDecision.intent.target,
      targetAltitude: record.lastDecision.intent.targetAltitude,
      targetSpeed: record.lastCommand?.targetSpeed ?? 0,
      landingSpot: record.landingSpot,
      routeLength: record.route?.length ?? 0,
    };
  }

  /** Adelanta el reloj del cerebro; devuelve si toca decidir este frame. */
  advance(vehicleId: string, delta: number): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.planRetrySeconds = Math.max(0, record.planRetrySeconds - delta);
    return record.brain.advance(delta);
  }

  /** Corre una decisión completa. Sólo en los frames que `advance` habilita. */
  update(
    vehicleId: string,
    context: AirBrainContext,
    distanceToPlayer: number,
  ): AirBrainDecision | null {
    const record = this.vehicles.get(vehicleId);
    if (!record) return null;

    const enriched: AirBrainContext = {
      ...context,
      landingSpot: this.resolveLandingSpot(record, context) ?? undefined,
    };
    const decision = record.brain.update(enriched, distanceToPlayer);
    record.lastDecision = decision;
    record.landingSpot = enriched.landingSpot ?? null;

    if (decision.planGoal && record.planRetrySeconds <= 0) {
      const route = record.navigation.planRoute(
        context.position,
        decision.planGoal,
      );
      if (route) {
        record.route = route;
        record.follower.reset();
      } else {
        // Sin ruta el seguidor vuela directo al objetivo: en el aire eso suele
        // funcionar, y es mejor que quedarse flotando esperando al A*.
        record.route = null;
        record.planRetrySeconds = PLAN_RETRY_SECONDS;
      }
    }
    if (!decision.intent.target) record.route = null;
    return decision;
  }

  /** Mandos de vuelo del frame. Corre siempre, decida o no el cerebro. */
  control(vehicleId: string, context: AirBrainContext, delta: number): AirControlCommand | null {
    const record = this.vehicles.get(vehicleId);
    const decision = record?.lastDecision;
    if (!record || !decision) return null;
    const command = record.follower.update({
      delta,
      position: context.position,
      velocity: context.velocity,
      heading: context.heading,
      altitude: context.altitude,
      grounded: context.grounded,
      intent: decision.intent,
      route: record.route ?? undefined,
    });
    record.lastCommand = command;
    return command;
  }

  /**
   * Dónde posarse: primero las zonas autoradas alcanzables, y sólo si el
   * aparato está herido y ninguna sirve, un claro encontrado por sondeo. El
   * orden importa — un helicóptero sano que se posa en cualquier descampado
   * arruina el ritmo que puso el diseñador.
   */
  private resolveLandingSpot(
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): AirLandingSpot | null {
    // La extracción fija dónde posarse: la zona elegida es la que tiene a la
    // gente al lado, no la que le queda más cerca al aparato.
    if (context.pickupAt) return { position: context.pickupAt, source: 'authored' };
    const authored = this.nearestLandingZone(record.presetId, context.position);
    if (authored) return authored;
    if (context.healthFraction > 0.5 && context.pilotAvailable) return null;
    if (record.landingSpot?.source === 'improvised') return record.landingSpot;
    const searchFrom = context.position[1] + LANDING_SEARCH_HEIGHT;
    return record.navigation.findClearing(context.position, searchFrom);
  }

  private nearestLandingZone(
    presetId: VehiclePresetId,
    position: VehicleNavPoint,
  ): AirLandingSpot | null {
    let best: AirLandingSpot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const marker of this.landingZones) {
      // Una plataforma autorada para otro aparato no es una plataforma.
      if (marker.allowedPresets && !marker.allowedPresets.includes(presetId)) {
        continue;
      }
      const distance = Math.hypot(
        marker.position[0] - position[0],
        marker.position[2] - position[2],
      );
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { position: marker.position, source: 'authored' };
    }
    return best;
  }
}
