import type {
  LevelDefinition,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import type { MaterialKey } from '@engine/render/material/Materials';
import { createMap } from '@game/levels/builders/MapCreator';
import { coverWall, crateStack, pillar } from '@game/levels/builders/PropBuilder';

/**
 * Banco de pruebas del sistema de audio: cada estación aísla **una** variable
 * para que la diferencia se pueda escuchar caminando de una a otra.
 *
 * Abrí el menú de debug (pestaña Audio) mientras recorrés: muestra el volumen
 * estimado por la sonda, la absorción, la apertura y en qué parámetros de
 * reverb se traduce todo eso.
 *
 * Layout (spawn mirando al norte, -Z):
 *
 *                       [5] TUNEL METAL  (0,-95)
 *                              │
 *                    [4] NAVE GRANDE  (0,-58)
 *                              │
 *   [3] CAMARA          [2] CAMARA          [6] MURO DE
 *   ABSORBENTE          HORMIGON            OCLUSION
 *    (-34,-18)           (-14,-18)           (26,-18)
 *                              │
 *          ══════ [1] EXPLANADA / SPAWN (0,14) ══════
 *                              │
 *   [7] SALA CON        [8] PISTA DE        [9] BANCO DE
 *      PUERTA            SUPERFICIES           ARMAS
 *    (-30,20)            (0,34)               (30,20)
 *
 * Qué probar en cada una:
 *
 *  1. EXPLANADA — referencia seca. La reverb casi no existe: la energía se va
 *     al cielo en vez de rebotar. Disparar acá es la línea base.
 *  2. CAMARA HORMIGON — 10×10×3.5 sellada, todo reflectante. Cola corta y
 *     brillante. Disparar adentro y comparar con (1).
 *  3. CAMARA ABSORBENTE — misma geometría exacta que (2), materiales blandos
 *     (pasto/nieve/arena). Aísla la absorción: mismo tamaño, cola muy distinta.
 *  4. NAVE GRANDE — 30×30×12. Aísla el tamaño: mismo hormigón que (2), cola
 *     larga. Los dos combine de adentro dan vocalizaciones y disparos con eco.
 *  5. TUNEL METAL — largo, angosto y metálico: el caso extremo de eco.
 *  6. MURO DE OCLUSION — un generador detrás de un muro grueso con un vano de
 *     2.4 m. Frente al macizo se escucha tapado (oclusión: filtra directo y
 *     reverb); corrido al costado del vano llega rodeando y solo se apaga el
 *     directo (obstrucción); en el vano, limpio. El combine de atrás sirve para
 *     escuchar lo mismo con un disparo y no solo con un loop.
 *  7. SALA CON PUERTA — otro generador adentro, con puerta. Cerrada acopla
 *     apenas; abierta entra la reverb de la sala. El botón está afuera.
 *  8. PISTA DE SUPERFICIES — un parche de cada material en fila. Los pools de
 *     pasos tenían 21 dB de diferencia entre sí; acá se camina de punta a
 *     punta para verificar que ya no saltan.
 *  9. BANCO DE ARMAS — todas las armas juntas para comparar el nivel de
 *     disparo, recarga y explosión entre sí en la misma acústica.
 *
 * Además, pisando la placa al este del spawn arranca una baliza apagada: sirve
 * para oír cómo entra una fuente que ya está ubicada en el espacio.
 *
 * Lo que mide la sonda en cada estación, corriéndola contra esta geometría:
 *
 *   estacion       vol(m3)  larg   abs  abrt |  cola    wet   tono  eco
 *   explanada       266240   80    0.69  0.64 |  1.22  0.083  5866  233ms
 *   hormigon           337   12    0.12  0.00 |  1.13  0.186  8864   34ms
 *   absorbente         337   12    0.48  0.00 |  1.13  0.139  6975   34ms
 *   nave             11279   33    0.12  0.00 |  2.26  0.322  8864   97ms
 *   tunel              359   39    0.06  0.00 |  1.15  0.197  9209  114ms
 *
 * Las dos cámaras miden idéntico y suenan distinto (material); la nave tiene el
 * mismo material que las cámaras y suena distinta (tamaño); el túnel mide un
 * volumen de cámara pero repica 3× más lento (lo que lo hace túnel es el largo).
 *
 * `tests/contracts/game/levels/AudioTestLevel.contract.test.ts` verifica que
 * esos contrastes sigan existiendo: si alguien mueve una pared o cambia un
 * material, el mapa deja de demostrar lo que dice y el test falla.
 */

const GROUND_Y = 0;
/** Grosor de los parches de la pista de superficies: apenas sobre el suelo. */
const PATCH_T = 0.12;
const PATCH_SIZE = 7;

/**
 * Un parche de material caminable. La superficie física (y con ella el pool de
 * pasos) sale del material visual vía `materialToSurface`.
 */
function surfacePatch(
  id: string,
  x: number,
  z: number,
  material: MaterialKey,
): StaticBoxDefinition {
  return {
    id,
    position: [x, GROUND_Y + PATCH_T / 2, z],
    size: [PATCH_SIZE, PATCH_T, PATCH_SIZE],
    material,
  };
}

/** Caja hueca de paredes rectas: control exacto de las tres dimensiones. */
function corridor(
  id: string,
  center: [number, number],
  length: number,
  width: number,
  height: number,
  material: MaterialKey,
): StaticBoxDefinition[] {
  const [cx, cz] = center;
  const t = 0.5;
  return [
    // Piso a ras: una losa de medio metro sería un escalón en la entrada.
    {
      id: `${id}-floor`,
      position: [cx, GROUND_Y + PATCH_T / 2, cz],
      size: [width + t * 2, PATCH_T, length],
      material,
    },
    {
      id: `${id}-roof`,
      position: [cx, GROUND_Y + height + t / 2, cz],
      size: [width + t * 2, t, length],
      material,
    },
    {
      id: `${id}-wall-w`,
      position: [cx - width / 2 - t / 2, GROUND_Y + height / 2, cz],
      size: [t, height, length],
      material,
    },
    {
      id: `${id}-wall-e`,
      position: [cx + width / 2 + t / 2, GROUND_Y + height / 2, cz],
      size: [t, height, length],
      material,
    },
    // Tapa el extremo norte: un túnel abierto de los dos lados deja escapar la
    // energía por los ejes largos y deja de leerse como túnel.
    {
      id: `${id}-cap-n`,
      position: [cx, GROUND_Y + height / 2, cz - length / 2 - t / 2],
      size: [width + t * 2, height, t],
      material,
    },
  ];
}

/**
 * Pantalla frente a una puerta. Sin esto el rayo de la sonda sale derecho por
 * el vano y reporta 40 m en ese eje: una cámara de 350 m³ se mide como 1300 y
 * suena mucho más grande de lo que es. Además es lo que haría un diseñador de
 * verdad para separar acústicamente dos espacios.
 */
function doorBaffle(
  id: string,
  x: number,
  z: number,
  width: number,
  height: number,
): StaticBoxDefinition {
  return {
    id,
    position: [x, GROUND_Y + height / 2, z],
    size: [width, height, 0.6],
    material: 'concrete',
  };
}

/**
 * Muro con un vano de 2.4 m justo enfrente de la fuente. Da los tres casos de
 * un tirón: parado frente al macizo (oclusión), corrido al costado del vano
 * (obstrucción: llega rodeando), y en el vano mismo (limpio).
 */
const OCCLUSION_WALL: StaticBoxDefinition[] = [
  {
    id: 'occl-wall-w',
    position: [19.9, GROUND_Y + 2.5, -18],
    size: [5.8, 5, 1.2],
    material: 'concrete',
  },
  {
    id: 'occl-wall-e',
    position: [28.1, GROUND_Y + 2.5, -18],
    size: [5.8, 5, 1.2],
    material: 'concrete',
  },
  // Retorno al este: obliga a rodear por el oeste o cruzar el vano.
  {
    id: 'occl-wall-return',
    position: [31.4, GROUND_Y + 2.5, -22.5],
    size: [1.2, 5, 10],
    material: 'concrete',
  },
];

const map = createMap({
  id: 'audio-test',
  title: 'Banco de Audio',
  description:
    'Estaciones para escuchar el sistema de audio: exterior seco, cámaras de igual tamaño con materiales opuestos, nave grande, túnel metálico, muro de oclusión, puerta que acopla la reverb, pista de superficies para los pasos y banco de armas.',
  background: 0x10151c,
  sun: {
    direction: [0.35, 1.0, 0.25],
    color: 0xffeccf,
    intensity: 1.4,
  },
  playerStart: [0, 1.5, 14],
  objective: {
    text: 'Recorré las estaciones. Menú de debug → Audio para ver la sonda.',
  },
  audio: {
    // Sin `soundscape`: la reverb la deriva la sonda de la geometría real, que
    // es justamente lo que este mapa está para escuchar.
    ambiences: ['background.hl2.wind.med1'],
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
  },
})
  // El mapa es amplio a propósito: la sonda alcanza 40 m, así que las paredes
  // del perímetro no deben entrar en la medición de la explanada.
  .ground({ size: [200, 220], center: [0, -20], boundary: { height: 5 } })

  // ── [2] Cámara de hormigón: 10×10×3.5, todo reflectante ───────────────────
  .structure({
    id: 'room-concrete',
    center: [-14, -18],
    groundY: GROUND_Y,
    width: 10,
    depth: 10,
    storyHeight: 3.5,
    groundSlab: true,
    roof: 'flat',
    palette: {
      base: 'concrete',
      upper: 'concrete',
      floor: 'concrete',
      roof: 'concrete',
      trim: 'concrete',
    },
    stories: [{ doors: [{ side: 'south', width: 1.8 }] }],
  })

  // ── [3] Cámara absorbente: misma geometría, materiales blandos ────────────
  .structure({
    id: 'room-soft',
    center: [-34, -18],
    groundY: GROUND_Y,
    width: 10,
    depth: 10,
    storyHeight: 3.5,
    groundSlab: true,
    roof: 'flat',
    palette: {
      base: 'grass',
      upper: 'grass',
      floor: 'sand',
      roof: 'snow',
      trim: 'grass',
    },
    stories: [{ doors: [{ side: 'south', width: 1.8 }] }],
  })

  // ── [4] Nave grande: mismo hormigón que [2], nueve veces más grande ───────
  .structure({
    id: 'hall',
    center: [0, -58],
    groundY: GROUND_Y,
    width: 30,
    depth: 30,
    storyHeight: 12,
    groundSlab: true,
    roof: 'flat',
    palette: {
      base: 'concrete',
      upper: 'concrete',
      floor: 'concrete',
      roof: 'concrete',
      trim: 'metalRusted',
    },
    stories: [{ doors: [{ side: 'south', width: 4 }] }],
  })

  // ── [5] Túnel de metal: angosto, largo y reflectante ─────────────────────
  .boxes(...corridor('tunnel', [0, -95], 34, 3.2, 3, 'metalRusted'))

  // ── [6] Muro de oclusión ─────────────────────────────────────────────────
  .boxes(...OCCLUSION_WALL)

  // Pantallas frente a cada puerta: entrada en L, así cada recinto se mide
  // por su tamaño real y no por lo que se ve a través del vano.
  .boxes(
    doorBaffle('baffle-concrete', -14, -10.5, 6, 3.5),
    doorBaffle('baffle-soft', -34, -10.5, 6, 3.5),
    doorBaffle('baffle-hall', 0, -39, 14, 6),
  )

  // ── [8] Pista de superficies: un parche por material ─────────────────────
  .boxes(
    surfacePatch('surf-concrete', -28, 34, 'concrete'),
    surfacePatch('surf-metal', -21, 34, 'metalRusted'),
    surfacePatch('surf-wood', -14, 34, 'woodDark'),
    surfacePatch('surf-tile', -7, 34, 'roof'),
    surfacePatch('surf-gravel', 0, 34, 'rock'),
    surfacePatch('surf-grass', 7, 34, 'grass'),
    surfacePatch('surf-sand', 14, 34, 'sand'),
    surfacePatch('surf-snow', 21, 34, 'snow'),
  )

  // Props sueltos en la explanada: cover para probar obstrucción parcial (el
  // sonido rodea una caja, no queda del otro lado de un muro).
  .prop(
    crateStack({ id: 'crates-plaza', at: [10, 6], rows: 2, cols: 2, layers: 2, seed: 3 }),
    coverWall({ id: 'cover-plaza', at: [-10, 4], axis: 'x', length: 6 }),
    pillar({ id: 'pillar-plaza', at: [6, -4], height: 5 }),
  );

// ── [7] Sala con puerta: la puerta acopla o corta la reverb de la sala ──────
map
  .structure({
    id: 'room-door',
    center: [-30, 20],
    groundY: GROUND_Y,
    width: 9,
    depth: 9,
    storyHeight: 3.5,
    groundSlab: true,
    roof: 'flat',
    palette: { base: 'brick', upper: 'brick', floor: 'floor', roof: 'concrete' },
    stories: [{ doors: [{ side: 'east', width: 2 }] }],
  })
  .door({
    id: 'door-room',
    position: [-25.4, GROUND_Y + 1.5, 20],
    size: [0.25, 3, 2],
    openOffset: [0, 3, 0],
    speed: 2.4,
    material: 'door',
    button: {
      id: 'door-room-btn',
      label: 'Puerta de la sala',
      position: [-25.4, GROUND_Y + 1.3, 23],
      size: [0.3, 0.5, 0.5],
    },
  });

// ── Fuentes de sonido identificables (`ambientSound`) ───────────────────────
// Cada una es una voz espacial real: se atenúa con la distancia, la tapa la
// geometría y arrastra la reverb del recinto donde está.
map
  // Detrás del muro de oclusión: la referencia para escuchar el filtrado.
  .logic({
    kind: 'ambientSound',
    id: 'amb-occluded',
    name: 'amb-occluded',
    sound: 'background.hl2.canals.generator',
    position: [24, 1.4, -23],
    radius: 40,
  })
  // Dentro de la sala con puerta.
  .logic({
    kind: 'ambientSound',
    id: 'amb-behind-door',
    name: 'amb-behind-door',
    sound: 'background.hl2.machines.combineTerminal',
    position: [-30, 1.4, 20],
    radius: 34,
  })
  // En el fondo del túnel: caminarlo entero es escuchar el eco cerrarse.
  .logic({
    kind: 'ambientSound',
    id: 'amb-tunnel',
    name: 'amb-tunnel',
    sound: 'background.hl2.canals.waterLeak',
    position: [0, 1.4, -110],
    radius: 30,
  })
  // En el centro de la nave: fuente puntual en un espacio enorme.
  .logic({
    kind: 'ambientSound',
    id: 'amb-hall',
    name: 'amb-hall',
    sound: 'background.hl2.labs.teleportActive',
    position: [0, 1.4, -58],
    radius: 45,
  })
  // Apagada al arrancar: la enciende un trigger al pisarlo, para oír arrancar
  // una fuente que ya está ubicada en el espacio.
  .logic({
    kind: 'ambientSound',
    id: 'amb-beacon',
    name: 'amb-beacon',
    sound: 'background.hl2.labs.equipmentBeep',
    position: [16, 1.4, 14],
    radius: 22,
    startDisabled: true,
  })
  .trigger({
    id: 'beacon-trigger',
    name: 'beacon-trigger',
    position: [10, GROUND_Y + 1.5, 14],
    size: [4, 3, 4],
    once: false,
    wait: 1,
    connections: [
      { output: 'OnStartTouch', target: 'amb-beacon', input: 'PlaySound' },
      { output: 'OnEndTouch', target: 'amb-beacon', input: 'StopSound' },
    ],
  });

// ── NPCs: vocalizaciones y disparos dentro de cada acústica ────────────────
map
  .npcInRoom('hall', 0, [-8, -8], { id: 'combine-hall-1', characterId: 'combine' })
  .npcInRoom('hall', 0, [8, 6], { id: 'combine-hall-2', characterId: 'combine' })
  // Detrás del muro: dispara desde el otro lado para escuchar la oclusión de
  // un disparo, no solo la de un loop.
  .npc({
    id: 'combine-occluded',
    characterId: 'combine',
    position: [26, 0.5, -24],
  })
  .npcInRoom('room-concrete', 0, [0, 0], {
    id: 'zombie-concrete',
    characterId: 'zombie',
  });

// ── [9] Banco de armas ─────────────────────────────────────────────────────
map
  .pickup({ id: 'wp-pistol', weaponId: 'pistol', position: [26, 0.6, 20] })
  .pickup({ id: 'wp-smg', weaponId: 'smg', position: [28, 0.6, 20] })
  .pickup({ id: 'wp-shotgun', weaponId: 'shotgun', position: [30, 0.6, 20] })
  .pickup({ id: 'wp-ar3', weaponId: 'ar3', position: [32, 0.6, 20] })
  .pickup({ id: 'wp-revolver', weaponId: 'revolver', position: [34, 0.6, 20] })
  .pickup({ id: 'wp-crossbow', weaponId: 'crossbow', position: [26, 0.6, 23] })
  .pickup({ id: 'wp-rpg', weaponId: 'rpg', position: [28, 0.6, 23] })
  .pickup({ id: 'wp-grenade', weaponId: 'grenade', position: [30, 0.6, 23] })
  .pickup({ id: 'wp-crowbar', weaponId: 'crowbar', position: [32, 0.6, 23] })
  .ammo({ id: 'ammo-pistol', ammoId: 'pistol', position: [26, 0.5, 26] })
  .ammo({ id: 'ammo-smg', ammoId: 'smg', position: [28, 0.5, 26] })
  .ammo({ id: 'ammo-shotgun', ammoId: 'shotgun', position: [30, 0.5, 26] })
  .ammo({ id: 'ammo-ar3', ammoId: 'ar3', position: [32, 0.5, 26] })
  .ammo({ id: 'ammo-rpg', ammoId: 'rpg', position: [34, 0.5, 26] })
  .charger({
    id: 'charger-health',
    kind: 'health',
    position: [24, GROUND_Y, 20],
    rotationY: Math.PI / 2,
  });

export const AudioTestLevel: LevelDefinition = map.build();
