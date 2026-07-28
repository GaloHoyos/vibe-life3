import type { Faction } from '@engine/ai/Faction';
import type { VectorTuple } from '@shared/math/VectorTuple';

export const VEHICLE_ARCHETYPE_IDS = ['buggy', 'airboat', 'helicopter'] as const;
export type VehicleArchetypeId = (typeof VEHICLE_ARCHETYPE_IDS)[number];
export type VehiclePresetId = VehicleArchetypeId;

export const VEHICLE_CREW_ROLES = [
  'commander',
  'driver',
  'pilot',
  'gunner',
  'passenger',
] as const;
export type VehicleCrewRole = (typeof VEHICLE_CREW_ROLES)[number];

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
    };

export interface VehicleSeatPreset {
  id: string;
  role: VehicleCrewRole;
  position: VectorTuple;
  cameraPosition: VectorTuple;
  exits: readonly VectorTuple[];
  internalLinks?: readonly string[];
  canUseWeapon?: boolean;
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
    surface: 'ground' | 'water' | 'rail';
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
        exits: [[1.45, 0.25, 0.15], [-1.45, 0.25, 0.15], [0, 0.25, 2.25]],
        internalLinks: ['gunner'],
      },
      {
        id: 'gunner',
        role: 'gunner',
        position: [-0.42, 1.05, 0.15],
        cameraPosition: [-0.42, 1.42, 0.15],
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
  }
}
