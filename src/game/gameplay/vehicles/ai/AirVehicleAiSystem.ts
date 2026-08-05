import type { RaycastSource } from '@engine/physics/Raycast';
import {
  AIR_LANDING_ARRIVAL_RADIUS,
  AIR_TAKEOFF_CLEAR_ALTITUDE,
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
  AirLandingEvent,
  AirLandingFailureReason,
  AirLandingOrder,
  AirLandingOrderOptions,
  AirLandingSpot,
  AirLandingStatus,
  AirNoLandingArea,
  VehicleAirState,
} from './AirVehicleAiTypes';
import {
  AirLandingSiteResolver,
  airLandingSiteKey,
  type AirLandingReservation,
} from './AirLandingSiteResolver';
import {
  AirVehicleNavigation,
  airNavProfileFromPreset,
} from './AirVehicleNavigation';
import { AirVehiclePathFollower } from './AirVehiclePathFollower';
import { planarDistance } from './VehicleAiMath';
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
  landingStatus: AirLandingStatus;
  landingRequested: VehicleNavPoint | null;
  landingDeviation: number | null;
  landingOrderId: string | null;
  landingRevision: number | null;
  landingFailure: AirLandingFailureReason | null;
  landingPurpose: LandingPurpose | null;
  landingReserved: boolean;
  routeLength: number;
  stalledSeconds: number;
  replanFailures: number;
}

const PLAN_RETRY_SECONDS = 1.5;
const LANDING_SEARCH_HEIGHT = 60;
const MAX_LANDING_SEARCH_RADIUS = 35;
const LANDING_CANDIDATE_BUDGET = 8;
const LANDING_REVALIDATE_SECONDS = 0.4;
const SITE_SHORT_COOLDOWN_SECONDS = 2;
const SITE_REPEAT_COOLDOWN_SECONDS = 8;
const GO_AROUND_CLEAR_ALTITUDE = AIR_TAKEOFF_CLEAR_ALTITUDE + 5;
const LANDING_CONFIRM_HEIGHT_TOLERANCE = 1.1;
const LANDING_CONFIRM_PLANAR_SPEED = 1.5;
const LANDING_CONFIRM_VERTICAL_SPEED = 1;
const AIR_PROGRESS_DISTANCE = 1;
const AIR_PROGRESS_WINDOW_SECONDS = 2;
const AIR_PROGRESS_TARGET_RESET_DISTANCE = 4;
const LANDING_STALLS_BEFORE_REJECT = 2;
const LANDING_WATCHDOG_FAILURE_LIMIT = 3;

type LandingPurpose =
  | 'explicit'
  | 'pickup'
  | 'dropoff'
  | 'emergency'
  | 'pilotless';

interface DesiredLanding {
  id: string;
  target: VehicleNavPoint;
  options: AirLandingOrder['options'];
  purpose: LandingPurpose;
  explicitOrder?: AirLandingOrder;
}

interface LandingRuntime {
  order: AirLandingOrder;
  purpose: LandingPurpose;
  status: Exclude<AirLandingStatus, 'none'>;
  spot: AirLandingSpot | null;
  lastFailure: AirLandingFailureReason | null;
  landedEmitted: boolean;
  watchdogFailures: number;
}

interface AirProgressProbe {
  state: VehicleAirState;
  target: VehicleNavPoint;
  anchor: VehicleNavPoint;
  seconds: number;
  consecutiveStalls: number;
}

interface AirVehicleRecord {
  readonly brain: AirVehicleAiBrain;
  readonly follower: AirVehiclePathFollower;
  readonly navigation: AirVehicleNavigation;
  readonly resolver: AirLandingSiteResolver;
  readonly presetId: VehiclePresetId;
  readonly emergencyLandingThreshold: number;
  readonly cruiseAltitude: number;
  readonly hullBottom: number;
  behavior: VehicleAiBehavior;
  route: VehicleNavPoint[] | null;
  planRetrySeconds: number;
  landingRevalidateSeconds: number;
  landingRevision: number;
  landing: LandingRuntime | null;
  resolverReady: boolean;
  explicitLanding: AirLandingOrder | null;
  suppressedLandingId: string | null;
  homePosition: VehicleNavPoint | null;
  forceGoAround: boolean;
  goAroundStartHeight: number | null;
  progressProbe: AirProgressProbe | null;
  stalledSeconds: number;
  replanFailures: number;
  siteCooldowns: Map<string, number>;
  siteFailures: Map<string, number>;
  lastLandingFailure: AirLandingFailureReason | null;
  lastDecision: AirBrainDecision | null;
  lastCommand: AirControlCommand | null;
}

