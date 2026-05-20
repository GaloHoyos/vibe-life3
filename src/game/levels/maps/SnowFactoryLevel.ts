import { buildHouse, type HouseSpec } from "@game/levels/builders/HouseBuilder";
import type {
  DynamicBoxDefinition,
  LevelDefinition,
  NPCDefinition,
  StaticBoxDefinition,
} from "@game/levels/LevelDefinition";
import type { MaterialKey } from "@engine/render/material/Materials";

type Vec3 = [number, number, number];

const FACTORY_FLOOR_Y = 0.5;
const MEZZANINE_Y = 4.35;

const OUTPOSTS: HouseSpec[] = [
  {
    id: "sfw-west-barracks",
    center: [-72, 38],
    floorY: 0.2,
    width: 14,
    depth: 9,
    height: 3.2,
    door: { side: "east", width: 1.6 },
  },
  {
    id: "sfw-east-depot",
    center: [76, -8],
    floorY: 0.7,
    width: 16,
    depth: 10,
    height: 3.6,
    removeWall: "west",
  },
  {
    id: "sfw-south-watch",
    center: [48, 58],
    floorY: 1.2,
    width: 8,
    depth: 8,
    height: 5.2,
    door: { side: "south", width: 1.3 },
  },
  {
    id: "sfw-north-shed",
    center: [-48, -76],
    floorY: -0.2,
    width: 12,
    depth: 7,
    height: 3,
    removeWall: "south",
  },
];

const staticBoxes: StaticBoxDefinition[] = [
  ...buildStartArea(),
  ...buildCheckpoint(),
  ...buildFactory(),
  ...buildExteriorStructures(),
  ...OUTPOSTS.flatMap(buildHouse),
];

const dynamicBoxes: DynamicBoxDefinition[] = [
  ...crateCluster("sfw-start-crate", [-7, 2.1, 73], 5),
  ...crateCluster("sfw-yard-west-crate", [-38, 2.1, 22], 9),
  ...crateCluster("sfw-yard-east-crate", [42, 2.1, -2], 10),
  ...crateCluster("sfw-factory-crate", [10, 2.1, -22], 12),
  ...crateCluster("sfw-mezz-crate", [-20, 5.4, -40], 5),
  ...barrelLine("sfw-barrel-south", [-20, 2.2, 35], 6, "x"),
  ...barrelLine("sfw-barrel-factory", [22, 2.2, -42], 7, "z"),
  ...barrelLine("sfw-barrel-depot", [70, 2.3, -2], 5, "x"),
];

const npcs: NPCDefinition[] = [
  ...npcLine("sfw-zombie-trench", "zombie", [-38, 2.4, 15], 5, "x", 4.2),
  ...npcLine("sfw-zombie-factory", "zombie", [12, 2.0, -28], 5, "z", 5.0),
  ...npcLine("sfw-zombie-north", "zombie", [-26, 2.0, -65], 4, "x", 4.0),
  ...npcLine("sfw-combine-checkpoint", "combine", [-14, 2.0, 46], 3, "x", 8.0),
  ...npcLine("sfw-combine-yard", "combine", [36, 2.0, -6], 4, "z", 8.0),
  ...npcLine("sfw-combine-mezz", "combine", [-20, 5.4, -30], 3, "z", 8.0),
  { id: "sfw-combine-overseer", position: [-18, 5.4, -58], characterId: "combine" },
];

