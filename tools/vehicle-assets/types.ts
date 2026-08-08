export type VehicleAssetId =
  | "buggy"
  | "airboat"
  | "helicopter"
  | "rebelCrawler"
  | "combineGlider"
  | "combineSwimmer";

import type { AtlasFinish, LodStats } from "../shared/gltf/types.js";

// El vocabulario genérico de atlas y geometría vive en el kit compartido; acá
// sólo queda lo que es propio del parque vehicular.
export type {
  AtlasFinish,
  AtlasTile,
  Euler,
  GeneratedTextureSet,
  LodStats,
  Vec3,
} from "../shared/gltf/types.js";

export interface VehicleAssetSpec {
  readonly id: VehicleAssetId;
  readonly displayName: string;
  readonly seed: number;
  readonly maxTrianglesLod0: number;
  readonly maxDrawsPerLod: number;
  readonly maxGlbBytes: number;
  readonly finishes: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish];
  /**
   * Color al que degrada el chorreado vertical. Por defecto es la mugre terrosa
   * del resto del parque; un vehículo polar la necesita fría, porque una veta
   * marrón sobre chapa celeste lee a barro y le saca todo el frío al casco.
   */
  readonly grimeColor?: readonly [number, number, number];
  readonly requiredNodes: readonly string[];
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
    // 0 chapa pintada, 1 acero oxidado, 2 metal mecanizado, 3 goma y tapizado.
    finishes: [
      { color: [201, 190, 160], roughness: 0.68, metallic: 0.05, wear: 0.58, grain: 1 },
      { color: [139, 62, 39], roughness: 0.82, metallic: 0.22, wear: 0.86, grain: 1.25 },
      { color: [88, 91, 89], roughness: 0.52, metallic: 0.82, wear: 0.45, grain: 1.6 },
      { color: [33, 34, 35], roughness: 0.94, metallic: 0.02, wear: 0.24, grain: 2.6 },
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
    displayName: "Hidrodeslizador ártico de rescate",
    seed: 0x27182818,
    maxTrianglesLod0: 80_000,
    maxDrawsPerLod: 18,
    maxGlbBytes: 8 * 1024 * 1024,
    // 0 casco pintado en gris hielo, 1 naranja de rescate ya oxidado, 2 acero
    // frío mecanizado, 3 goma, lona y tapizado.
    finishes: [
      { color: [183, 197, 205], roughness: 0.72, metallic: 0.05, wear: 0.56, grain: 1 },
      { color: [193, 88, 32], roughness: 0.8, metallic: 0.18, wear: 0.82, grain: 1.2 },
      { color: [98, 107, 114], roughness: 0.5, metallic: 0.84, wear: 0.44, grain: 1.55 },
      { color: [36, 39, 43], roughness: 0.93, metallic: 0.03, wear: 0.22, grain: 2.5 },
    ],
    grimeColor: [88, 100, 110],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "fan_main",
      "rudder_left",
      "rudder_right",
      "turret_yaw",
      "turret_pitch",
      "seat_driver",
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
    // 0 chapa azul pizarra del fuselaje, 1 gris claro de panza y empenaje,
    // 2 acero de tren, cubo de rotor y herrajes, 3 goma, marcos e interior.
    finishes: [
      { color: [70, 80, 95], roughness: 0.72, metallic: 0.1, wear: 0.3, grain: 1 },
      { color: [136, 142, 147], roughness: 0.7, metallic: 0.06, wear: 0.52, grain: 1 },
      { color: [118, 124, 130], roughness: 0.5, metallic: 0.82, wear: 0.4, grain: 1.5 },
      { color: [36, 38, 42], roughness: 0.9, metallic: 0.04, wear: 0.26, grain: 2.4 },
    ],
    // Chorreado frío: el marrón terroso por defecto pelea contra la chapa azul.
    grimeColor: [78, 86, 96],
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
  {
    id: "rebelCrawler",
    displayName: "Transporte oruga rebelde",
    seed: 0x5f3759df,
    maxTrianglesLod0: 90_000,
    maxDrawsPerLod: 18,
    maxGlbBytes: 9 * 1024 * 1024,
    // 0 chapa azul de la Resistencia, 1 reparaciones oxidadas, 2 mecánica y
    // herrajes, 3 orugas, lona y tapizado.
    finishes: [
      { color: [74, 91, 104], roughness: 0.76, metallic: 0.12, wear: 0.52, grain: 1 },
      { color: [137, 65, 43], roughness: 0.86, metallic: 0.2, wear: 0.84, grain: 1.25 },
      { color: [102, 108, 109], roughness: 0.5, metallic: 0.84, wear: 0.46, grain: 1.55 },
      { color: [35, 37, 38], roughness: 0.95, metallic: 0.03, wear: 0.28, grain: 2.7 },
    ],
    grimeColor: [83, 91, 96],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "wheel_front_left",
      "wheel_front_right",
      "wheel_rear_left",
      "wheel_rear_right",
      "seat_driver",
      "seat_passenger",
      "camera_driver",
      "camera_passenger",
      "exit_left",
      "exit_right",
      "audio_engine",
      "audio_transmission",
      "damage_engine",
      "damage_steering",
      "damage_fuel",
      "wreckage",
    ],
  },
  {
    id: "combineGlider",
    displayName: "Deslizador Combine de reconocimiento",
    seed: 0x6a09e667,
    maxTrianglesLod0: 85_000,
    maxDrawsPerLod: 18,
    maxGlbBytes: 9 * 1024 * 1024,
    // 0 blindaje azul petróleo, 1 cerámica Combine clara, 2 mecanismos
    // mecanizados, 3 interior, juntas y superficies antideslizantes.
    finishes: [
      { color: [45, 62, 72], roughness: 0.54, metallic: 0.36, wear: 0.28, grain: 1 },
      { color: [164, 174, 173], roughness: 0.62, metallic: 0.12, wear: 0.38, grain: 1.1 },
      { color: [76, 84, 89], roughness: 0.38, metallic: 0.9, wear: 0.3, grain: 1.45 },
      { color: [24, 28, 31], roughness: 0.88, metallic: 0.08, wear: 0.2, grain: 2.4 },
    ],
    grimeColor: [55, 68, 74],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "fan_main",
      "rudder_left",
      "rudder_right",
      "stabilizer_front",
      "stabilizer_rear_left",
      "stabilizer_rear_right",
      "seat_driver",
      "camera_driver",
      "exit_left",
      "exit_right",
      "audio_engine",
      "audio_hover",
      "damage_engine",
      "damage_hull",
      "damage_steering",
      "damage_fuel",
      "wreckage",
    ],
  },
  {
    id: "combineSwimmer",
    displayName: "Nadador Combine de transporte",
    seed: 0xbb67ae85,
    maxTrianglesLod0: 85_000,
    /**
     * Más alto que el resto del parque porque acá cada apéndice que se mueve
     * por su cuenta es una malla aparte: remos, antenas, cola y mandíbula no
     * pueden ir horneados en la piel si tienen que animarse. Es el precio de
     * que sea una criatura y no un casco.
     */
    maxDrawsPerLod: 26,
    maxGlbBytes: 9 * 1024 * 1024,
    // Criatura reconvertida al gusto de los Consejeros: carne pálida a la vista,
    // suturada contra el implante. 0 piel dorsal húmeda, 1 carne expuesta,
    // 2 placas, collares y tubos Combine, 3 correas y membranas verde oliva
    // —el mismo verde del traje de los Consejeros—.
    finishes: [
      { color: [74, 82, 78], roughness: 0.38, metallic: 0.03, wear: 0.32, grain: 1.5 },
      { color: [198, 189, 176], roughness: 0.56, metallic: 0.02, wear: 0.2, grain: 1.25 },
      { color: [64, 68, 72], roughness: 0.34, metallic: 0.92, wear: 0.42, grain: 1.5 },
      { color: [46, 50, 38], roughness: 0.88, metallic: 0.04, wear: 0.3, grain: 2.4 },
    ],
    grimeColor: [44, 52, 50],
    requiredNodes: [
      "visual_lod0",
      "visual_lod1",
      "visual_lod2",
      "fan_main",
      "rudder_left",
      "rudder_right",
      "stabilizer_front",
      "stabilizer_rear_left",
      "stabilizer_rear_right",
      "swimmer_head",
      "swimmer_jaw",
      "swimmer_gills",
      "swimmer_antenna_left",
      "swimmer_antenna_left_tip",
      "swimmer_antenna_right",
      "swimmer_antenna_right_tip",
      "swimmer_oar_left_0",
      "swimmer_oar_left_1",
      "swimmer_oar_left_2",
      "swimmer_oar_right_0",
      "swimmer_oar_right_1",
      "swimmer_oar_right_2",
      "swimmer_tail_0",
      "swimmer_tail_1",
      "seat_driver",
      "camera_driver",
      "exit_left",
      "exit_right",
      "audio_engine",
      "audio_hover",
      "damage_engine",
      "damage_hull",
      "damage_steering",
      "damage_fuel",
      "wreckage",
    ],
  },
] as const;
