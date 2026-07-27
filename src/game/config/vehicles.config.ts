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
      brakeForce: number;
      handbrakeForce: number;
      maxSteeringAngle: number;
      steeringFadeSpeed: number;
      boostMultiplier: number;
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
      steeringTorque: number;
      planingSpeed: number;
      buoyancy: number;
      waterDrag: number;
      lateralDrag: number;
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
      brakeForce: 115,
      handbrakeForce: 180,
      maxSteeringAngle: 0.52,
      steeringFadeSpeed: 28,
      boostMultiplier: 1.45,
      suspensionRestLength: 0.36,
      suspensionTravel: 0.24,
      suspensionStiffness: 32,
      suspensionCompression: 4.4,
      suspensionRelaxation: 5.2,
      tireFriction: 2.4,
    },
    body: {
      size: [2.15, 1.35, 3.8],
      colliderCenter: [0, 0.75, 0],
      centerOfMass: [0, -0.38, 0.1],
      mass: 920,
    },
    camera: groundCamera,
    seats: [
      {
        id: 'driver',
        role: 'driver',
        position: [-0.42, 1.05, 0.15],
        cameraPosition: [-0.42, 1.42, 0.15],
        exits: [[-1.45, 0.25, 0.15], [1.45, 0.25, 0.15], [0, 0.25, 2.25]],
        internalLinks: ['gunner'],
      },
      {
        id: 'gunner',
        role: 'gunner',
        position: [0.42, 1.05, 0.15],
        cameraPosition: [0.42, 1.42, 0.15],
        exits: [[1.45, 0.25, 0.15], [-1.45, 0.25, 0.15]],
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
      thrustForce: 3100,
      reverseForce: 950,
      steeringTorque: 2150,
      planingSpeed: 10,
      buoyancy: 1.18,
      waterDrag: 1.5,
      lateralDrag: 5.5,
      groundDrag: 3.8,
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
    },
    body: {
      size: [3.4, 2.8, 9.2],
      colliderCenter: [0, 1.25, 0.1],
      centerOfMass: [0, -0.25, 0.15],
      mass: 2850,
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