export const SnowFactoryLevel: LevelDefinition = {
  id: "snow-factory",
  title: "Complejo Boreal",
  description:
    "Campo nevado enorme con fabrica, entrepiso, patios de combate, zombies, combine y botones de repeticion.",
  background: 0xb9c9d8,
  sun: {
    direction: [0.35, 1.0, 0.25],
    color: 0xe8eef6,
    intensity: 2.0,
  },
  playerStart: [0, 1.65, 88],
  audio: {
    ambiences: ["background.wind"],
    footstepSounds: [
      "footsteps.snow1",
      "footsteps.snow2",
      "footsteps.snow3",
      "footsteps.snow4",
    ],
  },
  terrain: {
    id: "snow-factory-terrain",
    position: [0, 0, 0],
    size: [260, 260],
    widthSamples: 129,
    depthSamples: 129,
    source: {
      kind: "noise",
      seed: 314,
      octaves: 5,
      frequency: 0.018,
      persistence: 0.52,
      lacunarity: 2.05,
      amplitude: 4.2,
      baseHeight: 0,
      flattenRegions: [
        { center: [0, 82], radius: 16, falloff: 10, height: 0.4 },
        { center: [0, 52], radius: 26, falloff: 10, height: 0.4 },
        { center: [0, 24], radius: 24, falloff: 10, height: 0.45 },
        { center: [0, 4], radius: 22, falloff: 8, height: FACTORY_FLOOR_Y },
        { center: [0, -35], radius: 52, falloff: 16, height: FACTORY_FLOOR_Y },
        { center: [-24, 31], radius: 18, falloff: 8, height: 0.55 },
        { center: [31, 12], radius: 18, falloff: 8, height: 0.65 },
        { center: [-42, 20], radius: 20, falloff: 8, height: 0.6 },
        { center: [42, -2], radius: 24, falloff: 10, height: 0.7 },
        { center: [-72, 38], radius: 18, falloff: 8, height: 0.2 },
        { center: [76, -8], radius: 18, falloff: 8, height: 0.7 },
        { center: [48, 58], radius: 12, falloff: 6, height: 1.2 },
        { center: [-48, -76], radius: 16, falloff: 8, height: -0.2 },
      ],
    },
    material: "snow",
  },
  staticBoxes,
  dynamicBoxes,
  doors: [
    {
      id: "sfw-factory-gate",
      position: [0, 2.75, 2.12],
      size: [15.2, 4.3, 0.45],
      openOffset: [0, 5.0, 0],
      speed: 3.2,
      material: "door",
      button: {
        id: "sfw-factory-gate-button",
        label: "Alternar porton",
        position: [-6.2, 1.45, 5.3],
        size: [0.45, 0.45, 0.14],
      },
    },
  ],
  actionButtons: [
    {
      id: "sfw-respawn-button",
      label: "Respawnear entidades",
      action: "respawnEncounters",
      position: [-1.1, 1.65, 79],
      size: [0.5, 0.5, 0.16],
    },
    {
      id: "sfw-arsenal-button",
      label: "Desplegar arsenal",
      action: "spawnAllWeapons",
      position: [1.1, 1.65, 79],
      size: [0.5, 0.5, 0.16],
    },
  ],
  npcs,
  coverPoints: [
    { id: "sfw-cover-entry-1", position: [-12, 1.3, 48], normal: [0, 0, 1] },
    { id: "sfw-cover-entry-2", position: [12, 1.3, 48], normal: [0, 0, 1] },
    { id: "sfw-cover-yard-w-1", position: [-38, 1.5, 20], normal: [1, 0, 0] },
    { id: "sfw-cover-yard-w-2", position: [-28, 1.5, 24], normal: [0, 0, -1] },
    { id: "sfw-cover-yard-e-1", position: [36, 1.5, -6], normal: [-1, 0, 0] },
    { id: "sfw-cover-yard-e-2", position: [48, 1.5, -12], normal: [0, 0, 1] },
    { id: "sfw-cover-factory-s", position: [-10, 1.5, 0], normal: [0, 0, -1] },
    { id: "sfw-cover-factory-e", position: [24, 1.5, -34], normal: [-1, 0, 0] },
    { id: "sfw-cover-factory-n", position: [8, 1.5, -62], normal: [0, 0, 1] },
    { id: "sfw-cover-mezz-1", position: [-11, 5.1, -22], normal: [1, 0, 0] },
    { id: "sfw-cover-mezz-2", position: [-11, 5.1, -44], normal: [1, 0, 0] },
    { id: "sfw-cover-mezz-3", position: [-11, 5.1, -60], normal: [1, 0, 0] },
    { id: "sfw-cover-crosswalk-1", position: [-2, 5.1, -32], normal: [0, 0, -1] },
    { id: "sfw-cover-crosswalk-2", position: [8, 5.1, -36], normal: [0, 0, 1] },
    { id: "sfw-cover-loading", position: [18, 2.0, -8], normal: [-1, 0, 0] },
    { id: "sfw-cover-barracks", position: [-64, 1.1, 38], normal: [-1, 0, 0] },
    { id: "sfw-cover-depot", position: [68, 1.5, -8], normal: [1, 0, 0] },
  ],
  weaponPickups: [
    { id: "sfw-pickup-crowbar", weaponId: "crowbar", position: [-5, 1.2, 84] },
    { id: "sfw-pickup-pistol", weaponId: "pistol", position: [-3, 1.2, 84] },
    { id: "sfw-pickup-smg", weaponId: "smg", position: [-1, 1.2, 84] },
    { id: "sfw-pickup-gravity-gun", weaponId: "gravityGun", position: [1, 1.2, 84] },
    { id: "sfw-pickup-shotgun", weaponId: "shotgun", position: [3, 1.2, 84] },
    { id: "sfw-pickup-grenade-1", weaponId: "grenade", position: [5, 1.2, 84] },
    { id: "sfw-pickup-grenade-2", weaponId: "grenade", position: [6, 1.2, 84] },
    { id: "sfw-pickup-ar3", weaponId: "ar3", position: [-18, 5.2, -52] },
  ],
  triggers: [
    {
      id: "sfw-intro",
      position: [0, 2, 74],
      size: [10, 4, 6],
      once: true,
      dialogue: {
        speaker: "Radio",
        text: "Complejo Boreal activo. Usa los botones de consola para repetir encuentros o desplegar armas.",
        duration: 5,
      },
    },
    {
      id: "sfw-factory-entry",
      position: [0, 2.4, 1],
      size: [18, 4.8, 5],
      once: true,
      dialogue: {
        speaker: "Radio",
        text: "Entrada principal comprometida. Los combine controlan el entrepiso.",
        duration: 4,
      },
    },
  ],
};

