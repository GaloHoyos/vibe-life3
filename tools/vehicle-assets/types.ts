export type VehicleAssetId = "buggy" | "airboat" | "helicopter";

export type Vec3 = readonly [number, number, number];

export type Euler = readonly [number, number, number];

export type AtlasTile = 0 | 1 | 2 | 3;

export interface VehicleAssetSpec {
  readonly id: VehicleAssetId;
  readonly displayName: string;
  readonly seed: number;
  readonly maxTrianglesLod0: number;
  readonly maxDrawsPerLod: number;
  readonly maxGlbBytes: number;
  readonly colors: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  readonly requiredNodes: readonly string[];
}

export interface GeneratedTextureSet {
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  readonly pbr: Uint8Array;
}

export interface LodStats {
  readonly triangles: number;
  readonly draws: number;
}

export interface GeneratedVehicleStats {
  readonly id: VehicleAssetId;
  readonly glbBytes: number;
  readonly lods: readonly [LodStats, LodStats, LodStats];
  readonly nodeNames: readonly string[];
}

export interface GeneratedAudioStats {
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly durationSeconds: number;
  }[];
  readonly totalBytes: number;
}

export interface VehicleAssetManifest {
  readonly schemaVersion: 1;
  readonly generator: "vibe-life3-procedural-vehicles";
  readonly coordinateSystem: {
    readonly units: "meters";
    readonly up: "+Y";
    readonly physicalForward: "+Z";
    readonly cameraLook: "-Z rotated toward +Z";
  };
  readonly generatedAt: "deterministic";
  readonly vehicles: readonly GeneratedVehicleStats[];
  readonly audio: GeneratedAudioStats;
}

export const VEHICLE_SPECS: readonly VehicleAssetSpec[] = [
  {
    id: "buggy",
    displayName: "Buggy civil recuperado",
    seed: 0x31415926,
    maxTrianglesLod0: 75_000,
    maxDrawsPerLod: 18,
    maxGlbBytes: 8 * 1024 * 1024,
    colors: [
      [202, 190, 157],
      [137, 60, 38],
      [45, 48, 45],
      [29, 31, 32],
    ],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "wheel_front_left",
      "wheel_front_right",
      "wheel_rear_left",
      "wheel_rear_right",
      "turret_yaw",
      "turret_pitch",
      "seat_driver",
      "seat_gunner",
      "camera_driver",
      "exit_left",
      "exit_right",
      "muzzle",
      "audio_engine",
      "audio_transmission",
      "damage_engine",
      "damage_steering",
      "damage_weapon",
      "damage_fuel",
      "wreckage",
    ],
  },
  {
    id: "airboat",
    displayName: "Skiff industrial de mantenimiento",
    seed: 0x27182818,
    maxTrianglesLod0: 80_000,
    maxDrawsPerLod: 18,
    maxGlbBytes: 8 * 1024 * 1024,
    colors: [
      [224, 173, 39],
      [43, 48, 48],
      [125, 132, 128],
      [109, 52, 35],
    ],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "fan_left",
      "fan_right",
      "rudder_left",
      "rudder_right",
      "turret_yaw",
      "turret_pitch",
      "seat_driver",
      "seat_gunner",
      "camera_driver",
      "exit_left",
      "exit_right",
      "muzzle",
      "audio_fan",
      "audio_water",
      "damage_engine",
      "damage_hull",
      "damage_weapon",
      "damage_fuel",
      "wreckage",
    ],
  },
  {
    id: "helicopter",
    displayName: "Helicóptero utilitario de la Resistencia",
    seed: 0x16180339,
    maxTrianglesLod0: 125_000,
    maxDrawsPerLod: 24,
    maxGlbBytes: 14 * 1024 * 1024,
    colors: [
      [79, 91, 62],
      [200, 190, 158],
      [44, 49, 47],
      [126, 62, 39],
    ],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "rotor_main",
      "rotor_tail",
      "turret_yaw",
      "turret_pitch",
      "seat_pilot",
      "seat_gunner",
      "seat_passenger_left",
      "seat_passenger_right",
      "camera_pilot",
      "camera_gunner",
      "exit_left",
      "exit_right",
      "muzzle",
      "audio_rotor",
      "audio_cabin",
      "audio_alarm",
      "damage_rotor",
      "damage_engine",
      "damage_cockpit",
      "damage_fuel",
      "damage_weapon",
      "wreckage",
    ],
  },
] as const;
