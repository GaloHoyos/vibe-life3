import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Material = StaticBoxDefinition['material'];

/**
 * Trazado de la ruta del paso, de sur a norte. Es la columna vertebral del
 * nivel: la geometría dibuja la calzada sobre estos puntos y el mapa deriva de
 * ellos los carriles del grafo vehicular, así que un solo cambio mueve las dos
 * cosas a la vez y nunca quedan desalineadas.
 */
export const D3_ROAD: readonly Vec2[] = [
  [-40, 16],
  [-6, 24],
  [40, 6],
  [84, -12],
  // Tramo recto norte-sur: es el que aloja la barrera del control, que sin un
  // trecho alineado a un eje habría que rotar a mano y siempre queda torcida.
  [90, -20],
  [90, -58],
  [70, -72],
  [56, -80],
];

/** Ancho de calzada. Da para cruzarse con un buggy enemigo sin rozarlo. */
const ROAD_WIDTH = 11;

const boxes: StaticBoxDefinition[] = [];

function addBox(
  id: string,
  position: Vec3,
  size: Vec3,
  material: Material,
  rotation?: Vec3,
): void {
  boxes.push({
    id: `d3-${id}`,
    position,
    size,
    material,
    ...(rotation ? { rotation } : {}),
  });
}

function segment(from: Vec2, to: Vec2): {
  center: Vec2;
  length: number;
  yaw: number;
  right: Vec2;
} {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  return {
    center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
    length,
    yaw,
    // Derecha del proyecto con +Z adelante: `forward × up` = (-cos, 0, sin).
    right: [-dz / length, dx / length],
  };
}

/**
 * Calzada despejada con mojones a los costados. La losa apoya 8 cm sobre la
 * nieve: alcanza para leerse desde lejos y para que ni el jugador ni el buggy
 * sientan el escalón al entrar.
 */
function addRoadSegment(id: string, from: Vec2, to: Vec2): void {
  const { center, length, yaw, right } = segment(from, to);
  addBox(
    `road-${id}`,
    [center[0], 0.04, center[1]],
    [ROAD_WIDTH, 0.08, length + 2],
    'asphalt',
    [0, yaw, 0],
  );
  const markerCount = Math.max(2, Math.round(length / 12));
  for (let index = 0; index <= markerCount; index += 1) {
    const t = index / markerCount;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    for (const side of [-1, 1] as const) {
      const offset = ROAD_WIDTH / 2 + 0.9;
      addBox(
        `roadpost-${id}-${index}-${side < 0 ? 'l' : 'r'}`,
        [x + right[0] * offset * side, 0.55, z + right[1] * offset * side],
        [0.18, 1.1, 0.18],
        'metalRusted',
      );
    }
  }
}

/**
 * Ladera de roca: una masa maestra más lajas inclinadas encima. La masa es la
 * que corta el paso; las lajas sólo rompen la silueta de caja, que es lo que
 * delata un mapa de bloques a diez metros de distancia.
 */
function addRidge(
  id: string,
  center: Vec2,
  size: Vec2,
  height: number,
  seed: number,
): void {
  addBox(
    `ridge-${id}`,
    [center[0], height / 2, center[1]],
    [size[0], height, size[1]],
    'rock',
  );
  let state = seed;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const slabs = Math.max(3, Math.round((size[0] + size[1]) / 26));
  for (let index = 0; index < slabs; index += 1) {
    const x = center[0] + (random() - 0.5) * size[0] * 0.8;
    const z = center[1] + (random() - 0.5) * size[1] * 0.8;
    const width = 7 + random() * 11;
    const depth = 7 + random() * 11;
    const lift = 2.5 + random() * 4;
    addBox(
      `ridgeslab-${id}-${index}`,
      [x, height + lift / 2 - 0.6, z],
      [width, lift, depth],
      'rock',
      [random() * 0.16 - 0.08, random() * Math.PI, random() * 0.16 - 0.08],
    );
  }
}

/** Peñasco suelto: cobertura dura en campo abierto y ancla visual del valle. */
function addBoulder(id: string, at: Vec2, scale: number, yaw: number): void {
  addBox(
    `boulder-${id}`,
    [at[0], scale * 0.42, at[1]],
    [scale, scale * 0.95, scale * 0.8],
    'rock',
    [0.07, yaw, -0.05],
  );
  addBox(
    `boulder-${id}-cap`,
    [at[0] + scale * 0.18, scale * 0.86, at[1] - scale * 0.12],
    [scale * 0.62, scale * 0.5, scale * 0.55],
    'rock',
    [-0.11, yaw + 0.7, 0.09],
  );
}