function b(
  id: string,
  position: Vec3,
  size: Vec3,
  material: MaterialKey,
): StaticBoxDefinition {
  return { id, position, size, material };
}

function buildStartArea(): StaticBoxDefinition[] {
  return [
    b("sfw-start-pad", [0, 0.35, 82], [28, 0.5, 18], "floor"),
    b("sfw-start-wall-l", [-14, 1.5, 82], [0.5, 2.4, 18], "wall"),
    b("sfw-start-wall-r", [14, 1.5, 82], [0.5, 2.4, 18], "wall"),
    b("sfw-start-console", [0, 1.05, 79.4], [4.2, 1.1, 0.8], "trim"),
    b("sfw-start-console-top", [0, 1.85, 79.15], [4.6, 0.25, 0.35], "button"),
    b("sfw-start-lightbar", [0, 2.55, 78.8], [5.2, 0.18, 0.18], "hazard"),
  ];
}

function buildCheckpoint(): StaticBoxDefinition[] {
  return [
    b("sfw-check-road", [0, 0.45, 52], [42, 0.35, 18], "floor"),
    b("sfw-check-wall-l", [-21, 1.45, 52], [0.7, 2.0, 18], "wall"),
    b("sfw-check-wall-r", [21, 1.45, 52], [0.7, 2.0, 18], "wall"),
    b("sfw-check-barricade-a", [-10, 1.0, 45], [8, 1.2, 0.5], "hazard"),
    b("sfw-check-barricade-b", [10, 1.0, 45], [8, 1.2, 0.5], "hazard"),
    b("sfw-check-tower-floor", [0, 4.1, 41], [8, 0.35, 8], "trim"),
    b("sfw-check-tower-post-a", [-3.7, 2.2, 37.3], [0.35, 4.0, 0.35], "wall"),
    b("sfw-check-tower-post-b", [3.7, 2.2, 37.3], [0.35, 4.0, 0.35], "wall"),
    b("sfw-check-tower-post-c", [-3.7, 2.2, 44.7], [0.35, 4.0, 0.35], "wall"),
    b("sfw-check-tower-post-d", [3.7, 2.2, 44.7], [0.35, 4.0, 0.35], "wall"),
    b("sfw-check-tower-roof", [0, 6.4, 41], [9, 0.4, 9], "roof"),
  ];
}

