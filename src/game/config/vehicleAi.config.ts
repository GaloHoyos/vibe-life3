import type { VehicleAiBehavior } from '@game/levels/LevelDefinition';
import type { VehiclePresetId } from '@game/config/vehicles.config';

export const VEHICLE_DRIVER_PROFILE_IDS = [
  'cautious',
  'steady',
  'aggressive',
  'reckless',
] as const;

export type VehicleDriverProfileId = (typeof VEHICLE_DRIVER_PROFILE_IDS)[number];

export const VEHICLE_GUNNER_PROFILE_IDS = [
  'militia',
  'trained',
  'elite',
] as const;

export type VehicleGunnerProfileId = (typeof VEHICLE_GUNNER_PROFILE_IDS)[number];

export interface VehicleDriverProfile {
  id: VehicleDriverProfileId;
  /**
   * Fracción de la velocidad máxima del vehículo que este conductor usa. Es el
   * `drivermaxspeed` de `npc_vehicledriver` de HL2.
   */
  speedFactor: number;
  /** Piso de velocidad en curva, como el `driverminspeed` de HL2. */
  minSpeedFactor: number;
  /** TTC a partir del cual empieza a soltar el acelerador. */
  cautionTtc: number;
  /** TTC a partir del cual frena de emergencia. */
  emergencyTtc: number;
  /** Aceleración lateral que se anima a sostener en curva (m/s²). */
  corneringAcceleration: number;
  /** Desaceleración cómoda para llegar al destino rodando (m/s²). */
  arrivalDeceleration: number;
  /** Retardo entre que aparece un peligro y que este conductor reacciona. */
  reactionSeconds: number;
  /** Velocidad del volante en unidades normalizadas por segundo. */
  steeringRate: number;
  /** Subida/bajada del acelerador en unidades normalizadas por segundo. */
  throttleRate: number;
  /** Ganancia del término de esquive lateral. */
  avoidanceGain: number;
  /** Fracción de casco por debajo de la cual rompe contacto. 0 = nunca huye. */
  fleeThreshold: number;
  /** Distancia de combate preferida como fracción del alcance del arma. */
  engagementRangeFactor: number;
}

export interface VehicleGunnerProfile {
  id: VehicleGunnerProfileId;
  /** Tiempo desde que ve el blanco hasta el primer disparo. */
  acquisitionSeconds: number;
  /** Error de puntería inicial en radianes. */
  initialSpread: number;
  /** Error de puntería con el blanco ya seguido. */
  minSpread: number;
  /** Constante de tiempo con la que el error cae de `initial` a `min`. */
  tightenSeconds: number;
  /**
   * Cuánto se le abre la puntería por radián/s de movimiento angular del blanco.
   * Es lo que hace que un jugador que cruza de costado sea difícil de seguir y
   * uno que se queda quieto no: el modelo de "atrasarse" del artillero.
   */
  angularRateGain: number;
  /** Multiplicador sobre la velocidad de barrido de la torreta del preset. */
  traverseFactor: number;
}

const driverProfiles: Readonly<Record<VehicleDriverProfileId, VehicleDriverProfile>> = {
  cautious: {
    id: 'cautious',
    speedFactor: 0.7,
    minSpeedFactor: 0.16,
    cautionTtc: 3.2,
    emergencyTtc: 1,
    corneringAcceleration: 4,
    arrivalDeceleration: 2.2,
    reactionSeconds: 0.5,
    steeringRate: 1.8,
    throttleRate: 1.6,
    avoidanceGain: 1.05,
    fleeThreshold: 0.5,
    engagementRangeFactor: 0.6,
  },
  steady: {
    id: 'steady',
    speedFactor: 0.85,
    minSpeedFactor: 0.2,
    cautionTtc: 2.4,
    emergencyTtc: 0.75,
    corneringAcceleration: 5.5,
    arrivalDeceleration: 3,
    reactionSeconds: 0.35,
    steeringRate: 2.4,
    throttleRate: 2.2,
    avoidanceGain: 0.9,
    fleeThreshold: 0.35,
    engagementRangeFactor: 0.45,
  },
  aggressive: {
    id: 'aggressive',
    speedFactor: 1,
    minSpeedFactor: 0.26,
    cautionTtc: 1.8,
    emergencyTtc: 0.55,
    corneringAcceleration: 7,
    arrivalDeceleration: 4.2,
    reactionSeconds: 0.22,
    steeringRate: 3.2,
    throttleRate: 3,
    avoidanceGain: 0.8,
    fleeThreshold: 0.2,
    engagementRangeFactor: 0.35,
  },
  reckless: {
    id: 'reckless',
    speedFactor: 1,
    minSpeedFactor: 0.34,
    cautionTtc: 1.2,
    emergencyTtc: 0.35,
    corneringAcceleration: 8.5,
    arrivalDeceleration: 5.5,
    reactionSeconds: 0.15,
    steeringRate: 4,
    throttleRate: 3.6,
    avoidanceGain: 0.65,
    fleeThreshold: 0,
    engagementRangeFactor: 0.25,
  },
};

