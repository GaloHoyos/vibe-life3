import type { Faction } from '@engine/ai/Faction';
import { WORLD_GRAVITY } from '@engine/physics/PhysicsWorld';
import type { VectorTuple } from '@shared/math/VectorTuple';

export const VEHICLE_ARCHETYPE_IDS = [
  'buggy',
  'airboat',
  'helicopter',
  'rebelCrawler',
  'combineGlider',
] as const;
export type VehicleArchetypeId = (typeof VEHICLE_ARCHETYPE_IDS)[number];

/**
 * El arquetipo decide el modelo, las cajas de daño y las capas de audio; el
 * preset decide el motor, los asientos y las reglas. Casi siempre coinciden,
 * pero el helicóptero existe en dos sabores sobre el mismo arquetipo: guionado
 * sobre un trazado o pilotable en vuelo libre.
 */
export const VEHICLE_PRESET_IDS = [
  ...VEHICLE_ARCHETYPE_IDS,
  'helicopterFree',
] as const;
export type VehiclePresetId = (typeof VEHICLE_PRESET_IDS)[number];

export const VEHICLE_CREW_ROLES = [
  'commander',
  'driver',
  'pilot',
  'gunner',
  'passenger',
] as const;
export type VehicleCrewRole = (typeof VEHICLE_CREW_ROLES)[number];

/** Puestos que manejan: deciden el control, el arranque y la pose de manos. */
export function isAtTheControls(role: VehicleCrewRole): boolean {
  return role === 'driver' || role === 'pilot';
}

export type VehicleMotorPreset =
  | {
      kind: 'raycast';
      engineForce: number;
      reverseForce: number;
      /** Impulso de freno por rueda y por paso fijo, en N·s. */
      brakeForce: number;
      handbrakeForce: number;
      /** Freno motor al soltar el acelerador, en N·s por rueda. */
      autoBrakeForce: number;
      /** Agarre lateral que le queda al tren de mano al tirar del freno, 0..1. */
      handbrakeSideFriction: number;
      maxSteeringAngle: number;
      steeringFadeSpeed: number;
      /** Curva de dirección: 1 lineal, >1 suaviza las correcciones chicas. */
      steeringExponent: number;
      boostMultiplier: number;
      /** Gravedad extra como múltiplo de la normal, para que no despegue. */
      extraGravity: number;
      /** Techo de velocidad angular, en rad/s. */
      maxAngularVelocity: number;
      /** Par que endereza el chasis en el aire, en N·m por radián. */
      uprightTorque: number;
      suspensionRestLength: number;
      suspensionTravel: number;
      suspensionStiffness: number;
      suspensionCompression: number;
      suspensionRelaxation: number;
      tireFriction: number;
    }
  | {
      kind: 'hover';
      surfaceMode: 'fluid' | 'antigrav';
      /** Altura de las sondas sobre la superficie en modo antigravitatorio. */
      hoverHeight?: number;
      thrustForce: number;
      reverseForce: number;
      /** Par de guiñada disponible sin acelerador, para maniobrar parado. */
      steeringTorque: number;
      /** Desviación máxima del empuje a tope de timón, en radianes. */
      rudderAngle: number;
      /** Punto de aplicación del empuje en espacio local: la popa. */
      thrustPoint: VectorTuple;
      /**
       * Centro de resistencia lateral. Va por DETRÁS del centro de masa: es lo
       * que orienta el casco hacia donde viaja, igual que las plumas de una
       * flecha. Por delante haría exactamente lo contrario.
       */
      lateralDragPoint: VectorTuple;
      /** Fracción del empuje disponible con el casco varado. */
      landThrustFactor: number;
      planingSpeed: number;
      buoyancy: number;
      /**
       * Arrastres expresados como tasa por segundo: el motor los multiplica por
       * la masa, así el manejo no cambia si se retoca el peso del casco.
       */
      waterDrag: number;
      lateralDrag: number;
      /** Amortiguación de guiñada, también relativa a la masa. */
      yawDamping: number;
      /** Multiplicador de arrastre con el freno de agua puesto. */
      waterBrakeDrag: number;
      groundDrag: number;
      uprightTorque?: number;
      uprightDamping?: number;
      hoverSpringLength?: number;
      hoverDamping?: number;
      throttleResponse?: number;
      steeringResponse?: number;
      lowSpeedSteeringAuthority?: number;
      lowSpeedSteeringFadeSpeed?: number;
      probeOffsets: readonly VectorTuple[];
    }
  | {
      kind: 'onRails';
      cruiseSpeed: number;
      acceleration: number;
      braking: number;
      maxBank: number;
      lookAhead: number;
      /** Múltiplo del crucero alcanzable a fondo de acelerador. */
      throttleBoostFactor: number;
      /** Fracción del crucero disponible yendo marcha atrás por el trazado. */
      reverseFactor: number;
      /** Cuánto puede apartarse el piloto del trazado, en metros. */
      lateralRange: number;
      lateralResponse: number;
    }
  | {
      kind: 'rotorcraft';
      /** Fracción del peso que sostiene el rotor con el colectivo en neutro. */
      hoverLift: number;
      maxLift: number;
      minLift: number;
      liftResponse: number;
      /** Inclinación máxima que pide el cíclico, en radianes. */
      maxPitch: number;
      maxRoll: number;
      /** Rapidez con que el aparato adopta la actitud pedida, en 1/s. */
      attitudeResponse: number;
      /** Par de actitud y su amortiguación, relativos a la masa. */
      attitudeStiffness: number;
      attitudeDamping: number;
      /** Guiñada a pedal lleno, en rad/s. */
      yawRate: number;
      /** Guiñada que induce el alabeo a fondo, en rad/s. */
      turnCoordination: number;
      /** Arrastres como tasa por segundo, relativos a la masa. */
      linearDrag: number;
      verticalDrag: number;
      groundDrag: number;
      /** Altura del punto más bajo del casco sobre el origen del cuerpo. */
      hullBottom: number;
    };