function buildFactory(): StaticBoxDefinition[] {
  return [
    b("sfw-factory-floor", [0, 0.35, -35], [56, 0.45, 74], "floor"),
    b("sfw-factory-wall-west", [-28, 4.6, -35], [0.6, 8.2, 74], "brick"),
    b("sfw-factory-wall-east", [28, 4.6, -35], [0.6, 8.2, 74], "brick"),
    b("sfw-factory-wall-north", [0, 4.6, -72], [56, 8.2, 0.6], "brick"),
    b("sfw-factory-wall-south-l", [-18, 4.6, 2], [20, 8.2, 0.6], "brick"),
    b("sfw-factory-wall-south-r", [18, 4.6, 2], [20, 8.2, 0.6], "brick"),
    b("sfw-factory-door-header", [0, 7.2, 2], [16, 3.0, 0.6], "brick"),
    b("sfw-factory-roof-north", [0, 9.05, -58], [58, 0.45, 28], "roof"),
    b("sfw-factory-roof-west", [-17, 9.05, -24], [22, 0.45, 40], "roof"),
    b("sfw-factory-crane-rail-a", [-4, 7.2, -35], [0.3, 0.3, 62], "trim"),
    b("sfw-factory-crane-rail-b", [4, 7.2, -35], [0.3, 0.3, 62], "trim"),
    b("sfw-factory-crane-bridge", [0, 6.8, -46], [11, 0.35, 0.5], "hazard"),
    b("sfw-mezz-platform", [-18, MEZZANINE_Y, -36], [14, 0.35, 54], "trim"),
    b("sfw-mezz-crosswalk", [0, MEZZANINE_Y, -34], [22, 0.35, 3.6], "trim"),
    b("sfw-mezz-cross-rail-s", [0, 5.15, -31.9], [22, 1.1, 0.25], "hazard"),
    b("sfw-mezz-cross-rail-n", [0, 5.15, -36.1], [22, 1.1, 0.25], "hazard"),
    b("sfw-east-mezz-platform", [15, MEZZANINE_Y, -34], [12, 0.35, 16], "trim"),
    b("sfw-east-mezz-rail-e", [21, 5.15, -34], [0.25, 1.1, 16], "hazard"),
    b("sfw-east-mezz-rail-n", [15, 5.15, -42], [12, 1.1, 0.25], "hazard"),
    b("sfw-mezz-office-floor", [-17, MEZZANINE_Y, -62], [16, 0.35, 12], "floor"),
    b("sfw-mezz-office-wall", [-9, 5.9, -62], [0.35, 3.0, 12], "wall"),
    b("sfw-mezz-office-back", [-17, 5.9, -68], [16, 3.0, 0.35], "wall"),
    b("sfw-mezz-rail-long", [-10.8, 5.15, -35], [0.25, 1.25, 46], "hazard"),
    b("sfw-mezz-rail-south", [-18, 5.15, -9], [14, 1.25, 0.25], "hazard"),
    b("sfw-mezz-rail-north", [-18, 5.15, -63], [14, 1.25, 0.25], "hazard"),
    b("sfw-factory-pit-wall-a", [13, 1.1, -18], [12, 1.2, 0.4], "hazard"),
    b("sfw-factory-pit-wall-b", [19, 1.1, -30], [0.4, 1.2, 24], "hazard"),
    b("sfw-factory-machine-a", [10, 1.5, -50], [8, 2.4, 4], "trim"),
    b("sfw-factory-machine-b", [19, 1.5, -54], [5, 2.4, 9], "trim"),
    b("sfw-factory-machine-c", [4, 1.3, -18], [5, 2.0, 8], "trim"),
    b("sfw-factory-loading-dock", [20, 0.95, -7], [14, 1.1, 7], "trim"),
    b("sfw-factory-gate-console", [-6.2, 1.05, 5.35], [0.8, 1.1, 0.35], "trim"),
    b("sfw-factory-conveyor-a", [-2, 1.1, -26], [1.2, 1.0, 30], "dynamic"),
    b("sfw-factory-conveyor-b", [2, 1.1, -42], [1.2, 1.0, 24], "dynamic"),
    ...buildStairs("sfw-mezz-stair", [-11.6, FACTORY_FLOOR_Y, -3], 18, 4.2, 0.21, 0.58, -1),
    ...smokestacks(),
  ];
}

