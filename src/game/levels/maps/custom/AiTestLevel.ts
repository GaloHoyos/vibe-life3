import { buildHouse, type HouseSpec } from "@game/levels/builders/HouseBuilder";
import { buildRamp } from "@game/levels/builders/RampBuilder";
import type {
  LevelDefinition,
  StaticBoxDefinition,
} from "@game/levels/LevelDefinition";

/**
 * Mapa de prueba para debugging de IA.
 *
 * Layout: cuadrado plano de 64Ã—64m centrado en (0,0), dividido en 4 zonas
 * que comparten el spawn del player. Cada zona prueba un aspecto distinto:
 *
 *  NW (combine zone) â”€â”€â”€â”€ NE (casa 2 pisos)
 *         â”‚                       â”‚
 *  SW (zombie corridors) â”€â”€ SE (obstacle gym)
 *
 *  - Combine zone: arena abierta con cover medio + plataforma elevada con rampa.
 *  - Casa 2 pisos: interior + balcÃ³n exterior + rampa al techo, para verificar
 *    que el navgraph genera nodos en pisos altos y los NPCs los pueden alcanzar.
 *  - Zombie corridors: pasillos en L con doorways para forzar pathing alrededor.
 *  - Obstacle gym: walls de alturas mixtas (half-wall 0.6, mid-wall 1.2, full),
 *    pilares y crates para que el cover system encuentre opciones heterogÃ©neas.
 *
 * Pocos NPCs (5 totales): 2 combines + 2 zombies + 1 combine en la casa.
 * La idea es ver cada caso aislado, no un firefight masivo.
 *
 * Step note: las rampas son stairsteps de 0.3m de alto. El NPC tiene
 * `stepOffset: 0.4` y el NavSpaceBuilder conecta celdas con step <= 1.0m,
 * asÃ­ que 0.3m queda holgado para ambos.
 */

const SLAB_THICKNESS = 0.4;
// Y de la superficie superior del piso principal. El slab `aitest-floor` estÃ¡
// centrado en Y=-SLAB_THICKNESS/2, asÃ­ que su cara superior cae en Y=0. Las
// rampas que arrancan desde el suelo deben usar este valor â€” si arrancan mÃ¡s
// alto, el primer escalÃ³n excede el `stepOffset` del player (0.45m) y no
// se puede subir sin saltar.
const FLOOR_TOP = 0;

/** Caja walkable plana (slab) con material `floor`. */
function slab(
  id: string,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sz: number,
  material: "floor" | "trim" | "roof" = "floor",
): StaticBoxDefinition {
  return { id, position: [cx, cy, cz], size: [sx, 0.4, sz], material };
}

/** Pared sÃ³lida. */
function wall(
  id: string,
  position: [number, number, number],
  size: [number, number, number],
  material: "wall" | "brick" = "wall",
): StaticBoxDefinition {
  return { id, position, size, material };
}

type Vec3Tuple = [number, number, number];

function cp(id: string, position: Vec3Tuple, normal: Vec3Tuple) {
  return { id, position, normal };
}

// â”€â”€ Suelo base â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FLOOR: StaticBoxDefinition[] = [
  {
    id: "aitest-floor",
    position: [0, -SLAB_THICKNESS / 2, 0],
    size: [64, SLAB_THICKNESS, 64],
    material: "floor",
  },
  // PerÃ­metro: paredes altas que delimitan el mapa.
  {
    id: "aitest-boundary-n",
    position: [0, 1.5, -32],
    size: [64, 3, 0.4],
    material: "wall",
  },
  {
    id: "aitest-boundary-s",
    position: [0, 1.5, 32],
    size: [64, 3, 0.4],
    material: "wall",
  },
  {
    id: "aitest-boundary-e",
    position: [32, 1.5, 0],
    size: [0.4, 3, 64],
    material: "wall",
  },
  {
    id: "aitest-boundary-w",
    position: [-32, 1.5, 0],
    size: [0.4, 3, 64],
    material: "wall",
  },
];