export interface VehicleSeatPreset {
  id: string;
  role: VehicleCrewRole;
  position: VectorTuple;
  cameraPosition: VectorTuple;
  exits: readonly VectorTuple[];
  internalLinks?: readonly string[];
  canUseWeapon?: boolean;
  /**
   * Corrimiento local del cuerpo del ocupante respecto del anchor del asiento.
   * `position` está calibrado para el collider del jugador, así que el modelo
   * sentado necesita su propio ajuste (altura de cadera, distancia al volante).
   */
  occupantOffset?: VectorTuple;
}

export interface VehicleDamageZonePreset {
  id: 'hull' | 'engine' | 'steering' | 'weapon' | 'rotor' | 'fuel';
  health: number;
  damageMultiplier: number;
  disableAtZero?: boolean;
}

export interface VehicleMountedWeaponPreset {
  kind: 'inductionCannon' | 'pulseCannon' | 'doorGun';
  damage: number;
  fireRate: number;
  range: number;
  heatPerShot: number;
  coolingPerSecond: number;
  yawLimit: number;
  pitchMin: number;
  pitchMax: number;
  /**
   * Velocidad de giro de la torreta en rad/s. No hay rango mínimo autorado: un
   * blanco demasiado cerca y abajo cae fuera de `pitchMin` y la zona muerta sale
   * sola de los límites de recorrido, como el `m_bInFiringCone` del APC de HL2.
   */
  traverseSpeed: number;
  /** Error de puntería máximo con el que el artillero se permite disparar. */
  firingConeRadians: number;
  /** Disparos por ráfaga antes de la pausa. */
  burstSize: number;
  /** Pausa entre ráfagas. */
  burstPauseSeconds: number;
}

export interface VehiclePresetDefinition {
  id: VehiclePresetId;
  archetype: VehicleArchetypeId;
  displayName: string;
  defaultFaction: Faction;
  motor: VehicleMotorPreset;
  body: {
    size: VectorTuple;
    colliderCenter: VectorTuple;
    centerOfMass: VectorTuple;
    mass: number;
    /** Rozamiento del casco contra el mundo. */
    hullFriction: number;
  };
  camera: {
    enterBlendSeconds: number;
    exitBlendSeconds: number;
    maxYaw: number;
    minPitch: number;
    maxPitch: number;
    speedFovGain: number;
    positionDamping: number;
    rotationDamping: number;
  };
  seats: readonly VehicleSeatPreset[];
  damageZones: readonly VehicleDamageZonePreset[];
  weapon?: VehicleMountedWeaponPreset;
  navigation: {
    surface: 'ground' | 'water' | 'rail' | 'air';
    halfWidth: number;
    halfLength: number;
    clearanceHeight: number;
    minTurnRadius: number;
    reverseAllowed: boolean;
  };
}