/** Cordón de nieve acumulada: recorta la vista sin cerrar el paso. */
function addSnowBerm(id: string, from: Vec2, to: Vec2, height: number): void {
  const { center, length, yaw } = segment(from, to);
  addBox(
    `berm-${id}`,
    [center[0], height / 2, center[1]],
    [3.4, height, length],
    'snow',
    [0, yaw, 0],
  );
}

// ── Cordilleras que encierran el valle jugable ───────────────────────────────
// Dejan libre x ∈ [-110, 110]. El pasillo de entrada al sur y el hueco del
// oeste hacia el depósito son las dos únicas costuras, y son deliberadas.
addRidge('west-high', [-140, 60], [60, 200], 18, 91);
addRidge('east-high', [140, 60], [60, 200], 18, 137);
addRidge('west-low', [-140, -110], [60, 140], 18, 211);
addRidge('east-low', [140, -110], [60, 140], 18, 307);

// Pasillo de entrada: el jugador arranca embudado y desemboca en el cuenco.
addRidge('entry-west', [-100, 134], [80, 52], 16, 419);
addRidge('entry-east', [40, 138], [140, 44], 16, 523);

// Espina central: separa el cuenco del valle vehicular y deja un solo hueco al
// oeste (x ∈ [-110, -50]), que es por donde se baja al depósito.
addRidge('spine', [30, 48], [160, 24], 15, 613);

// ── Ruta del paso ────────────────────────────────────────────────────────────
for (let index = 0; index < D3_ROAD.length - 1; index += 1) {
  addRoadSegment(String(index + 1).padStart(2, '0'), D3_ROAD[index], D3_ROAD[index + 1]);
}

// Playa de maniobras del depósito: empalma el portón con el primer tramo.
addBox('depot-apron', [-46, 0.04, 20], [26, 0.08, 22], 'concrete');

// ── Peñascos del valle ───────────────────────────────────────────────────────
// Sembrados fuera de la calzada: dan cobertura al combate a pie y le ponen
// referencias al vuelo, que sobre nieve plana se vuelve ilegible.
const BOULDERS: ReadonlyArray<[string, Vec2, number, number]> = [
  ['v01', [-78, -18], 5.5, 0.4],
  ['v02', [-52, -46], 4.2, 1.9],
  ['v03', [-88, -74], 6.4, 2.7],
  ['v04', [-24, -62], 4.8, 0.9],
  ['v05', [-14, -104], 5.9, 2.2],
  ['v06', [16, -46], 4.4, 1.2],
  ['v07', [38, -34], 5.2, 0.3],
  ['v08', [104, -84], 6.1, 1.6],
  ['v09', [-20, -130], 4.6, 2.4],
  ['v10', [-64, -118], 5.4, 0.8],
  ['v11', [-101, 6], 6.8, 1.4],
  ['v12', [88, 22], 5.1, 2.9],
  ['b01', [-58, 96], 4.9, 1.1],
  ['b02', [46, 88], 5.6, 2.6],
  ['b03', [-16, 68], 4.3, 0.5],
  ['b04', [78, 112], 6.2, 1.8],
];
for (const [id, at, scale, yaw] of BOULDERS) addBoulder(id, at, scale, yaw);

// ── Bermas ───────────────────────────────────────────────────────────────────
// En el cuenco van a la altura de un parapeto: cubren, pero se saltan. Un
// cordón infranqueable cruzando una arena la parte en dos pasillos.
addSnowBerm('bowl-a', [-34, 84], [22, 78], 0.9);
addSnowBerm('bowl-b', [30, 74], [64, 92], 0.9);
// En campo abierto sí cortan: ahí lo que hacen es dar forma al valle.
addSnowBerm('valley-a', [-70, -30], [-70, -84], 1.5);
addSnowBerm('valley-b', [-12, -84], [-12, -128], 1.5);

/**
 * Arte modular del paso: laderas, calzada, peñascos y bermas. Va como artifact
 * único para que el editor y el Workshop no conviertan cada laja de roca en una
 * entidad editable; el LevelLoader la sigue entregando caja por caja a render,
 * física y navegación.
 *
 * El envelope queda fuera del mundo a propósito: esto no es una habitación que
 * la IA pueda breachear, es el shell del terreno.
 */
export const DEMO3_PASS_ARTIFACT: BuildingArtifact = {
  id: 'd3-pass-shell',
  boxes,
  doorways: [],
  rooms: [],
  envelope: { min: [-1000, -1000, -1000], max: [-999, -999, -999] },
};