// â”€â”€ NW: Combine zone (-X, -Z) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const COMBINE_ZONE: StaticBoxDefinition[] = [
  // Cuatro coberturas medias (chest-high) dispersas.
  {
    id: "cz-cover-1",
    position: [-22, 0.7, -10],
    size: [3, 1.4, 0.6],
    material: "brick",
  },
  {
    id: "cz-cover-2",
    position: [-12, 0.7, -18],
    size: [0.6, 1.4, 3],
    material: "brick",
  },
  {
    id: "cz-cover-3",
    position: [-18, 0.7, -25],
    size: [3, 1.4, 0.6],
    material: "brick",
  },
  {
    id: "cz-cover-4",
    position: [-26, 0.7, -22],
    size: [0.6, 1.4, 3],
    material: "brick",
  },
  // Plataforma elevada con rampa subiendo hacia el sur.
  slab("cz-platform", -20, 2.0, -28, 8, 6, "trim"),
  ...buildRamp({
    id: "cz-ramp",
    start: [-20, -22],
    end: [-20, -25],
    startY: FLOOR_TOP,
    endY: 2.2,
    width: 4,
    steps: 12,
  }),
  // Cubierta arriba de la plataforma (cover detrÃ¡s del que un combine puede agacharse).
  {
    id: "cz-platform-cover",
    position: [-20, 3.0, -30],
    size: [6, 1.2, 0.5],
    material: "brick",
  },
];

const COMBINE_COVER_POINTS = [
  cp("cz-cp-1n", [-22, 0.6, -8.5], [0, 0, 1]),
  cp("cz-cp-2e", [-10.5, 0.6, -18], [1, 0, 0]),
  cp("cz-cp-3s", [-18, 0.6, -26.5], [0, 0, -1]),
  cp("cz-cp-4w", [-27.5, 0.6, -22], [-1, 0, 0]),
  cp("cz-cp-platform", [-20, 2.6, -29], [0, 0, -1]),
];

// â”€â”€ NE: Casa de 2 pisos (+X, -Z) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Centro de la casa en (18, ?, -18). Footprint 14Ã—14. Piso 1 en y=0.5, piso 2 en y=3.5.
const HOUSE_FLOOR_1_Y = 0.5;
const HOUSE_FLOOR_2_Y = 3.5;
const HOUSE_ROOF_Y = 6.5;

const HOUSE_SHELL_1: HouseSpec = {
  id: "house-1",
  center: [18, -18],
  floorY: HOUSE_FLOOR_1_Y,
  width: 14,
  depth: 14,
  height: 3,
  door: { side: "west", width: 1.6 },
  roof: false,
  wallMaterial: "brick",
};

const HOUSE_SHELL_2: HouseSpec = {
  id: "house-2",
  center: [18, -18],
  floorY: HOUSE_FLOOR_2_Y,
  width: 14,
  depth: 14,
  height: 3,
  // Ventanal en el sur: la "puerta" en realidad expone la fachada al sur para
  // que un combine adentro tenga LOS al jugador y el debugger pueda ver el setup.
  door: { side: "south", width: 3.2 },
  roof: false,
  wallMaterial: "brick",
};

const HOUSE_BUILDINGS = [buildHouse(HOUSE_SHELL_1), buildHouse(HOUSE_SHELL_2)];