const groundCamera = {
  enterBlendSeconds: 0.35,
  exitBlendSeconds: 0.25,
  maxYaw: 1.75,
  minPitch: -0.95,
  maxPitch: 0.8,
  speedFovGain: 8,
  positionDamping: 12,
  rotationDamping: 10,
} as const;

export const VehiclePresets = {
  buggy: {
    id: 'buggy',
    archetype: 'buggy',
    displayName: 'Buggy de la Resistencia',
    defaultFaction: 'resistance',
    motor: {
      kind: 'raycast',
      engineForce: 2350,
      reverseForce: 1450,
      brakeForce: 75,
      handbrakeForce: 130,
      autoBrakeForce: 14,
      handbrakeSideFriction: 0.32,
      maxSteeringAngle: 0.52,
      steeringFadeSpeed: 28,
      steeringExponent: 1.4,
      boostMultiplier: 1.45,
      extraGravity: 0.3,
      maxAngularVelocity: 5,
      uprightTorque: 3500,
      suspensionRestLength: 0.36,
      suspensionTravel: 0.24,
      suspensionStiffness: 32,
      suspensionCompression: 4.4,
      suspensionRelaxation: 5.2,
      tireFriction: 1.5,
    },
    body: {
      size: [2.15, 1.35, 3.8],
      colliderCenter: [0, 0.75, 0],
      centerOfMass: [0, -0.38, 0.1],
      mass: 920,
      hullFriction: 0.92,
    },
    camera: groundCamera,
    seats: [
      // Puesto de manejo en +X: la derecha del vehículo es −X, así que el
      // volante va a la izquierda y el cañón queda del lado del artillero.
      {
        id: 'driver',
        role: 'driver',
        position: [0.42, 1.05, 0.15],
        cameraPosition: [0.42, 1.42, 0.15],
        occupantOffset: [0, 0.12, -0.12],
        exits: [[1.45, 0.25, 0.15], [-1.45, 0.25, 0.15], [0, 0.25, 2.25]],
        internalLinks: ['gunner'],
      },
      {
        id: 'gunner',
        role: 'gunner',
        position: [-0.42, 1.05, 0.15],
        cameraPosition: [-0.42, 1.42, 0.15],
        occupantOffset: [0, 0.12, -0.12],
        exits: [[-1.45, 0.25, 0.15], [1.45, 0.25, 0.15]],
        internalLinks: ['driver'],
        canUseWeapon: true,
      },
    ],
    damageZones: [
      { id: 'hull', health: 450, damageMultiplier: 1 },
      { id: 'engine', health: 150, damageMultiplier: 1.35, disableAtZero: true },
      { id: 'steering', health: 100, damageMultiplier: 1.2 },
      { id: 'weapon', health: 100, damageMultiplier: 1.1, disableAtZero: true },
      { id: 'fuel', health: 90, damageMultiplier: 1.5 },
    ],
    weapon: {
      kind: 'inductionCannon',
      damage: 34,
      fireRate: 4,
      range: 120,
      heatPerShot: 0.12,
      coolingPerSecond: 0.22,
      yawLimit: 1.25,
      pitchMin: -0.45,
      pitchMax: 0.65,
      traverseSpeed: 1.5,
      firingConeRadians: 0.055,
      burstSize: 4,
      burstPauseSeconds: 1.8,
    },
    navigation: {
      surface: 'ground',
      halfWidth: 1.1,
      halfLength: 1.9,
      clearanceHeight: 1.8,
      minTurnRadius: 4.2,
      reverseAllowed: true,
    },
  },
  airboat: {
    id: 'airboat',
    archetype: 'airboat',
    displayName: 'Hidrodeslizador industrial',
    defaultFaction: 'resistance',
    motor: {
      kind: 'hover',
      surfaceMode: 'fluid',
      thrustForce: 4200,
      reverseForce: 1150,
      steeringTorque: 620,
      rudderAngle: 0.6,
      thrustPoint: [0, 0.35, -1.9],
      lateralDragPoint: [0, 0, -1.6],
      landThrustFactor: 1,
      planingSpeed: 10,
      buoyancy: 1.18,
      waterDrag: 0.12,
      lateralDrag: 0.7,
      yawDamping: 2.6,
      waterBrakeDrag: 4,
      groundDrag: 0.35,
      probeOffsets: [
        [-0.72, -0.25, 1.25],
        [0.72, -0.25, 1.25],
        [-0.72, -0.25, -1.25],
        [0.72, -0.25, -1.25],
        [0, -0.2, 0],
      ],
    },
    body: {
      size: [2.35, 1.45, 4.4],
      colliderCenter: [0, 0.55, 0],
      centerOfMass: [0, -0.32, -0.1],
      mass: 780,
      // Un casco liso varado tiene que poder arrastrarse de vuelta al agua.
      hullFriction: 0.12,
    },
    camera: { ...groundCamera, speedFovGain: 10, positionDamping: 10 },
    seats: [
      {
        id: 'driver',
        role: 'driver',
        position: [0, 0.95, -0.35],
        cameraPosition: [0, 1.38, -0.25],
        occupantOffset: [0, 0.16, 0.1],
        exits: [[-1.55, 0.25, -0.1], [1.55, 0.25, -0.1], [0, 0.25, 2.55]],
        canUseWeapon: true,
      },
    ],
    damageZones: [
      { id: 'hull', health: 400, damageMultiplier: 0.9 },
      { id: 'engine', health: 125, damageMultiplier: 1.4, disableAtZero: true },
      { id: 'steering', health: 90, damageMultiplier: 1.2 },
      { id: 'weapon', health: 100, damageMultiplier: 1.15, disableAtZero: true },
      { id: 'fuel', health: 85, damageMultiplier: 1.5 },
    ],
    weapon: {
      kind: 'pulseCannon',
      damage: 16,
      fireRate: 10,
      range: 95,
      heatPerShot: 0.045,
      coolingPerSecond: 0.3,
      yawLimit: 1.05,
      pitchMin: -0.35,
      pitchMax: 0.55,
      traverseSpeed: 1.9,
      firingConeRadians: 0.07,
      burstSize: 12,
      burstPauseSeconds: 1.4,
    },
    navigation: {
      surface: 'water',
      halfWidth: 1.2,
      halfLength: 2.2,
      clearanceHeight: 2,
      minTurnRadius: 5,
      reverseAllowed: true,
    },
  },
  helicopter: {
    id: 'helicopter',
    archetype: 'helicopter',
    displayName: 'Helicóptero utilitario de la Resistencia',
    defaultFaction: 'resistance',
    motor: {
      kind: 'onRails',
      cruiseSpeed: 22,
      acceleration: 4.5,
      braking: 7,
      maxBank: 0.38,
      lookAhead: 8,
      throttleBoostFactor: 1.7,
      reverseFactor: 0.4,
      lateralRange: 7,
      lateralResponse: 2.6,
    },
    body: {
      size: [3.4, 2.8, 9.2],
      colliderCenter: [0, 1.25, 0.1],
      centerOfMass: [0, -0.25, 0.15],
      mass: 2850,
      hullFriction: 0.85,
    },
    camera: {
      enterBlendSeconds: 0.5,
      exitBlendSeconds: 0.35,
      maxYaw: 1.55,
      minPitch: -0.85,
      maxPitch: 0.75,
      speedFovGain: 7,
      positionDamping: 8,
      rotationDamping: 7,
    },
    seats: [
      {
        id: 'pilot',
        role: 'pilot',
        position: [-0.58, 1.35, 2.45],
        cameraPosition: [-0.58, 1.82, 2.42],
        exits: [[-1.75, 0.2, 1.25]],
      },
      {
        id: 'commander',
        role: 'commander',
        position: [0.58, 1.35, 2.45],
        cameraPosition: [0.58, 1.82, 2.42],
        exits: [[1.75, 0.2, 1.25]],
      },
      {
        id: 'door-gunner',
        role: 'gunner',
        position: [-1.05, 1.15, -0.25],
        cameraPosition: [-1.22, 1.65, -0.25],
        exits: [[-1.85, 0.15, -0.25]],
        canUseWeapon: true,
      },
      {
        id: 'passenger',
        role: 'passenger',
        position: [0.62, 1.05, -0.75],
        cameraPosition: [0.62, 1.55, -0.75],
        exits: [[1.85, 0.15, -0.75]],
      },
    ],
    damageZones: [
      { id: 'hull', health: 750, damageMultiplier: 0.75 },
      { id: 'engine', health: 180, damageMultiplier: 1.3, disableAtZero: true },
      { id: 'rotor', health: 160, damageMultiplier: 1.35, disableAtZero: true },
      { id: 'weapon', health: 120, damageMultiplier: 1.15, disableAtZero: true },
      { id: 'fuel', health: 120, damageMultiplier: 1.5 },
    ],
    weapon: {
      kind: 'doorGun',
      damage: 12,
      fireRate: 13,
      range: 110,
      heatPerShot: 0.035,
      coolingPerSecond: 0.25,
      yawLimit: 1.4,
      pitchMin: -0.75,
      pitchMax: 0.55,
      // Calcado del APC de HL2: 10 tiros a ~0.075 s y 2 s de pausa.
      traverseSpeed: 2.2,
      firingConeRadians: 0.06,
      burstSize: 10,
      burstPauseSeconds: 2,
    },
    navigation: {
      surface: 'rail',
      halfWidth: 2,
      halfLength: 4.7,
      clearanceHeight: 3.2,
      minTurnRadius: 12,
      reverseAllowed: false,
    },
  },
  helicopterFree: {
    id: 'helicopterFree',
    archetype: 'helicopter',
    displayName: 'Helicóptero utilitario (pilotable)',
    defaultFaction: 'resistance',
    motor: {
      kind: 'rotorcraft',
      // Por debajo de 1 el aparato pierde altura al soltar el colectivo, que es
      // lo que separa "pilotar" de "flotar".
      hoverLift: 0.94,
      maxLift: 1.55,
      minLift: 0.35,
      liftResponse: 2.6,
      maxPitch: 0.42,
      maxRoll: 0.5,
      attitudeResponse: 2.4,
      attitudeStiffness: 70,
      attitudeDamping: 46,
      yawRate: 1.1,
      turnCoordination: 0.75,
      // Velocidad punta = g·tan(maxPitch)/linearDrag ≈ 30 m/s con g = 20.5.
      linearDrag: 0.3,
      // Trepada ≈ 12.5 m/s a colectivo lleno; hundimiento ≈ 1.4 m/s soltando.
      verticalDrag: 0.9,
      groundDrag: 1.6,
      // colliderCenter.y - size.y * 0.38, o sea el fondo del casco de colisión.
      hullBottom: 0.19,
    },
    body: {
      size: [3.4, 2.8, 9.2],
      colliderCenter: [0, 1.25, 0.1],
      centerOfMass: [0, -0.25, 0.15],
      mass: 2850,
      hullFriction: 0.85,
    },
    camera: {
      enterBlendSeconds: 0.5,
      exitBlendSeconds: 0.35,
      maxYaw: 1.9,
      minPitch: -1.1,
      maxPitch: 0.75,
      speedFovGain: 7,
      positionDamping: 8,
      rotationDamping: 7,
    },
    // Cada puesto tiene un abanico de anclas SOBRE SU PROPIO LADO. Con una
    // sola, el que la tiene enfrentada camina contra el casco: la navegación a
    // pie no conoce el aparato estacionado y traza la recta que lo atraviesa.
    seats: [
      {
        id: 'pilot',
        role: 'pilot',
        position: [-0.58, 1.35, 2.45],
        cameraPosition: [-0.58, 1.82, 2.42],
        exits: [[-1.75, 0.2, 1.25], [-2.4, 0.2, 2.6], [-2.4, 0.2, 0.2]],
      },
      {
        id: 'commander',
        role: 'commander',
        position: [0.58, 1.35, 2.45],
        cameraPosition: [0.58, 1.82, 2.42],
        exits: [[1.75, 0.2, 1.25], [2.4, 0.2, 2.6], [2.4, 0.2, 0.2]],
      },
      {
        id: 'door-gunner',
        role: 'gunner',
        position: [-1.05, 1.15, -0.25],
        cameraPosition: [-1.22, 1.65, -0.25],
        exits: [[-1.85, 0.15, -0.25], [-2.6, 0.15, -1.8], [-2.6, 0.15, 1.0]],
        canUseWeapon: true,
      },
      {
        id: 'passenger',
        role: 'passenger',
        position: [0.62, 1.05, -0.75],
        cameraPosition: [0.62, 1.55, -0.75],
        exits: [[1.85, 0.15, -0.75], [2.6, 0.15, -2.2], [2.6, 0.15, 0.6]],
      },
    ],
    damageZones: [
      { id: 'hull', health: 750, damageMultiplier: 0.75 },
      { id: 'engine', health: 180, damageMultiplier: 1.3, disableAtZero: true },
      { id: 'rotor', health: 160, damageMultiplier: 1.35, disableAtZero: true },
      { id: 'weapon', health: 120, damageMultiplier: 1.15, disableAtZero: true },
      { id: 'fuel', health: 120, damageMultiplier: 1.5 },
    ],
    weapon: {
      kind: 'doorGun',
      damage: 12,
      fireRate: 13,
      range: 110,
      heatPerShot: 0.035,
      coolingPerSecond: 0.25,
      yawLimit: 1.4,
      pitchMin: -0.75,
      pitchMax: 0.55,
      traverseSpeed: 2.2,
      firingConeRadians: 0.06,
      burstSize: 10,
      burstPauseSeconds: 2,
    },
    navigation: {
      surface: 'air',
      halfWidth: 2,
      halfLength: 4.7,
      clearanceHeight: 3.2,
      minTurnRadius: 12,
      reverseAllowed: false,
    },
  },
  rebelCrawler: {
    id: 'rebelCrawler',
    archetype: 'rebelCrawler',
    displayName: 'Transporte oruga rebelde',
    defaultFaction: 'resistance',
    motor: {
      kind: 'raycast',
      engineForce: 4_600,
      reverseForce: 2_900,
      brakeForce: 105,
      handbrakeForce: 165,
      autoBrakeForce: 20,
      handbrakeSideFriction: 0.45,
      maxSteeringAngle: 0.42,
      steeringFadeSpeed: 20,
      steeringExponent: 1.25,
      boostMultiplier: 1.15,
      extraGravity: 0.55,
      maxAngularVelocity: 3.2,
      uprightTorque: 6_800,
      suspensionRestLength: 0.42,
      suspensionTravel: 0.28,
      suspensionStiffness: 40,
      suspensionCompression: 5,
      suspensionRelaxation: 5.7,
      tireFriction: 2,
    },
    body: {
      size: [2.7, 2.05, 4.9],
      colliderCenter: [0, 1, 0],
      centerOfMass: [0, -0.58, 0.05],
      mass: 2_100,
      hullFriction: 0.82,
    },
    camera: {
      ...groundCamera,
      speedFovGain: 5,
      positionDamping: 10,
      rotationDamping: 9,
    },
    seats: [
      {
        id: 'driver',
        role: 'driver',
        position: [0.48, 1.45, 0.78],
        cameraPosition: [0.48, 1.86, 0.82],
        occupantOffset: [0, 0.1, 0],
        exits: [[1.72, 0.35, 0.55], [-1.72, 0.35, 0.55], [0, 0.35, -2.8]],
        internalLinks: ['passenger'],
      },
      {
        id: 'passenger',
        role: 'passenger',
        position: [-0.48, 1.45, 0.78],
        cameraPosition: [-0.48, 1.86, 0.82],
        occupantOffset: [0, 0.1, 0],
        exits: [[-1.72, 0.35, 0.55], [1.72, 0.35, 0.55], [0, 0.35, -2.8]],
        internalLinks: ['driver'],
      },
    ],
    damageZones: [
      { id: 'hull', health: 750, damageMultiplier: 0.78 },
      { id: 'engine', health: 220, damageMultiplier: 1.25, disableAtZero: true },
      { id: 'steering', health: 140, damageMultiplier: 1.1 },
      { id: 'fuel', health: 130, damageMultiplier: 1.45 },
    ],
    navigation: {
      surface: 'ground',
      halfWidth: 1.38,
      halfLength: 2.45,
      clearanceHeight: 2.6,
      minTurnRadius: 5.2,
      reverseAllowed: true,
    },
  },
  combineGlider: {
    id: 'combineGlider',
    archetype: 'combineGlider',
    displayName: 'Deslizador Combine de reconocimiento',
    defaultFaction: 'combine',
    motor: {
      kind: 'hover',
      surfaceMode: 'antigrav',
      hoverHeight: 0.52,
      thrustForce: 6_500,
      reverseForce: 3_000,
      steeringTorque: 3_200,
      rudderAngle: 0.16,
      thrustPoint: [0, 0.34, -1.34],
      lateralDragPoint: [0, 0.05, -0.28],
      landThrustFactor: 1,
      planingSpeed: 14,
      buoyancy: 1.06,
      waterDrag: 0.18,
      lateralDrag: 3.4,
      yawDamping: 2.6,
      waterBrakeDrag: 5.2,
      groundDrag: 0.18,
      uprightTorque: 7_200,
      uprightDamping: 3_000,
      hoverSpringLength: 0.16,
      hoverDamping: 0.2,
      throttleResponse: 8.5,
      steeringResponse: 16,
      lowSpeedSteeringAuthority: 1,
      lowSpeedSteeringFadeSpeed: 9,
      probeOffsets: [
        [0, -0.36, 1.28],
        [-0.78, -0.36, -0.92],
        [0.78, -0.36, -0.92],
      ],
    },
    body: {
      size: [2.2, 1.25, 3.5],
      colliderCenter: [0, 0.55, 0],
      centerOfMass: [0, -0.3, -0.08],
      mass: 680,
      hullFriction: 0.06,
    },
    camera: {
      ...groundCamera,
      maxYaw: 1.9,
      speedFovGain: 11,
      positionDamping: 10,
      rotationDamping: 9,
    },
    seats: [
      {
        id: 'driver',
        role: 'driver',
        position: [0, 0.98, -0.08],
        cameraPosition: [0, 1.5, 0.02],
        occupantOffset: [0, 0.14, 0],
        exits: [[-1.48, 0.25, -0.05], [1.48, 0.25, -0.05], [0, 0.25, 2.15]],
      },
    ],
    damageZones: [
      { id: 'hull', health: 360, damageMultiplier: 0.92 },
      { id: 'engine', health: 120, damageMultiplier: 1.4, disableAtZero: true },
      { id: 'steering', health: 90, damageMultiplier: 1.25 },
      { id: 'fuel', health: 95, damageMultiplier: 1.5 },
    ],
    navigation: {
      surface: 'ground',
      halfWidth: 1.12,
      halfLength: 1.78,
      clearanceHeight: 1.65,
      minTurnRadius: 3.8,
      reverseAllowed: true,
    },
  },
} as const satisfies Record<VehiclePresetId, VehiclePresetDefinition>;