const gunnerProfiles: Readonly<Record<VehicleGunnerProfileId, VehicleGunnerProfile>> = {
  militia: {
    id: 'militia',
    acquisitionSeconds: 0.8,
    initialSpread: 0.075,
    minSpread: 0.018,
    tightenSeconds: 2.4,
    angularRateGain: 0.16,
    traverseFactor: 0.8,
  },
  trained: {
    id: 'trained',
    acquisitionSeconds: 0.5,
    initialSpread: 0.05,
    minSpread: 0.009,
    tightenSeconds: 1.5,
    angularRateGain: 0.1,
    traverseFactor: 1,
  },
  elite: {
    id: 'elite',
    acquisitionSeconds: 0.35,
    initialSpread: 0.032,
    minSpread: 0.005,
    tightenSeconds: 0.9,
    angularRateGain: 0.055,
    traverseFactor: 1.25,
  },
};

const presetDriverDefaults: Readonly<Partial<Record<VehiclePresetId, VehicleDriverProfileId>>> = {
  buggy: 'aggressive',
  airboat: 'steady',
  rebelCrawler: 'cautious',
  combineGlider: 'aggressive',
};

const presetGunnerDefaults: Readonly<Partial<Record<VehiclePresetId, VehicleGunnerProfileId>>> = {
  buggy: 'trained',
  airboat: 'militia',
  rebelCrawler: 'militia',
  combineGlider: 'elite',
  helicopter: 'elite',
};

export function driverProfile(id: VehicleDriverProfileId | undefined): VehicleDriverProfile {
  return driverProfiles[id ?? 'steady'];
}

export function gunnerProfile(id: VehicleGunnerProfileId | undefined): VehicleGunnerProfile {
  return gunnerProfiles[id ?? 'trained'];
}

export function defaultDriverProfileId(presetId: VehiclePresetId): VehicleDriverProfileId {
  return presetDriverDefaults[presetId] ?? 'steady';
}

export function defaultGunnerProfileId(presetId: VehiclePresetId): VehicleGunnerProfileId {
  return presetGunnerDefaults[presetId] ?? 'trained';
}

export function isVehicleDriverProfileId(value: unknown): value is VehicleDriverProfileId {
  return typeof value === 'string' &&
    VEHICLE_DRIVER_PROFILE_IDS.some((entry) => entry === value);
}

export function isVehicleGunnerProfileId(value: unknown): value is VehicleGunnerProfileId {
  return typeof value === 'string' &&
    VEHICLE_GUNNER_PROFILE_IDS.some((entry) => entry === value);
}

/**
 * Los comportamientos ofensivos pueden abandonar la misión para pelear; los de
 * logística y patrulla no, o el setpiece del nivel deja de ser predecible.
 */
export function defaultAllowsMissionDeviation(behavior: VehicleAiBehavior): boolean {
  return behavior === 'intercept' || behavior === 'flank';
}

/** Cuánto puede durar un desvío antes de que el vehículo retome su misión. */
export const VEHICLE_DEVIATION_BUDGET_SECONDS = 12;

/** Memoria del último-visto. Es el `NPC_APCDRIVER_REMEMBER_TIME` de HL2. */
export const VEHICLE_THREAT_MEMORY_SECONDS = 4;

export const VEHICLE_PERCEPTION = {
  /** Apertura total del cono de la tripulación: mira mucho más que un peatón. */
  visionConeRadians: 2.6,
  /** Dentro de este radio se percibe en 360°, el LOS físico sigue aplicando. */
  hearingRadius: 18,
  /** Alcance de visión como múltiplo del alcance del arma. */
  visionRangeFactor: 1.15,
  /** Alcance de visión de un vehículo desarmado. */
  unarmedVisionRange: 55,
  /** Cada cuánto se reevalúan los candidatos a blanco. */
  retargetSeconds: 0.5,
  /** Un candidato nuevo tiene que estar esta fracción más cerca para robar el blanco. */
  retargetAdvantage: 0.75,
} as const;