const HOUSE: StaticBoxDefinition[] = [
  // Losa del piso 2 compuesta por 2 sub-slabs que dejan un hueco de ~13Ã—3.5m
  // en la mitad norte por donde sube la escalera interior. El hueco abarca
  // todo el ancho para garantizar headroom limpio sobre la escalera.
  slab("house-floor-2a", 18, HOUSE_FLOOR_2_Y - 0.2, -14.5, 13, 6, "floor"),
  slab("house-floor-2b", 18, HOUSE_FLOOR_2_Y - 0.2, -19.5, 13, 4, "floor"),
  // Techo plano accesible (sin paredes arriba, se sube por rampa exterior).
  slab("house-roof", 18, HOUSE_ROOF_Y - 0.2, -18, 14, 14, "roof"),
  // BalcÃ³n sobre el lado sur del piso 2 â€” losa que sale 2m al sur.
  slab("house-balcony", 18, HOUSE_FLOOR_2_Y - 0.2, -11, 6, 2.4, "floor"),
  // Antepecho del balcÃ³n, partido para dejar el acceso libre a la escalera.
  {
    id: "house-balcony-railing-l",
    position: [15.6, HOUSE_FLOOR_2_Y + 0.5, -9.8],
    size: [1.2, 1, 0.3],
    material: "brick",
  },
  {
    id: "house-balcony-railing-r",
    position: [20.4, HOUSE_FLOOR_2_Y + 0.5, -9.8],
    size: [1.2, 1, 0.3],
    material: "brick",
  },
  // Escalera interior: sube del piso 1 al piso 2 en la mitad norte del
  // interior. Corre por Z=-22.3 para que el escalÃ³n superior (sz=1.6) tenga
  // su borde sur exactamente en Z=-21.5, alineado con el borde norte de
  // `house-floor-2b`. 12 escalones sobre 3.5m â†’ ~0.29m de subida por
  // escalÃ³n (debajo del `stepOffset` 0.45 del player y 0.4 del NPC).
  ...buildRamp({
    id: "house-stair-interior",
    start: [22, -22.3],
    end: [14, -22.3],
    startY: FLOOR_TOP,
    endY: HOUSE_FLOOR_2_Y,
    width: 1.6,
    steps: 12,
  }),
  // Pasarela exterior al techo: sale del balcon hacia el este para que la
  // escalera no quede debajo de la losa ni pegada al muro sur.
  slab(
    "house-balcony-east-walkway",
    23.4,
    HOUSE_FLOOR_2_Y - 0.2,
    -10.8,
    5.2,
    2.4,
    "floor",
  ),
  slab(
    "house-roof-east-landing",
    24.7,
    HOUSE_ROOF_Y - 0.2,
    -18.8,
    2.6,
    4.8,
    "roof",
  ),
  // Escalera exterior al techo: corre por fuera del muro este y conecta la
  // pasarela del balcon con un landing a nivel del roof.
  ...buildRamp({
    id: "house-stair-roof",
    start: [26.2, -11.0],
    end: [26.2, -18.8],
    startY: HOUSE_FLOOR_2_Y,
    endY: HOUSE_ROOF_Y,
    width: 1.8,
    steps: 12,
  }),
  // Pilar en el techo (cover en altura para el combine del balcÃ³n si sube).
  {
    id: "house-roof-chimney",
    position: [18, HOUSE_ROOF_Y + 1, -16],
    size: [1.2, 2, 1.2],
    material: "brick",
  },
];

const HOUSE_COVER_POINTS = [
  cp("house-cp-balcony", [20.4, HOUSE_FLOOR_2_Y + 0.1, -10.3], [0, 0, -1]),
  cp("house-cp-roof-chimney-s", [18, HOUSE_ROOF_Y + 0.1, -14], [0, 0, -1]),
  cp("house-cp-interior-corner", [14.5, HOUSE_FLOOR_1_Y + 0.1, -14], [1, 0, 0]),
];

// â”€â”€ SW: Zombie corridors (-X, +Z) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Paredes en L y T que forman un mini-laberinto. Sin techo (queremos ver desde arriba en debug).
const ZOMBIE_ZONE: StaticBoxDefinition[] = [
  // Pared larga horizontal (corta el Ã¡rea en 2 corridors).
  wall("zz-wall-main", [-20, 1.25, 18], [16, 2.5, 0.4], "brick"),
  // Vertical norte (con apertura en el medio).
  wall("zz-wall-vn-l", [-12, 1.25, 12], [0.4, 2.5, 6], "brick"),
  wall("zz-wall-vn-r", [-12, 1.25, 22], [0.4, 2.5, 4], "brick"),
  // Vertical sur que crea un cuello de botella.
  wall("zz-wall-vs", [-24, 1.25, 22], [0.4, 2.5, 8], "brick"),
  // Recoveco con doorway: dos paredes en L.
  wall("zz-recess-h", [-22, 1.25, 26], [4, 2.5, 0.4], "brick"),
  wall("zz-recess-v", [-20, 1.25, 27], [0.4, 2.5, 2], "brick"),
  // Pilar central (test obstacle avoidance).
  {
    id: "zz-pillar",
    position: [-18, 1.25, 24],
    size: [1, 2.5, 1],
    material: "brick",
  },
];