function buildExteriorStructures(): StaticBoxDefinition[] {
  return [
    b("sfw-road-start-check", [0, 0.46, 67], [18, 0.32, 14], "floor"),
    b("sfw-road-check-factory", [0, 0.46, 23], [20, 0.32, 42], "floor"),
    b("sfw-road-west-branch", [-24, 0.55, 31], [34, 0.3, 6], "floor"),
    b("sfw-road-east-branch", [31, 0.62, 12], [34, 0.3, 6], "floor"),
    b("sfw-west-yard-wall-a", [-46, 1.2, 15], [20, 1.4, 0.45], "wall"),
    b("sfw-west-yard-wall-b", [-34, 1.2, 26], [0.45, 1.4, 18], "wall"),
    b("sfw-east-yard-wall-a", [46, 1.3, -18], [22, 1.5, 0.45], "wall"),
    b("sfw-east-yard-wall-b", [58, 1.3, -6], [0.45, 1.5, 20], "wall"),
    b("sfw-entry-floodlight-a", [-9, 4.2, 63], [0.35, 6.5, 0.35], "trim"),
    b("sfw-entry-floodlight-b", [9, 4.2, 63], [0.35, 6.5, 0.35], "trim"),
    b("sfw-entry-floodlight-bar", [0, 7.4, 63], [19, 0.25, 0.25], "hazard"),
    b("sfw-pipe-a", [-16, 1.7, 8], [0.8, 0.8, 40], "trim"),
    b("sfw-pipe-b", [-20, 2.4, 8], [0.6, 0.6, 40], "trim"),
    b("sfw-tank-a", [36, 2.8, -46], [7, 4.8, 7], "trim"),
    b("sfw-tank-b", [46, 2.8, -44], [7, 4.8, 7], "trim"),
    b("sfw-tank-bridge", [41, 5.5, -45], [12, 0.35, 2.2], "hazard"),
    b("sfw-snow-berm-west", [-62, 1.2, -22], [3.5, 2.0, 58], "rock"),
    b("sfw-snow-berm-east", [64, 1.2, 12], [3.5, 2.0, 58], "rock"),
    b("sfw-snow-berm-north", [0, 1.1, -92], [56, 1.8, 3.5], "rock"),
    b("sfw-north-ramp", [-8, 0.7, -84], [26, 0.6, 10], "rock"),
    b("sfw-radio-mast", [48, 8, 58], [0.7, 13, 0.7], "trim"),
    b("sfw-radio-cross-a", [48, 12, 58], [8, 0.35, 0.35], "trim"),
    b("sfw-radio-cross-b", [48, 9, 58], [0.35, 0.35, 8], "trim"),
  ];
}

function buildStairs(
  id: string,
  base: Vec3,
  steps: number,
  width: number,
  stepHeight: number,
  stepDepth: number,
  zDirection: 1 | -1,
): StaticBoxDefinition[] {
  const out: StaticBoxDefinition[] = [];
  for (let i = 0; i < steps; i += 1) {
    out.push(
      b(
        `${id}-${i}`,
        [
          base[0],
          base[1] + stepHeight * (i + 0.5),
          base[2] + zDirection * stepDepth * (i + 0.5),
        ],
        [width, stepHeight, stepDepth],
        "trim",
      ),
    );
  }
  return out;
}

function smokestacks(): StaticBoxDefinition[] {
  return [
    b("sfw-stack-a", [-20, 13, -78], [3, 24, 3], "brick"),
    b("sfw-stack-b", [-14, 15, -78], [3, 28, 3], "brick"),
    b("sfw-stack-c", [16, 13, -78], [3, 24, 3], "brick"),
    b("sfw-stack-d", [22, 15, -78], [3, 28, 3], "brick"),
    b("sfw-stack-cap-a", [-20, 25.4, -78], [4.2, 0.6, 4.2], "trim"),
    b("sfw-stack-cap-b", [-14, 29.4, -78], [4.2, 0.6, 4.2], "trim"),
    b("sfw-stack-cap-c", [16, 25.4, -78], [4.2, 0.6, 4.2], "trim"),
    b("sfw-stack-cap-d", [22, 29.4, -78], [4.2, 0.6, 4.2], "trim"),
  ];
}

function crateCluster(id: string, start: Vec3, count: number): DynamicBoxDefinition[] {
  const out: DynamicBoxDefinition[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 4);
    const column = i % 4;
    const tall = i % 5 === 0;
    out.push({
      id: `${id}-${i}`,
      position: [start[0] + column * 1.35, start[1] + row * 0.1, start[2] + row * 1.25],
      size: tall ? [1.1, 1.4, 1.1] : [1, 1, 1],
      mass: tall ? 2.2 : 1.4,
      material: i % 3 === 0 ? "dynamic" : "crate",
    });
  }
  return out;
}

function barrelLine(
  id: string,
  start: Vec3,
  count: number,
  axis: "x" | "z",
): DynamicBoxDefinition[] {
  const out: DynamicBoxDefinition[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      id: `${id}-${i}`,
      position:
        axis === "x"
          ? [start[0] + i * 1.15, start[1], start[2]]
          : [start[0], start[1], start[2] + i * 1.15],
      size: [0.85, 1.25, 0.85],
      mass: 1.6,
      material: "hazard",
    });
  }
  return out;
}

function npcLine(
  id: string,
  characterId: NPCDefinition["characterId"],
  start: Vec3,
  count: number,
  axis: "x" | "z",
  spacing: number,
): NPCDefinition[] {
  const out: NPCDefinition[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      id: `${id}-${i}`,
      position:
        axis === "x"
          ? [start[0] + i * spacing, start[1], start[2]]
          : [start[0], start[1], start[2] + i * spacing],
      characterId,
    });
  }
  return out;
}