/**
 * Contraparte aérea de `VehicleAiSystem`. Mantiene la navegación y el piloto
 * separados del dominio terrestre, y además arbitra las reservas de posada:
 * dos helicópteros pueden recibir la misma intención, pero no el mismo claro.
 */
export class AirVehicleAiSystem {
  private readonly vehicles = new Map<string, AirVehicleRecord>();
  private landingSites: readonly VehicleNavMarkerDefinition[] = [];
  private noLandingAreas: readonly AirNoLandingArea[] = [];
  private readonly landingEvents: AirLandingEvent[] = [];

  constructor(private readonly raycast: RaycastSource) {}

  /** `landingZone` y `dropZone` son preferencias, nunca permisos especiales. */
  setLandingZones(markers: readonly VehicleNavMarkerDefinition[]): void {
    this.landingSites = markers.filter(
      (marker) => marker.kind === 'landingZone' || marker.kind === 'dropZone',
    );
    this.restartLandingResolutions();
  }

  /** Volúmenes duros para interiores, agua y setpieces no posables. */
  setNoLandingAreas(areas: readonly AirNoLandingArea[]): void {
    this.noLandingAreas = areas.map((area) => ({
      id: area.id,
      center: [...area.center],
      halfExtents: [...area.halfExtents],
    }));
    this.restartLandingResolutions();
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
    const navigation = new AirVehicleNavigation(
      this.raycast,
      airNavProfileFromPreset(registration.preset),
      registration.vehicleId,
    );
    this.vehicles.set(registration.vehicleId, {
      brain: new AirVehicleAiBrain(registration.vehicleId, registration.ai, tuning),
      follower: new AirVehiclePathFollower({
        presetMaxPitch: motor.maxPitch,
        presetMaxRoll: motor.maxRoll,
        maxTilt: Math.min(motor.maxPitch, motor.maxRoll) * 0.9,
      }),
      navigation,
      resolver: new AirLandingSiteResolver(navigation),
      presetId: registration.preset.id,
      emergencyLandingThreshold: tuning.emergencyLandingThreshold,
      cruiseAltitude: tuning.cruiseAltitude,
      hullBottom: motor.hullBottom,
      behavior: registration.ai.behavior,
      route: null,
      planRetrySeconds: 0,
      landingRevalidateSeconds: 0,
      landingRevision: 0,
      landing: null,
      resolverReady: false,
      explicitLanding: null,
      suppressedLandingId: null,
      homePosition: null,
      forceGoAround: false,
      goAroundStartHeight: null,
      progressProbe: null,
      stalledSeconds: 0,
      replanFailures: 0,
      siteCooldowns: new Map(),
      siteFailures: new Map(),
      lastLandingFailure: null,
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
    this.landingSites = [];
    this.noLandingAreas = [];
    this.landingEvents.length = 0;
  }

  setBehavior(vehicleId: string, behavior: VehicleAiBehavior): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.behavior = behavior;
    record.brain.setBehavior(behavior);
    record.route = null;
    if (record.landing?.purpose !== 'explicit') this.clearLanding(record);
    return true;
  }

  /** Orden world-space tipo Overwatch. Devuelve revisión para descartar acks viejos. */
  orderLanding(
    vehicleId: string,
    target: VehicleNavPoint,
    options: AirLandingOrderOptions = {},
  ): AirLandingOrder | null {
    const record = this.vehicles.get(vehicleId);
    if (!record) return null;
    const order: AirLandingOrder = {
      id: options.orderId ?? `landing:${vehicleId}:${record.landingRevision + 1}`,
      revision: ++record.landingRevision,
      target: [...target],
      options: normalizeLandingOptions(options),
    };
    if (record.lastDecision?.state === 'landing') record.forceGoAround = true;
    record.explicitLanding = order;
    record.suppressedLandingId = null;
    record.lastLandingFailure = null;
    return cloneOrder(order);
  }

  abortLanding(vehicleId: string): boolean {
    const record = this.vehicles.get(vehicleId);
    const landing = record?.landing;
    if (!record || (!landing && !record.explicitLanding)) return false;
    if (record.lastDecision?.state === 'landing') record.forceGoAround = true;
    const order = record.explicitLanding ?? landing?.order;
    if (order) {
      this.emitFailure(vehicleId, order, 'aborted');
      record.suppressedLandingId = order.id;
    }
    record.explicitLanding = null;
    record.lastLandingFailure = 'aborted';
    this.clearLanding(record);
    return true;
  }

  /** Releases an acknowledged landing order without turning completion into a failure. */
  completeLanding(vehicleId: string, orderId: string, revision: number): boolean {
    const record = this.vehicles.get(vehicleId);
    const order = record?.explicitLanding ?? record?.landing?.order;
    if (
      !record ||
      !order ||
      order.id !== orderId ||
      order.revision !== revision
    ) return false;
    record.explicitLanding = null;
    record.suppressedLandingId = order.id;
    this.clearLanding(record);
    return true;
  }

  /** El integrador puede notificar un obstáculo que el piloto físico detectó. */
  reportLandingApproachFailure(
    vehicleId: string,
    reason: Extract<AirLandingFailureReason, 'siteBlocked' | 'approachBlocked'> =
      'approachBlocked',
  ): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record?.landing?.spot) return false;
    this.rejectSelectedSite(vehicleId, record, reason);
    return true;
  }

  /** Blacklists a physically valid site that gameplay found unusable (for example, no exit). */
  markLandingSiteUnavailable(
    vehicleId: string,
    position: VehicleNavPoint,
    reason: Extract<AirLandingFailureReason, 'siteBlocked' | 'approachBlocked'> =
      'siteBlocked',
  ): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    const current = record.landing?.spot;
    if (current && planarDistance(current.position, position) <= 1) {
      this.rejectSelectedSite(vehicleId, record, reason);
      return true;
    }
    const key = airLandingSiteKey(position);
    const failures = (record.siteFailures.get(key) ?? 0) + 1;
    record.siteFailures.set(key, failures);
    record.siteCooldowns.set(
      key,
      failures >= 2 ? SITE_REPEAT_COOLDOWN_SECONDS : SITE_SHORT_COOLDOWN_SECONDS,
    );
    record.lastLandingFailure = reason;
    return true;
  }

  getLandingOrder(vehicleId: string): AirLandingOrder | null {
    const record = this.vehicles.get(vehicleId);
    const order = record?.explicitLanding ?? record?.landing?.order;
    return order ? cloneOrder(order) : null;
  }

  drainLandingEvents(): AirLandingEvent[] {
    return this.landingEvents.splice(0, this.landingEvents.length);
  }

  getState(vehicleId: string): VehicleAirState | null {
    return this.vehicles.get(vehicleId)?.brain.getState() ?? null;
  }

  getReport(vehicleId: string): AirVehicleAiReport | null {
    const record = this.vehicles.get(vehicleId);
    if (!record?.lastDecision) return null;
    const landing = record.landing;
    return {
      behavior: record.lastDecision.behavior,
      state: record.lastDecision.state,
      target: record.lastDecision.intent.target,
      targetAltitude: record.lastDecision.intent.targetAltitude,
      targetSpeed: record.lastCommand?.targetSpeed ?? 0,
      landingSpot: landing?.spot ?? null,
      landingStatus: record.forceGoAround
        ? 'goAround'
        : landing?.status ?? 'none',
      landingRequested: landing ? [...landing.order.target] : null,
      landingDeviation: landing?.spot
        ? planarDistance(landing.order.target, landing.spot.position)
        : null,
      landingOrderId: landing?.order.id ?? null,
      landingRevision: landing?.order.revision ?? null,
      landingFailure: record.lastLandingFailure,
      landingPurpose: landing?.purpose ?? null,
      landingReserved: Boolean(
        landing?.spot && landing.status !== 'failed',
      ),
      routeLength: record.route?.length ?? 0,
      stalledSeconds: record.stalledSeconds,
      replanFailures: record.replanFailures,
    };
  }

  /** Adelanta relojes; el follower sigue corriendo todos los frames. */
  advance(vehicleId: string, delta: number): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.planRetrySeconds = Math.max(0, record.planRetrySeconds - delta);
    record.landingRevalidateSeconds = Math.max(
      0,
      record.landingRevalidateSeconds - delta,
    );
    for (const [key, seconds] of record.siteCooldowns) {
      const remaining = seconds - delta;
      if (remaining <= 0) record.siteCooldowns.delete(key);
      else record.siteCooldowns.set(key, remaining);
    }
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
    record.homePosition ??= [...context.position];

    this.finishGoAroundWhenClear(record, context);
    const desired = this.desiredLanding(record, context);
    this.synchronizeLanding(vehicleId, record, desired, context);
    if (record.landing?.status === 'resolving' && !record.resolverReady) {
      this.beginResolution(vehicleId, record, context);
    }
    this.revalidateLanding(vehicleId, record, context);
    this.resolveLanding(vehicleId, record, context);
    this.markLanded(vehicleId, record, context);

    const landing = record.landing;
    const landingRequested = Boolean(
      landing && landing.status !== 'failed',
    );
    const enriched: AirBrainContext = {
      ...context,
      ...(landing?.spot ? { landingSpot: landing.spot } : {}),
      landingRequested,
      landingStatus: record.forceGoAround
        ? 'goAround'
        : landing?.status ?? 'none',
      landingGoAround: record.forceGoAround,
    };
    const decision = record.brain.update(enriched, distanceToPlayer);
    record.lastDecision = decision;

    if (
      decision.state === 'landing' ||
      decision.state === 'takeoff' ||
      decision.state === 'goAround' ||
      decision.state === 'stopped'
    ) {
      record.route = null;
      record.follower.reset();
    } else if (decision.planGoal && record.planRetrySeconds <= 0) {
      const route = record.navigation.planRoute(context.position, decision.planGoal);
      if (route) {
        record.route = route;
        record.follower.reset();
      } else {
        record.route = null;
        record.planRetrySeconds = PLAN_RETRY_SECONDS;
      }
    }
    if (!decision.intent.target) record.route = null;
    return decision;
  }

  /** Mandos de vuelo del frame. Corre siempre, decida o no el cerebro. */
  control(
    vehicleId: string,
    context: AirBrainContext,
    delta: number,
  ): AirControlCommand | null {
    const record = this.vehicles.get(vehicleId);
    const decision = record?.lastDecision;
    if (!record || !decision) return null;
    this.monitorFlightProgress(vehicleId, record, context, delta);
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

  private monitorFlightProgress(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
    delta: number,
  ): void {
    const decision = record.lastDecision;
    const target = decision?.intent.target;
    if (
      !decision ||
      !target ||
      !flightRequestsProgress(decision, context)
    ) {
      this.resetFlightProgress(record);
      return;
    }

    const probe = record.progressProbe;
    if (
      !probe ||
      probe.state !== decision.state ||
      distance3(probe.target, target) >= AIR_PROGRESS_TARGET_RESET_DISTANCE
    ) {
      record.progressProbe = {
        state: decision.state,
        target: [...target],
        anchor: [...context.position],
        seconds: 0,
        consecutiveStalls: 0,
      };
      return;
    }

    if (distance3(probe.anchor, context.position) >= AIR_PROGRESS_DISTANCE) {
      probe.anchor = [...context.position];
      probe.target = [...target];
      probe.seconds = 0;
      probe.consecutiveStalls = 0;
      record.stalledSeconds = 0;
      record.replanFailures = 0;
      return;
    }

    const monitoredDelta = Math.max(0, Math.min(delta, 0.25));
    probe.seconds += monitoredDelta;
    record.stalledSeconds += monitoredDelta;
    if (probe.seconds < AIR_PROGRESS_WINDOW_SECONDS) return;
    probe.anchor = [...context.position];
    probe.target = [...target];
    probe.seconds = 0;
    probe.consecutiveStalls += 1;
    record.replanFailures += 1;

    const routeFound = this.replanStalledFlight(record, context, decision);
    if (decision.state === 'approach' && record.landing?.spot) {
      if (
        routeFound === false ||
        probe.consecutiveStalls >= LANDING_STALLS_BEFORE_REJECT
      ) {
        this.handleApproachWatchdogFailure(vehicleId, record, context);
      }
      return;
    }
    if (
      decision.state === 'goAround' &&
      probe.consecutiveStalls >= LANDING_STALLS_BEFORE_REJECT
    ) {
      this.failLanding(vehicleId, record, 'approachBlocked');
    }
  }

  private replanStalledFlight(
    record: AirVehicleRecord,
    context: AirBrainContext,
    decision: AirBrainDecision,
  ): boolean | null {
    if (
      decision.state === 'grounded' ||
      decision.state === 'landing' ||
      decision.state === 'takeoff' ||
      decision.state === 'goAround' ||
      decision.state === 'stopped' ||
      !decision.intent.target
    ) {
      return null;
    }
    const route = record.navigation.planRoute(
      context.position,
      decision.intent.target,
    );
    record.route = route;
    record.planRetrySeconds = route ? 0 : PLAN_RETRY_SECONDS;
    record.follower.reset();
    return route !== null;
  }

  private handleApproachWatchdogFailure(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    const landing = record.landing;
    if (!landing?.spot) return;
    landing.watchdogFailures += 1;
    if (landing.watchdogFailures >= LANDING_WATCHDOG_FAILURE_LIMIT) {
      this.failLanding(vehicleId, record, 'approachBlocked');
      return;
    }
    this.rejectSelectedSite(vehicleId, record, 'approachBlocked', context);
  }

  private resetFlightProgress(record: AirVehicleRecord): void {
    record.progressProbe = null;
  }

  private desiredLanding(
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): DesiredLanding | null {
    if (record.explicitLanding) {
      return {
        id: record.explicitLanding.id,
        target: record.explicitLanding.target,
        options: record.explicitLanding.options,
        purpose: 'explicit',
        explicitOrder: record.explicitLanding,
      };
    }
    if (context.groundHold) return null;
    if (context.pickupAt) {
      return implicitLanding('pickup', context.pickupAt);
    }
    if (context.passengersOnboard && record.behavior === 'transport') {
      const target =
        context.authoredGoal ??
        this.preferredDropoff(record, record.homePosition ?? context.position) ??
        record.homePosition ??
        context.position;
      return implicitLanding('dropoff', target);
    }
    if (
      record.landing?.purpose === 'dropoff' &&
      record.landing.status === 'landed'
    ) {
      return {
        id: record.landing.order.id,
        target: record.landing.order.target,
        options: record.landing.order.options,
        purpose: 'dropoff',
      };
    }
    if (context.healthFraction <= record.emergencyLandingThreshold) {
      const target =
        record.landing?.purpose === 'emergency'
          ? record.landing.order.target
          : context.position;
      return implicitLanding('emergency', target);
    }
    if (!context.pilotAvailable && !context.grounded) {
      const target =
        record.landing?.purpose === 'pilotless'
          ? record.landing.order.target
          : context.position;
      return implicitLanding('pilotless', target);
    }
    return null;
  }

  private synchronizeLanding(
    vehicleId: string,
    record: AirVehicleRecord,
    desired: DesiredLanding | null,
    context: AirBrainContext,
  ): void {
    if (!desired || desired.id === record.suppressedLandingId) {
      this.clearLanding(record);
      return;
    }
    if (record.suppressedLandingId && desired.id !== record.suppressedLandingId) {
      record.suppressedLandingId = null;
    }
    const active = record.landing;
    if (
      active?.order.id === desired.id &&
      planarDistance(active.order.target, desired.target) < 1
    ) {
      return;
    }
    if (active && record.lastDecision?.state === 'landing') {
      record.forceGoAround = true;
    }
    this.clearLanding(record);
    const order = desired.explicitOrder ?? {
      id: desired.id,
      revision: ++record.landingRevision,
      target: [...desired.target],
      options: desired.options,
    };
    record.landing = {
      order,
      purpose: desired.purpose,
      status: 'resolving',
      spot: null,
      lastFailure: null,
      landedEmitted: false,
      watchdogFailures: 0,
    };
    record.lastLandingFailure = null;
    this.beginResolution(vehicleId, record, context);
  }

  private beginResolution(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    const landing = record.landing;
    if (!landing) return;
    landing.status = 'resolving';
    landing.spot = null;
    record.resolver.begin({
      requested: landing.order.target,
      searchRadius: landing.order.options.searchRadius,
      searchFrom: landing.order.target[1] + LANDING_SEARCH_HEIGHT,
      presetId: record.presetId,
      preferAuthored: landing.order.options.preferAuthored,
      authoredSites: this.landingSites,
      exclusions: this.noLandingAreas,
      reservations: this.reservationsFor(vehicleId),
      unavailableSiteKeys: new Set(record.siteCooldowns.keys()),
    });
    record.resolverReady = true;
    record.route = null;
    record.follower.reset();
    record.landingRevalidateSeconds = LANDING_REVALIDATE_SECONDS;
    // `context` se usa para dejar explícito que la resolución corresponde a la
    // pose vigente; el resolver no conserva ni consulta estado global mutable.
    void context;
  }

  private resolveLanding(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    const landing = record.landing;
    if (!landing || landing.status !== 'resolving') return;
    const result = record.resolver.step(LANDING_CANDIDATE_BUDGET);
    if (result.status === 'pending') return;
    if (result.status === 'failed') {
      const reason = landing.lastFailure ?? 'noSafeSite';
      this.failLanding(vehicleId, record, reason);
      return;
    }

    if (this.overlapsLiveReservation(vehicleId, record, result.spot.position)) {
      record.resolverReady = false;
      this.beginResolution(vehicleId, record, context);
      return;
    }

    const selectedSpot: AirLandingSpot = {
      ...result.spot,
      approachHeading:
        planarDistance(context.position, result.spot.position) > 1
          ? Math.atan2(
              result.spot.position[0] - context.position[0],
              result.spot.position[2] - context.position[2],
            )
          : context.heading,
    };
    const approach: VehicleNavPoint = [
      selectedSpot.position[0],
      selectedSpot.position[1] + Math.max(GO_AROUND_CLEAR_ALTITUDE, record.cruiseAltitude * 0.6),
      selectedSpot.position[2],
    ];
    if (!context.grounded) {
      const route = record.navigation.planRoute(context.position, approach);
      if (!route) {
        landing.spot = selectedSpot;
        this.rejectSelectedSite(vehicleId, record, 'approachBlocked', context);
        return;
      }
      record.route = route;
    }
    landing.spot = selectedSpot;
    landing.status = 'selected';
    landing.lastFailure = null;
    record.landingRevalidateSeconds = LANDING_REVALIDATE_SECONDS;
    this.landingEvents.push({
      type: 'selected',
      vehicleId,
      orderId: landing.order.id,
      revision: landing.order.revision,
      requested: [...landing.order.target],
      selected: [...selectedSpot.position],
      deviation: planarDistance(landing.order.target, selectedSpot.position),
      source: selectedSpot.source,
      ...(selectedSpot.surfaceId ? { surfaceId: selectedSpot.surfaceId } : {}),
      ...(selectedSpot.surfaceType
        ? { surfaceType: selectedSpot.surfaceType }
        : {}),
    });
  }

  private revalidateLanding(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    const landing = record.landing;
    if (
      !landing?.spot ||
      landing.status !== 'selected' ||
      record.landingRevalidateSeconds > 0
    ) {
      return;
    }
    const phase = record.lastDecision?.state;
    if (phase !== 'approach' && phase !== 'landing') return;
    record.landingRevalidateSeconds = LANDING_REVALIDATE_SECONDS;
    const searchFrom = landing.spot.position[1] + LANDING_SEARCH_HEIGHT;
    if (record.navigation.descentClear(landing.spot.position, searchFrom)) return;
    this.rejectSelectedSite(vehicleId, record, 'siteBlocked', context);
  }

  private rejectSelectedSite(
    vehicleId: string,
    record: AirVehicleRecord,
    reason: Extract<AirLandingFailureReason, 'siteBlocked' | 'approachBlocked'>,
    context?: AirBrainContext,
  ): void {
    const landing = record.landing;
    const spot = landing?.spot;
    if (!landing || !spot) return;
    const key = airLandingSiteKey(spot.position);
    const failures = (record.siteFailures.get(key) ?? 0) + 1;
    record.siteFailures.set(key, failures);
    record.siteCooldowns.set(
      key,
      failures >= 2 ? SITE_REPEAT_COOLDOWN_SECONDS : SITE_SHORT_COOLDOWN_SECONDS,
    );
    landing.lastFailure = reason;
    record.lastLandingFailure = reason;
    if (record.lastDecision?.state === 'landing') record.forceGoAround = true;
    landing.spot = null;
    landing.status = 'resolving';
    record.resolverReady = false;
    record.route = null;
    this.resetFlightProgress(record);
    if (context) this.beginResolution(vehicleId, record, context);
  }

  private markLanded(
    vehicleId: string,
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    const landing = record.landing;
    if (!landing?.spot || landing.status !== 'selected') return;
    const supportHeight = Number.isFinite(context.altitude)
      ? context.position[1] + record.hullBottom - context.altitude
      : Number.POSITIVE_INFINITY;
    const arrived =
      context.grounded &&
      Number.isFinite(supportHeight) &&
      Math.abs(supportHeight - landing.spot.position[1]) <=
        LANDING_CONFIRM_HEIGHT_TOLERANCE &&
      Math.hypot(context.velocity[0], context.velocity[2]) <=
        LANDING_CONFIRM_PLANAR_SPEED &&
      Math.abs(context.velocity[1]) <= LANDING_CONFIRM_VERTICAL_SPEED &&
      planarDistance(context.position, landing.spot.position) <=
        AIR_LANDING_ARRIVAL_RADIUS;
    if (!arrived) return;
    const searchFrom = landing.spot.position[1] + LANDING_SEARCH_HEIGHT;
    if (!record.navigation.descentClear(landing.spot.position, searchFrom)) {
      this.rejectSelectedSite(vehicleId, record, 'siteBlocked', context);
      return;
    }
    landing.status = 'landed';
    if (landing.landedEmitted) return;
    landing.landedEmitted = true;
    this.landingEvents.push({
      type: 'landed',
      vehicleId,
      orderId: landing.order.id,
      revision: landing.order.revision,
      requested: [...landing.order.target],
      selected: [...landing.spot.position],
    });
    if (
      landing.purpose === 'explicit' &&
      !landing.order.options.holdAfterLanding
    ) {
      record.explicitLanding = null;
    }
  }

  private finishGoAroundWhenClear(
    record: AirVehicleRecord,
    context: AirBrainContext,
  ): void {
    if (!record.forceGoAround) {
      record.goAroundStartHeight = null;
      return;
    }
    record.goAroundStartHeight ??= context.position[1];
    const clearAltitude = Number.isFinite(context.altitude)
      ? context.altitude >= GO_AROUND_CLEAR_ALTITUDE
      : context.position[1] - record.goAroundStartHeight >=
        GO_AROUND_CLEAR_ALTITUDE;
    if (
      record.lastDecision?.state === 'goAround' &&
      !context.grounded &&
      clearAltitude
    ) {
      record.forceGoAround = false;
      record.goAroundStartHeight = null;
      this.resetFlightProgress(record);
    }
  }

  private overlapsLiveReservation(
    vehicleId: string,
    record: AirVehicleRecord,
    position: VehicleNavPoint,
  ): boolean {
    const radius = record.navigation.getLandingRadius();
    return this.reservationsFor(vehicleId).some(
      (reservation) =>
        planarDistance(position, reservation.position) <
        radius + reservation.radius + 1,
    );
  }

  private reservationsFor(excludeVehicleId: string): AirLandingReservation[] {
    const reservations: AirLandingReservation[] = [];
    for (const [vehicleId, record] of this.vehicles) {
      if (vehicleId === excludeVehicleId) continue;
      const landing = record.landing;
      if (!landing?.spot || landing.status === 'failed') continue;
      reservations.push({
        vehicleId,
        position: landing.spot.position,
        radius: record.navigation.getLandingRadius(),
      });
    }
    return reservations;
  }

  private preferredDropoff(
    record: AirVehicleRecord,
    origin: VehicleNavPoint,
  ): VehicleNavPoint | null {
    let best: VehicleNavPoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const marker of this.landingSites) {
      if (marker.kind !== 'dropZone') continue;
      if (
        marker.allowedPresets &&
        !marker.allowedPresets.includes(record.presetId)
      ) {
        continue;
      }
      const distance = planarDistance(marker.position, origin);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = [...marker.position];
    }
    return best;
  }

  private emitFailure(
    vehicleId: string,
    order: AirLandingOrder,
    reason: AirLandingFailureReason,
  ): void {
    this.landingEvents.push({
      type: 'failed',
      vehicleId,
      orderId: order.id,
      revision: order.revision,
      requested: [...order.target],
      reason,
    });
  }

  private failLanding(
    vehicleId: string,
    record: AirVehicleRecord,
    reason: AirLandingFailureReason,
  ): void {
    const landing = record.landing;
    if (!landing || landing.status === 'failed') return;
    landing.status = 'failed';
    landing.spot = null;
    landing.lastFailure = reason;
    record.lastLandingFailure = reason;
    record.forceGoAround = false;
    record.goAroundStartHeight = null;
    record.resolver.reset();
    record.resolverReady = false;
    record.route = null;
    record.follower.reset();
    this.resetFlightProgress(record);
    this.emitFailure(vehicleId, landing.order, reason);
  }

  private clearLanding(record: AirVehicleRecord): void {
    record.landing = null;
    record.resolver.reset();
    record.resolverReady = false;
    record.route = null;
    record.follower.reset();
    this.resetFlightProgress(record);
  }

  private restartLandingResolutions(): void {
    for (const record of this.vehicles.values()) {
      if (!record.landing || record.landing.status === 'failed') continue;
      if (record.lastDecision?.state === 'landing') record.forceGoAround = true;
      record.landing.status = 'resolving';
      record.landing.spot = null;
      record.resolver.reset();
      record.resolverReady = false;
    }
  }
}