// â”€â”€ SE: Obstacle gym (+X, +Z) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Paredes mixtas: half (0.6), mid (1.2), full (2.4), + pilares + crates.
const OBSTACLE_ZONE: StaticBoxDefinition[] = [
  // Half-walls (vault-able, head-vis): 0.6m alto, 3m largo.
  {
    id: "oz-half-1",
    position: [10, 0.3, 8],
    size: [3, 0.6, 0.4],
    material: "brick",
  },
  {
    id: "oz-half-2",
    position: [20, 0.3, 12],
    size: [0.4, 0.6, 3],
    material: "brick",
  },
  {
    id: "oz-half-3",
    position: [14, 0.3, 24],
    size: [4, 0.6, 0.4],
    material: "brick",
  },
  // Mid-walls (chest-high cover): 1.2m alto.
  {
    id: "oz-mid-1",
    position: [18, 0.6, 8],
    size: [3, 1.2, 0.4],
    material: "brick",
  },
  {
    id: "oz-mid-2",
    position: [24, 0.6, 18],
    size: [0.4, 1.2, 4],
    material: "brick",
  },
  {
    id: "oz-mid-3",
    position: [12, 0.6, 18],
    size: [3, 1.2, 0.4],
    material: "brick",
  },
  // Full walls (bloquean LOS completo): 2.4m alto, segmentos cortos.
  {
    id: "oz-full-1",
    position: [25, 1.2, 25],
    size: [4, 2.4, 0.4],
    material: "brick",
  },
  {
    id: "oz-full-2",
    position: [10, 1.2, 14],
    size: [0.4, 2.4, 4],
    material: "brick",
  },
  // Pilares (1m square).
  {
    id: "oz-pillar-1",
    position: [16, 1.25, 14],
    size: [1, 2.5, 1],
    material: "brick",
  },
  {
    id: "oz-pillar-2",
    position: [22, 1.25, 22],
    size: [1, 2.5, 1],
    material: "brick",
  },
];

const OBSTACLE_COVER_POINTS = [
  cp("oz-cp-mid-1", [18, 0.6, 9.2], [0, 0, 1]),
  cp("oz-cp-mid-2w", [23, 0.6, 18], [-1, 0, 0]),
  cp("oz-cp-full-1", [25, 0.6, 23.8], [0, 0, -1]),
  cp("oz-cp-pillar-1", [16, 0.6, 12.6], [0, 0, -1]),
];

