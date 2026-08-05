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
  combineSwimmer: 'aggressive',
};

const presetGunnerDefaults: Readonly<Partial<Record<VehiclePresetId, VehicleGunnerProfileId>>> = {
  buggy: 'trained',
  airboat: 'militia',
  rebelCrawler: 'militia',
  combineGlider: 'elite',
  combineSwimmer: 'elite',
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

/**
 * Memoria del último-visto. Quien recuerda es la tripulación, así que no puede
 * durar menos que la memoria del mismo soldado a pie (8 s en `combinePreset`):
 * con los 4 s del `NPC_APCDRIVER_REMEMBER_TIME` de HL2 el vehículo olvidaba el
 * blanco ANTES de llegar al punto donde lo perdió, y todo lo que cuelga de
 * haber llegado —buscar, bajar infantería— no pasaba nunca.
 */
export const VEHICLE_THREAT_MEMORY_SECONDS = 8;

export const VEHICLE_PILOT_PROFILE_IDS = ['transport', 'gunship'] as const;
export type VehiclePilotProfileId = (typeof VEHICLE_PILOT_PROFILE_IDS)[number];

export interface VehiclePilotProfile {
  id: VehiclePilotProfileId;
  /** Altura de crucero sobre el terreno, en metros. */
  cruiseAltitude: number;
  /** Altura a la que orbita mientras pelea. */
  combatAltitude: number;
  cruiseSpeed: number;
  /** Radio de la órbita de combate como múltiplo del alcance del arma. */
  standoffRangeFactor: number;
  /** Velocidad angular de la órbita, en rad/s. */
  orbitSpeed: number;
  /** Fracción de casco a la que rompe contacto. */
  fleeThreshold: number;
  /** Fracción de casco a la que busca posarse donde sea. */
  emergencyLandingThreshold: number;
}

const pilotProfiles: Readonly<Record<VehiclePilotProfileId, VehiclePilotProfile>> = {
  /** Vuela alto y lejos del fuego: su carga son los pasajeros. */
  transport: {
    id: 'transport',
    cruiseAltitude: 34,
    combatAltitude: 30,
    cruiseSpeed: 22,
    standoffRangeFactor: 0.75,
    orbitSpeed: 0.16,
    fleeThreshold: 0.55,
    emergencyLandingThreshold: 0.3,
  },
  /** Orbita cerca y bajo para que la torreta de puerta tenga ángulo. */
  gunship: {
    id: 'gunship',
    cruiseAltitude: 26,
    combatAltitude: 20,
    cruiseSpeed: 26,
    standoffRangeFactor: 0.5,
    orbitSpeed: 0.3,
    fleeThreshold: 0.22,
    emergencyLandingThreshold: 0.12,
  },
};

export function pilotProfile(id: VehiclePilotProfileId | undefined): VehiclePilotProfile {
  return pilotProfiles[id ?? 'gunship'];
}

export function isVehiclePilotProfileId(value: unknown): value is VehiclePilotProfileId {
  return typeof value === 'string' &&
    VEHICLE_PILOT_PROFILE_IDS.some((entry) => entry === value);
}

/**
 * El comportamiento autorado decide el oficio del piloto: quien transporta
 * tropa no se pone a orbitar un blanco a 20 m del suelo.
 */
export function defaultPilotProfileId(
  behavior: VehicleAiBehavior,
): VehiclePilotProfileId {
  return behavior === 'transport' || behavior === 'escort'
    ? 'transport'
    : 'gunship';
}

/** Altura sobre el terreno a partir de la cual el aparato cuenta como volando. */
export const AIR_TAKEOFF_CLEAR_ALTITUDE = 6;
/** Radio dentro del cual una zona de aterrizaje se considera alcanzada. */
export const AIR_LANDING_ARRIVAL_RADIUS = 4;

/**
 * Cuándo a un NPC le conviene ir en vehículo. El criterio es comparar tiempos
 * estimados, no distancias: lo que decide es si el rodeo por la carretera llega
 * antes que la línea recta a pie, contando lo que cuesta caminar hasta el
 * vehículo y subirse.
 */
export const VEHICLE_CREW_DECISION = {
  /** Cada cuánto un NPC reevalúa si le conviene un vehículo. */
  evaluateSeconds: 0.5,
  /**
   * Una vez decidido, cuánto sostiene la decisión sin volver a compararla. Sin
   * esto dos opciones parejas hacen que el NPC dude en la puerta del vehículo.
   */
  commitSeconds: 4,
  /** Lo que se tarda en subir, de llegar a la puerta a estar a los mandos. */
  boardingSeconds: 2.5,
  /** El vehículo tiene que ganar por este margen para justificar el desvío. */
  advantageMargin: 0.75,
  /** Radio de búsqueda de vehículos utilizables alrededor del NPC. */
  searchRadius: 45,
  /** Con el objetivo más cerca que esto, ir a buscar un vehículo es absurdo. */
  minGoalDistance: 25,
  /** Fracción de la velocidad máxima que un conductor sostiene de verdad. */
  driveSpeedFactor: 0.7,
  /**
   * A qué ritmo de separación (m/s) se da por perdida la persecución a pie. Con
   * el blanco alejándose más rápido de lo que uno corre, la comparación de
   * tiempos deja de tener sentido: a pie no se lo alcanza nunca, mida lo que
   * mida la distancia, y cualquier vehículo que llegue es mejor que ninguno.
   *
   * Es lo que hace que la decisión exista en la práctica: con 32 m de visión, la
   * banda donde un vehículo gana por tiempo puro es demasiado angosta.
   */
  recedingSpeed: 1.5,
  /** Vehículos de oportunidad simultáneos por facción. */
  maxActivePerFaction: 2,
  /** Veda tras perder un vehículo, para que no insistan en fila. */
  lossCooldownSeconds: 20,
  /** Quién se sube con el que reclamó los mandos. */
  squadBoardRadius: 18,
  /**
   * A qué distancia del blanco inalcanzable se baja la infantería. Más lejos el
   * vehículo todavía puede acercarse; soltarlos a 300 m no ayuda a nadie.
   */
  dismountRange: 45,
  /**
   * Cuánto tarda en volver a ser tripulación quien acaba de bajarse a seguir a
   * pie. Sin esto el vehículo que lo soltó lo recluta de nuevo en cuanto pierde
   * el rastro, y el soldado pasa la pelea subiendo y bajando.
   */
  dismountCooldownSeconds: 25,
} as const;

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