function flightRequestsProgress(
  decision: AirBrainDecision,
  context: AirBrainContext,
): boolean {
  if (context.grounded) return false;
  switch (decision.state) {
    case 'grounded':
    case 'landing':
    case 'stopped':
      return false;
    case 'takeoff':
    case 'goAround':
    case 'approach':
      return true;
    case 'cruising':
    case 'engaging':
    case 'pursuing':
    case 'searching':
    case 'evading': {
      const target = decision.intent.target;
      if (!target) return false;
      const planar = planarDistance(context.position, target);
      const altitudeError = Number.isFinite(context.altitude)
        ? Math.abs(decision.intent.targetAltitude - context.altitude)
        : 0;
      return planar > AIR_LANDING_ARRIVAL_RADIUS || altitudeError > 1;
    }
  }
}

function distance3(first: VehicleNavPoint, second: VehicleNavPoint): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function normalizeLandingOptions(
  options: AirLandingOrderOptions,
): AirLandingOrder['options'] {
  return {
    searchRadius: Math.max(
      0,
      Math.min(MAX_LANDING_SEARCH_RADIUS, options.searchRadius ?? MAX_LANDING_SEARCH_RADIUS),
    ),
    preferAuthored: options.preferAuthored ?? true,
    holdAfterLanding: options.holdAfterLanding ?? true,
  };
}

function implicitLanding(
  purpose: Exclude<LandingPurpose, 'explicit'>,
  target: VehicleNavPoint,
): DesiredLanding {
  const stableTarget: VehicleNavPoint = [...target];
  return {
    id: `${purpose}:${Math.round(target[0])}:${Math.round(target[1])}:${Math.round(target[2])}`,
    target: stableTarget,
    options: normalizeLandingOptions({}),
    purpose,
  };
}

function cloneOrder(order: AirLandingOrder): AirLandingOrder {
  return {
    id: order.id,
    revision: order.revision,
    target: [...order.target],
    options: { ...order.options },
  };
}