export const AiTestLevel: LevelDefinition = {
  id: "ai-test",
  title: "Sandbox IA",
  description:
    "Mapa de debug. 4 zonas: combines con cover, casa de 2 pisos, corredores para zombies y gimnasio de obstÃ¡culos. Pocos NPCs.",
  background: 0x1a1f24,
  sun: {
    direction: [0.3, 1.0, 0.2],
    color: 0xfff4d8,
    intensity: 1.6,
  },
  playerStart: [0, 1.5, 0],
  audio: {
    ambiences: ["background.wind", "background.hl2.atmosphere.trainstation"],
    footstepSounds: [
      "footsteps.hl2.concrete1",
      "footsteps.hl2.concrete2",
      "footsteps.hl2.concrete3",
      "footsteps.hl2.concrete4",
    ],
  },
  staticBoxes: [
    ...FLOOR,
    ...COMBINE_ZONE,
    ...HOUSE,
    ...ZOMBIE_ZONE,
    ...OBSTACLE_ZONE,
  ],
  buildings: HOUSE_BUILDINGS,
  dynamicBoxes: [
    // Algunos crates como dynamic cover/props para gravity gun.
    {
      id: "aitest-crate-1",
      position: [-8, 1, -8],
      size: [0.9, 0.9, 0.9],
      mass: 1.4,
      material: "crate",
    },
    {
      id: "aitest-crate-2",
      position: [-9, 1, -9],
      size: [0.9, 0.9, 0.9],
      mass: 1.4,
      material: "crate",
    },
    {
      id: "aitest-crate-3",
      position: [8, 1, 8],
      size: [1.1, 1.1, 1.1],
      mass: 1.8,
      material: "crate",
    },
    {
      id: "aitest-barrel-1",
      position: [15, 1, 22],
      size: [0.7, 1.2, 0.7],
      mass: 1.0,
      material: "hazard",
    },
  ],
  doors: [],
  npcs: [
    // 2 combines en la zona combine â€” uno cerca, otro en plataforma alta.
    {
      id: "ai-combine-ground",
      position: [-20, 2, -12],
      characterId: "combine",
    },
    {
      id: "ai-combine-platform",
      position: [-20, 3.5, -28],
      characterId: "combine",
    },
    // 1 combine en el balcÃ³n de la casa (test cover elevado + escalera).
    {
      id: "ai-combine-balcony",
      position: [18, 4.5, -11],
      characterId: "combine",
    },
    // 2 zombies en los corredores.
    {
      id: "ai-zombie-corridor-1",
      position: [-18, 2, 14],
      characterId: "zombie",
    },
    {
      id: "ai-zombie-corridor-2",
      position: [-22, 2, 25],
      characterId: "zombie",
    },
  ],
  weaponPickups: [
    // Pickups en el centro, junto al spawn, para que arrancar sea rÃ¡pido.
    { id: "ai-pickup-crowbar", weaponId: "crowbar", position: [-2, 0.7, 2] },
    { id: "ai-pickup-pistol", weaponId: "pistol", position: [-1, 0.7, 2] },
    { id: "ai-pickup-smg", weaponId: "smg", position: [0, 0.7, 2] },
    { id: "ai-pickup-ar3", weaponId: "ar3", position: [1, 0.7, 2] },
    { id: "ai-pickup-shotgun", weaponId: "shotgun", position: [2, 0.7, 2] },
    { id: "ai-pickup-rpg", weaponId: "rpg", position: [3, 0.7, 2] },
    {
      id: "ai-pickup-gravity-gun",
      weaponId: "gravityGun",
      position: [4, 0.7, 2],
    },
    { id: "ai-pickup-grenade-1", weaponId: "grenade", position: [-2, 0.7, 3] },
    {
      id: "ai-pickup-grenade-2",
      weaponId: "grenade",
      position: [-1.5, 0.7, 3],
    },
    { id: "ai-pickup-grenade-3", weaponId: "grenade", position: [-1, 0.7, 3] },
  ],
  ammoPickups: [
    { id: "ai-ammo-pistol", ammoId: "pistol", position: [-1, 0.5, 0.8] },
    { id: "ai-ammo-smg", ammoId: "smg", position: [0, 0.5, 0.8] },
    { id: "ai-ammo-ar3", ammoId: "ar3", position: [1, 0.5, 0.8] },
    { id: "ai-ammo-shotgun", ammoId: "shotgun", position: [2, 0.5, 0.8] },
    { id: "ai-ammo-rpg", ammoId: "rpg", position: [3, 0.5, 0.8] },
    { id: "ai-ammo-grenade", ammoId: "grenade", position: [-2, 0.5, 0.8] },
  ],
  itemPickups: [
    { id: "ai-item-medkit", itemId: "medkit", position: [-3, 0.5, 2] },
    { id: "ai-item-battery", itemId: "hevBattery", position: [4, 0.5, 2] },
  ],
  chargers: [
    { id: "ai-charger-health", kind: "health", position: [0, 0.9, -2.0] },
    { id: "ai-charger-hev", kind: "armor", position: [3.5, 0.9, -3] },
  ],
  triggers: [],
};