export function isVehiclePresetId(value: string): value is VehiclePresetId {
  return Object.prototype.hasOwnProperty.call(VehiclePresets, value);
}

/**
 * Velocidad punta aproximada en m/s. La usan tanto la IA para planificar como
 * el HUD para escalar el velocímetro: si cada uno la dedujera por su cuenta el
 * indicador terminaría desfasado del comportamiento real.
 */
export function vehicleTopSpeed(preset: VehiclePresetDefinition): number {
  switch (preset.motor.kind) {
    case 'raycast':
      return Math.max(18, preset.motor.steeringFadeSpeed * 1.25);
    case 'hover':
      return Math.max(18, preset.motor.planingSpeed * 2.25);
    case 'onRails':
      return preset.motor.cruiseSpeed * preset.motor.throttleBoostFactor;
    case 'rotorcraft':
      // La punta sale del equilibrio entre el empuje horizontal a inclinación
      // máxima y el arrastre lineal, no de un tope autorado.
      return (
        (WORLD_GRAVITY * Math.tan(preset.motor.maxPitch)) /
        preset.motor.linearDrag
      );
  }
}

/**
 * Si el vehículo se planifica sobre la grilla de navegación vehicular. Los
 * guionados siguen su trazado y los aéreos no tienen grilla que pisar.
 */
export function usesGroundNavigation(preset: VehiclePresetDefinition): boolean {
  return (
    preset.navigation.surface === 'ground' ||
    preset.navigation.surface === 'water'
  );
}
