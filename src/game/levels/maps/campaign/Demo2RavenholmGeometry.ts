import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';

type Vec3 = [number, number, number];
type Vec2 = [number, number];
type Rotation = [number, number, number];
type Material = StaticBoxDefinition['material'];

interface RoadRibbonSpec {
  id: string;
  from: Vec2;
  to: Vec2;
  width?: number;
  sidewalkWidth?: number;
}

interface BackdropBuildingSpec {
  id: string;
  at: Vec2;
  width: number;
  depth: number;
  height: number;
  stories: number;
  yaw?: number;
  facade?: Material;
  roof?: 'flat' | 'gable';
  litWindows?: readonly number[];
}

function addBox(
  boxes: StaticBoxDefinition[],
  id: string,
  position: Vec3,
  size: Vec3,
  material: Material,
  rotation?: Rotation,
): void {
  boxes.push({
    id: `d2-${id}`,
    position,
    size,
    material,
    ...(rotation ? { rotation } : {}),
  });
}

/** Convierte un offset local X/Z al espacio del nivel conservando el yaw. */
function localXZ(origin: Vec2, yaw: number, localX: number, localZ: number): Vec2 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    origin[0] + localX * cos + localZ * sin,
    origin[1] - localX * sin + localZ * cos,
  ];
}

function segmentData(from: Vec2, to: Vec2): {
  center: Vec2;
  length: number;
  yaw: number;
  right: Vec2;
} {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  return {
    center: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
    length,
    yaw: Math.atan2(dx, dz),
    right: [dz / length, -dx / length],
  };
}

/**
 * Calle completa: calzada ancha, veredas, cordones y drenajes. Los tramos se
 * solapan levemente en las curvas para que la ruta serpenteante se lea como un
 * distrito real y no como una sucesion de plataformas aisladas.
 */
function addRoadRibbon(boxes: StaticBoxDefinition[], spec: RoadRibbonSpec): void {
  const { center, length, yaw, right } = segmentData(spec.from, spec.to);
  const width = spec.width ?? 9.6;
  const sidewalkWidth = spec.sidewalkWidth ?? 1.85;
  const sidewalkOffset = width / 2 + sidewalkWidth / 2 + 0.18;
  const curbOffset = width / 2 + 0.09;
  const drainOffset = width / 2 - 0.22;

  addBox(boxes, `road-${spec.id}`, [center[0], 0.035, center[1]], [width, 0.07, length + 1.8], 'asphalt', [0, yaw, 0]);
  for (const side of [-1, 1] as const) {
    const tag = side < 0 ? 'l' : 'r';
    addBox(
      boxes,
      `walk-${spec.id}-${tag}`,
      [center[0] + right[0] * sidewalkOffset * side, 0.095, center[1] + right[1] * sidewalkOffset * side],
      [sidewalkWidth, 0.19, length + 1.1],
      'concrete',
      [0, yaw, 0],
    );
    addBox(
      boxes,
      `curb-${spec.id}-${tag}`,
      [center[0] + right[0] * curbOffset * side, 0.16, center[1] + right[1] * curbOffset * side],
      [0.18, 0.32, length + 1.25],
      'concrete',
      [0, yaw, 0],
    );
    addBox(
      boxes,
      `drain-${spec.id}-${tag}`,
      [center[0] + right[0] * drainOffset * side, 0.082, center[1] + right[1] * drainOffset * side],
      [0.16, 0.025, length + 0.9],
      'metalRusted',
      [0, yaw, 0],
    );
  }
}

function addCrosswalk(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number, stripes = 6): void {
  for (let i = 0; i < stripes; i += 1) {
    const along = (i - (stripes - 1) / 2) * 0.82;
    const p = localXZ(at, yaw, 0, along);
    addBox(boxes, `crosswalk-${id}-${i}`, [p[0], 0.086, p[1]], [7.7, 0.025, 0.42], 'concrete', [0, yaw, 0]);
  }
}

function addStreetLamp(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const arm = localXZ(at, yaw, 0.56, 0);
  const head = localXZ(at, yaw, 1.05, 0);
  addBox(boxes, `lamp-${id}-base`, [at[0], 0.16, at[1]], [0.54, 0.32, 0.54], 'concrete');
  addBox(boxes, `lamp-${id}-pole`, [at[0], 2.72, at[1]], [0.17, 5.2, 0.17], 'metalRusted');
  addBox(boxes, `lamp-${id}-collar`, [at[0], 4.82, at[1]], [0.29, 0.16, 0.29], 'trim');
  addBox(boxes, `lamp-${id}-arm`, [arm[0], 5.18, arm[1]], [1.25, 0.12, 0.12], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `lamp-${id}-hood`, [head[0], 5.05, head[1]], [0.66, 0.22, 0.38], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `lamp-${id}-glow`, [head[0], 4.91, head[1]], [0.47, 0.05, 0.25], 'lightWarm', [0, yaw, 0]);
}

function addUtilityPole(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const left = localXZ(at, yaw, -0.78, 0);
  const right = localXZ(at, yaw, 0.78, 0);
  addBox(boxes, `utility-${id}-foot`, [at[0], 0.17, at[1]], [0.58, 0.34, 0.58], 'concrete');
  addBox(boxes, `utility-${id}-pole`, [at[0], 4.0, at[1]], [0.24, 7.8, 0.24], 'woodDark');
  addBox(boxes, `utility-${id}-cross`, [at[0], 7.22, at[1]], [2.15, 0.18, 0.18], 'woodDark', [0, yaw, 0]);
  addBox(boxes, `utility-${id}-ins-l`, [left[0], 7.44, left[1]], [0.14, 0.34, 0.14], 'signalBlue');
  addBox(boxes, `utility-${id}-ins-r`, [right[0], 7.44, right[1]], [0.14, 0.34, 0.14], 'signalBlue');
  addBox(boxes, `utility-${id}-transformer`, [at[0], 5.55, at[1]], [0.72, 1.15, 0.62], 'metalRusted', [0, yaw, 0]);
}

/** Cuatro piezas bajan hacia el centro para sugerir el peso de la catenaria. */
function addCableSpan(boxes: StaticBoxDefinition[], id: string, from: Vec2, to: Vec2): void {
  const points: Vec2[] = [
    from,
    [from[0] + (to[0] - from[0]) * 0.25, from[1] + (to[1] - from[1]) * 0.25],
    [from[0] + (to[0] - from[0]) * 0.5, from[1] + (to[1] - from[1]) * 0.5],
    [from[0] + (to[0] - from[0]) * 0.75, from[1] + (to[1] - from[1]) * 0.75],
    to,
  ];
  const heights = [7.22, 6.93, 6.82, 6.93, 7.22];
  for (let i = 0; i < points.length - 1; i += 1) {
    const { center, length, yaw } = segmentData(points[i], points[i + 1]);
    const y = (heights[i] + heights[i + 1]) / 2;
    addBox(boxes, `cable-${id}-${i}`, [center[0], y, center[1]], [0.045, 0.045, length + 0.06], 'metalRusted', [0, yaw, 0]);
  }
}

function addFenceRun(
  boxes: StaticBoxDefinition[],
  id: string,
  from: Vec2,
  to: Vec2,
  height = 2.45,
  spacing = 3.2,
): void {
  const { center, length, yaw } = segmentData(from, to);
  const count = Math.max(1, Math.ceil(length / spacing));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    addBox(boxes, `fence-${id}-post-${i}`, [x, height / 2, z], [0.14, height, 0.14], 'metalRusted');
    addBox(boxes, `fence-${id}-finial-${i}`, [x, height + 0.14, z], [0.22, 0.28, 0.22], 'trim', [0, 0, Math.PI / 4]);
  }
  addBox(boxes, `fence-${id}-rail-low`, [center[0], 0.7, center[1]], [0.11, 0.11, length], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `fence-${id}-rail-high`, [center[0], height - 0.35, center[1]], [0.11, 0.11, length], 'metalRusted', [0, yaw, 0]);
}

function addDebrisCluster(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const beam = localXZ(at, yaw, -0.75, 0.05);
  const slab = localXZ(at, yaw, 0.48, -0.25);
  const brickA = localXZ(at, yaw, 0.9, 0.58);
  const brickB = localXZ(at, yaw, -0.05, 0.84);
  addBox(boxes, `debris-${id}-beam`, [beam[0], 0.16, beam[1]], [2.15, 0.27, 0.3], 'woodDark', [0.08, yaw + 0.3, 0.11]);
  addBox(boxes, `debris-${id}-slab`, [slab[0], 0.13, slab[1]], [1.35, 0.22, 0.92], 'concrete', [0.07, yaw - 0.18, -0.08]);
  addBox(boxes, `debris-${id}-brick-a`, [brickA[0], 0.15, brickA[1]], [0.5, 0.28, 0.36], 'brick', [0.12, yaw + 0.52, 0.05]);
  addBox(boxes, `debris-${id}-brick-b`, [brickB[0], 0.1, brickB[1]], [0.66, 0.19, 0.42], 'brick', [0.04, yaw - 0.36, 0.12]);
}

function addBackdropBuilding(boxes: StaticBoxDefinition[], spec: BackdropBuildingSpec): void {
  const yaw = spec.yaw ?? 0;
  const facade = spec.facade ?? 'plaster';
  const frontZ = -spec.depth / 2 - 0.035;
  const front = localXZ(spec.at, yaw, 0, frontZ);

  addBox(boxes, `building-${spec.id}-mass`, [spec.at[0], spec.height / 2, spec.at[1]], [spec.width, spec.height, spec.depth], facade, [0, yaw, 0]);
  addBox(boxes, `building-${spec.id}-plinth`, [front[0], 0.48, front[1]], [spec.width + 0.18, 0.86, 0.09], 'concrete', [0, yaw, 0]);
  addBox(boxes, `building-${spec.id}-belt`, [front[0], spec.height - 0.65, front[1]], [spec.width + 0.35, 0.22, 0.12], 'trim', [0, yaw, 0]);

  if ((spec.roof ?? 'gable') === 'gable') {
    const roofRise = Math.min(2.6, spec.width * 0.13);
    const slope = Math.atan2(roofRise, spec.width / 2);
    const roofLength = Math.hypot(spec.width / 2 + 0.45, roofRise);
    for (const side of [-1, 1] as const) {
      const p = localXZ(spec.at, yaw, side * spec.width / 4, 0);
      addBox(
        boxes,
        `building-${spec.id}-roof-${side < 0 ? 'l' : 'r'}`,
        [p[0], spec.height + roofRise / 2, p[1]],
        [roofLength, 0.28, spec.depth + 0.9],
        'roof',
        [0, yaw, side * slope],
      );
    }
    addBox(boxes, `building-${spec.id}-ridge`, [spec.at[0], spec.height + roofRise + 0.08, spec.at[1]], [0.26, 0.28, spec.depth + 1], 'trim', [0, yaw, 0]);
  } else {
    addBox(boxes, `building-${spec.id}-roof`, [spec.at[0], spec.height + 0.18, spec.at[1]], [spec.width + 0.55, 0.36, spec.depth + 0.55], 'roof', [0, yaw, 0]);
    for (const side of [-1, 1] as const) {
      const edge = localXZ(spec.at, yaw, side * (spec.width / 2 - 0.32), 0);
      addBox(boxes, `building-${spec.id}-parapet-${side}`, [edge[0], spec.height + 0.82, edge[1]], [0.28, 1.25, spec.depth + 0.5], 'brick', [0, yaw, 0]);
    }
  }

  // Ventanas profundas, alfeizares y algunas tablas convierten la medianera en
  // una fachada vivida sin agregar geometria transitable frente a ella.
  const columns = Math.max(2, Math.min(6, Math.floor(spec.width / 3.1)));
  const storyHeight = (spec.height - 1.25) / spec.stories;
  for (let story = 0; story < spec.stories; story += 1) {
    const y = 1.35 + story * storyHeight + storyHeight * 0.36;
    for (let column = 0; column < columns; column += 1) {
      const localX = columns === 1 ? 0 : -spec.width * 0.38 + (spec.width * 0.76 * column) / (columns - 1);
      const p = localXZ(spec.at, yaw, localX, frontZ - 0.035);
      const windowIndex = story * columns + column;
      const windowMaterial: Material = spec.litWindows?.includes(windowIndex) ? 'lightWarm' : 'signalBlue';
      addBox(boxes, `building-${spec.id}-window-${story}-${column}`, [p[0], y, p[1]], [1.12, 1.32, 0.055], windowMaterial, [0, yaw, 0]);
      addBox(boxes, `building-${spec.id}-sill-${story}-${column}`, [p[0], y - 0.75, p[1]], [1.42, 0.16, 0.16], 'concrete', [0, yaw, 0]);
      addBox(boxes, `building-${spec.id}-lintel-${story}-${column}`, [p[0], y + 0.75, p[1]], [1.42, 0.16, 0.16], 'brick', [0, yaw, 0]);
      if ((story + column) % 4 === 1) {
        addBox(boxes, `building-${spec.id}-board-${story}-${column}`, [p[0], y, p[1] - 0.012], [1.44, 0.16, 0.08], 'woodDark', [0, yaw + 0.12, 0]);
      }
    }
  }

  // Canaleta frontal y dos bajadas: una silueta pequeña pero constante que
  // une visualmente los edificios de la calle vieja.
  const gutter = localXZ(spec.at, yaw, 0, frontZ - 0.12);
  addBox(boxes, `building-${spec.id}-gutter`, [gutter[0], spec.height + 0.28, gutter[1]], [spec.width + 0.55, 0.18, 0.18], 'metalRusted', [0, yaw, 0]);
  for (const side of [-1, 1] as const) {
    const pipe = localXZ(spec.at, yaw, side * (spec.width / 2 - 0.42), frontZ - 0.13);
    addBox(boxes, `building-${spec.id}-downpipe-${side < 0 ? 'l' : 'r'}`, [pipe[0], spec.height / 2, pipe[1]], [0.14, spec.height, 0.14], 'metalRusted', [0, yaw, 0]);
    addBox(boxes, `building-${spec.id}-shoe-${side < 0 ? 'l' : 'r'}`, [pipe[0], 0.22, pipe[1] - 0.18], [0.14, 0.4, 0.52], 'metalRusted', [0.42, yaw, 0]);
  }
}

function addStorefront(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const rear = localXZ(at, yaw, 0, 0.32);
  addBox(boxes, `store-${id}-recess`, [rear[0], 1.65, rear[1]], [7.8, 3.3, 0.72], 'brick', [0, yaw, 0]);
  addBox(boxes, `store-${id}-header`, [at[0], 3.35, at[1]], [8.15, 0.62, 0.34], 'plaster', [0, yaw, 0]);
  addBox(boxes, `store-${id}-sign`, [at[0], 3.35, at[1] - 0.2], [6.8, 0.34, 0.05], 'signalRed', [0, yaw, 0]);
  for (const [index, x] of [-2.75, -0.95, 0.95, 2.75].entries()) {
    const pane = localXZ(at, yaw, x, -0.18);
    addBox(boxes, `store-${id}-pane-${index}`, [pane[0], 1.8, pane[1]], [1.55, 2.15, 0.06], 'signalBlue', [0, yaw, 0]);
    addBox(boxes, `store-${id}-mullion-${index}`, [pane[0] - 0.84 * Math.cos(yaw), 1.8, pane[1] + 0.84 * Math.sin(yaw)], [0.12, 2.45, 0.14], 'metalRusted', [0, yaw, 0]);
  }
  addBox(boxes, `store-${id}-sill`, [at[0], 0.65, at[1] - 0.17], [7.7, 0.22, 0.22], 'concrete', [0, yaw, 0]);
  addBox(boxes, `store-${id}-awning`, [at[0], 3.0, at[1] - 0.82], [7.45, 0.18, 1.35], 'woodDark', [0.08, yaw, 0]);
  // Objetos atrapados tras el vidrio: cajas, una valija y un pequeño altar.
  for (const [index, x] of [-2.45, 0.45, 2.25].entries()) {
    const prop = localXZ(at, yaw, x, 0.03);
    addBox(boxes, `store-${id}-display-${index}`, [prop[0], 0.8 + index * 0.12, prop[1]], [0.95, 0.7 + index * 0.16, 0.48], index === 1 ? 'signalRed' : 'crate', [0, yaw + index * 0.08, 0]);
  }
  const candle = localXZ(at, yaw, -0.45, -0.02);
  addBox(boxes, `store-${id}-candle`, [candle[0], 0.95, candle[1]], [0.1, 0.42, 0.1], 'lightWarm');
}

function addWreckedCar(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const hood = localXZ(at, yaw, 0, -1.42);
  const trunk = localXZ(at, yaw, 0, 1.5);
  const cabin = localXZ(at, yaw, 0, 0.05);
  addBox(boxes, `car-${id}-chassis`, [at[0], 0.35, at[1]], [2.05, 0.34, 4.45], 'metalRusted', [0, yaw, 0.02]);
  addBox(boxes, `car-${id}-hood`, [hood[0], 0.67, hood[1]], [1.88, 0.38, 1.3], 'signalRed', [0, yaw, -0.07]);
  addBox(boxes, `car-${id}-trunk`, [trunk[0], 0.69, trunk[1]], [1.92, 0.4, 1.0], 'signalRed', [0, yaw, 0.03]);
  addBox(boxes, `car-${id}-cabin`, [cabin[0], 1.05, cabin[1]], [1.72, 0.8, 1.72], 'wall', [0, yaw, 0]);
  const glass = localXZ(at, yaw, 0, -0.79);
  addBox(boxes, `car-${id}-glass`, [glass[0], 1.22, glass[1]], [1.46, 0.55, 0.08], 'signalBlue', [0.25, yaw, 0]);
  const wheelOffsets: Vec2[] = [[-1.02, -1.34], [1.02, -1.34], [-1.02, 1.35], [1.02, 1.35]];
  wheelOffsets.forEach(([x, z], index) => {
    const wheel = localXZ(at, yaw, x, z);
    addBox(boxes, `car-${id}-wheel-${index}`, [wheel[0], 0.34, wheel[1]], [0.33, 0.65, 0.66], 'floor', [0, yaw, 0]);
  });
  const door = localXZ(at, yaw, 1.04, 0.2);
  addBox(boxes, `car-${id}-loose-door`, [door[0], 0.38, door[1]], [0.12, 1.0, 1.45], 'signalRed', [0.05, yaw + 0.36, 0.22]);
}

function addFuneralCart(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  addBox(boxes, `cart-${id}-bed`, [at[0], 0.88, at[1]], [2.2, 0.32, 3.5], 'woodDark', [0, yaw, 0.025]);
  addBox(boxes, `cart-${id}-coffin-lower`, [at[0], 1.2, at[1]], [1.35, 0.5, 2.65], 'crate', [0, yaw + 0.04, 0]);
  addBox(boxes, `cart-${id}-coffin-lid`, [at[0], 1.54, at[1]], [1.45, 0.18, 2.75], 'woodDark', [0, yaw + 0.04, 0.03]);
  for (const side of [-1, 1] as const) {
    const wheelA = localXZ(at, yaw, side * 1.22, -1.05);
    const wheelB = localXZ(at, yaw, side * 1.22, 1.05);
    addBox(boxes, `cart-${id}-wheel-${side}-a`, [wheelA[0], 0.58, wheelA[1]], [0.26, 1.15, 1.15], 'metalRusted', [0, yaw, 0]);
    addBox(boxes, `cart-${id}-wheel-${side}-b`, [wheelB[0], 0.58, wheelB[1]], [0.26, 1.15, 1.15], 'metalRusted', [0, yaw, 0]);
  }
  const shafts = [-0.7, 0.7] as const;
  shafts.forEach((x, index) => {
    const shaft = localXZ(at, yaw, x, -3.1);
    addBox(boxes, `cart-${id}-shaft-${index}`, [shaft[0], 0.73, shaft[1]], [0.14, 0.14, 3.2], 'woodDark', [0, yaw, 0.08]);
  });
}

function addCrematoriumYard(boxes: StaticBoxDefinition[]): void {
  // El crematorio jugable ocupa x=-80..-56,z=98..118. Todo este aparato
  // queda al oeste, pegado a la medianera pero fuera de su huella.
  addBox(boxes, 'crem-yard-slab', [-85.5, 0.11, 105.5], [8.4, 0.22, 18], 'concrete');
  addBox(boxes, 'crem-furnace-bank', [-85.4, 1.55, 104.5], [5.6, 3.1, 9.8], 'brick');
  for (let i = 0; i < 3; i += 1) {
    const z = 101.6 + i * 3.0;
    addBox(boxes, `crem-furnace-door-${i}`, [-82.55, 1.28, z], [0.08, 1.65, 1.75], 'metalRusted');
    addBox(boxes, `crem-furnace-frame-top-${i}`, [-82.48, 2.18, z], [0.15, 0.16, 2.05], 'trim');
    addBox(boxes, `crem-furnace-frame-low-${i}`, [-82.48, 0.37, z], [0.15, 0.16, 2.05], 'trim');
    addBox(boxes, `crem-furnace-glow-${i}`, [-82.42, 1.3, z], [0.035, 0.75, 0.9], 'lightWarm');
    addBox(boxes, `crem-furnace-latch-${i}`, [-82.34, 1.28, z - 0.62], [0.18, 0.18, 0.42], 'trim');
  }
  addBox(boxes, 'crem-flue-header', [-86.8, 4.0, 104.5], [1.05, 1.05, 10.5], 'metalRusted');
  addBox(boxes, 'crem-flue-rise', [-88.4, 6.7, 110.5], [1.5, 8.5, 1.5], 'metalRusted');
  addBox(boxes, 'crem-stack-base', [-91, 1.0, 111.5], [5.8, 2.0, 5.8], 'brick');
  addBox(boxes, 'crem-stack', [-91, 10.0, 111.5], [3.8, 18.0, 3.8], 'brick');
  addBox(boxes, 'crem-stack-band-a', [-91, 4.0, 111.5], [4.15, 0.42, 4.15], 'trim');
  addBox(boxes, 'crem-stack-band-b', [-91, 10.0, 111.5], [4.0, 0.42, 4.0], 'trim');
  addBox(boxes, 'crem-stack-crown', [-91, 19.2, 111.5], [4.6, 0.85, 4.6], 'brick');
  addBox(boxes, 'crem-coal-bin', [-86.5, 0.72, 96.8], [5.4, 1.45, 3.2], 'metalRusted', [0, -0.08, 0]);
  addBox(boxes, 'crem-coal-pile', [-86.2, 1.25, 96.4], [4.35, 0.75, 2.35], 'floor', [0.08, -0.08, -0.1]);
}

function addBelfry(boxes: StaticBoxDefinition[]): void {
  // La capilla principal termina en z=98; el campanario arranca detras de ella.
  addBox(boxes, 'chapel-belfry-base', [-10, 4.6, 102.5], [6.8, 9.2, 7.0], 'brick');
  addBox(boxes, 'chapel-belfry-plaster', [-10, 5.0, 98.96], [5.8, 7.4, 0.08], 'plaster');
  for (const x of [-1.9, 1.9]) {
    addBox(boxes, `chapel-belfry-pier-${x < 0 ? 'w' : 'e'}`, [-10 + x, 11.2, 102.5], [1.1, 4.2, 6.2], 'brick');
  }
  addBox(boxes, 'chapel-belfry-arch-top', [-10, 13.1, 102.5], [4.9, 0.65, 6.2], 'brick');
  addBox(boxes, 'chapel-belfry-bell-yoke', [-10, 11.7, 102.5], [4.0, 0.28, 0.35], 'woodDark');
  addBox(boxes, 'chapel-belfry-bell', [-10, 10.75, 102.5], [1.35, 1.6, 1.35], 'metalRusted');
  addBox(boxes, 'chapel-belfry-bell-lip', [-10, 9.92, 102.5], [1.75, 0.25, 1.75], 'trim');
  addBox(boxes, 'chapel-belfry-roof-west', [-11.8, 14.65, 102.5], [4.15, 0.32, 7.8], 'roof', [0, 0, 0.55]);
  addBox(boxes, 'chapel-belfry-roof-east', [-8.2, 14.65, 102.5], [4.15, 0.32, 7.8], 'roof', [0, 0, -0.55]);
  addBox(boxes, 'chapel-belfry-ridge', [-10, 16.0, 102.5], [0.25, 0.25, 8.0], 'trim');
  addBox(boxes, 'chapel-belfry-cross-v', [-10, 17.1, 102.5], [0.18, 2.15, 0.18], 'metalRusted');
  addBox(boxes, 'chapel-belfry-cross-h', [-10, 17.35, 102.5], [1.55, 0.18, 0.18], 'metalRusted');
  addBox(boxes, 'chapel-gutter-rear', [-10, 9.35, 98.82], [7.2, 0.18, 0.18], 'metalRusted');
  addBox(boxes, 'chapel-downpipe-rear', [-13.2, 4.6, 98.72], [0.16, 9.2, 0.16], 'metalRusted');
}

function addTombstone(
  boxes: StaticBoxDefinition[],
  id: string,
  at: Vec2,
  yaw: number,
  height: number,
): void {
  addBox(boxes, `grave-${id}-kerb`, [at[0], 0.1, at[1] + 0.72], [1.15, 0.2, 2.15], 'concrete', [0, yaw, 0]);
  addBox(boxes, `grave-${id}-base`, [at[0], 0.26, at[1]], [1.15, 0.34, 0.62], 'concrete', [0, yaw, 0]);
  addBox(boxes, `grave-${id}-stone`, [at[0], height / 2 + 0.33, at[1]], [0.78, height, 0.28], 'rock', [0, yaw, 0]);
  addBox(boxes, `grave-${id}-cap`, [at[0], height + 0.38, at[1]], [0.92, 0.18, 0.34], 'concrete', [0, yaw, 0.05]);
}

function addCemetery(boxes: StaticBoxDefinition[]): void {
  addBox(boxes, 'cemetery-earth', [96.5, 0.04, 31], [25, 0.08, 36], 'grass');
  addFenceRun(boxes, 'cemetery-north', [84, 49], [109, 49]);
  addFenceRun(boxes, 'cemetery-east', [109, 49], [109, 13]);
  addFenceRun(boxes, 'cemetery-south', [109, 13], [84, 13]);
  addFenceRun(boxes, 'cemetery-west-n', [84, 49], [84, 35]);
  addFenceRun(boxes, 'cemetery-west-s', [84, 27], [84, 13]);
  addBox(boxes, 'cemetery-gate-pier-n', [84, 1.65, 35], [1.05, 3.3, 1.05], 'brick');
  addBox(boxes, 'cemetery-gate-pier-s', [84, 1.65, 27], [1.05, 3.3, 1.05], 'brick');
  addBox(boxes, 'cemetery-gate-arch', [84, 3.25, 31], [1.05, 0.45, 8.2], 'brick');

  let graveIndex = 0;
  for (const x of [88, 93.5, 99, 104.5]) {
    for (const z of [17.5, 24.5, 31.5, 38.5, 45.5]) {
      const yaw = ((graveIndex % 3) - 1) * 0.07;
      addTombstone(boxes, `${graveIndex}`, [x, z], yaw, 1.1 + (graveIndex % 4) * 0.16);
      graveIndex += 1;
    }
  }

  // Dos osarios de borde encuadran el deposito jugable sin tocar su huella.
  addBox(boxes, 'cemetery-mausoleum-base', [104, 0.3, 42], [6.5, 0.6, 6.2], 'concrete');
  addBox(boxes, 'cemetery-mausoleum-mass', [104, 2.5, 42], [5.8, 4.4, 5.5], 'brick');
  addBox(boxes, 'cemetery-mausoleum-door', [104, 2.0, 39.22], [2.0, 3.1, 0.08], 'metalRusted');
  addBox(boxes, 'cemetery-mausoleum-roof-w', [102.45, 5.12, 42], [3.55, 0.28, 6.2], 'roof', [0, 0, 0.42]);
  addBox(boxes, 'cemetery-mausoleum-roof-e', [105.55, 5.12, 42], [3.55, 0.28, 6.2], 'roof', [0, 0, -0.42]);
  addBox(boxes, 'cemetery-memorial-plinth', [96.5, 0.58, 30.8], [2.4, 1.16, 2.4], 'concrete');
  addBox(boxes, 'cemetery-memorial-column', [96.5, 2.55, 30.8], [0.72, 3.2, 0.72], 'rock', [0.03, 0, -0.04]);
  addBox(boxes, 'cemetery-memorial-cross', [96.5, 4.45, 30.8], [2.0, 0.32, 0.42], 'rock');
}

function addPortalCourtyard(boxes: StaticBoxDefinition[]): void {
  // Patio portalable continuo. El centro queda deliberadamente vacio: tiene
  // espacio para combate, lectura de silueta y para probar ambos portales.
  addBox(boxes, 'portal-courtyard-floor', [36, 0.06, 67], [44, 0.12, 30], 'concrete');
  addBox(boxes, 'portal-court-drain-west', [18.2, 0.135, 67], [0.42, 0.035, 23], 'metalRusted');
  addBox(boxes, 'portal-court-drain-east', [52.3, 0.135, 67], [0.42, 0.035, 23], 'metalRusted');
  for (const z of [57.5, 62.5, 67.5, 72.5, 77.5]) {
    addBox(boxes, `portal-court-drain-rung-${z}`, [18.2, 0.16, z], [0.58, 0.04, 0.12], 'trim');
    addBox(boxes, `portal-court-drain-rung-e-${z}`, [52.3, 0.16, z], [0.58, 0.04, 0.12], 'trim');
  }

  // Perimetro norte/este y cuello oeste. La unica abertura de llegada queda
  // en x=14,z=70..78 y se conecta con la calle que sale de la capilla.
  addBox(boxes, 'portal-wall-north', [36, 3.4, 82], [44, 6.8, 0.7], 'brick');
  addBox(boxes, 'portal-wall-west-south', [14, 3.4, 61], [0.7, 6.8, 18], 'brick');
  addBox(boxes, 'portal-wall-west-north', [14, 3.4, 80], [0.7, 6.8, 4], 'brick');
  addBox(boxes, 'portal-wall-east', [58, 3.4, 67], [0.7, 6.8, 30], 'brick');
  addBox(boxes, 'portal-entry-jamb-s', [14, 3.4, 69.45], [1.15, 6.8, 1.1], 'concrete');
  addBox(boxes, 'portal-entry-jamb-n', [14, 3.4, 78.55], [1.15, 6.8, 1.1], 'concrete');
  addBox(boxes, 'portal-entry-header', [14, 6.45, 74], [1.15, 0.7, 8.2], 'concrete');

  // Division distrital: se conecta a los limites laterales del mapa para que
  // el porton no pueda rodearse caminando por terreno vacio.
  addBox(boxes, 'portal-district-wall-west', [-53, 3.4, 52], [134, 6.8, 0.8], 'brick');
  addBox(boxes, 'portal-gate-wall-left', [25.25, 3.4, 52], [22.5, 6.8, 0.8], 'brick');
  addBox(boxes, 'portal-gate-wall-right', [49.75, 3.4, 52], [16.5, 6.8, 0.8], 'brick');
  addBox(boxes, 'portal-district-wall-east', [89, 3.4, 52], [62, 6.8, 0.8], 'brick');
  addBox(boxes, 'portal-gate-jamb-west', [36.15, 3.45, 52], [0.7, 6.9, 1.25], 'concrete');
  addBox(boxes, 'portal-gate-jamb-east', [41.85, 3.45, 52], [0.7, 6.9, 1.25], 'concrete');
  addBox(boxes, 'portal-gate-lintel', [39, 5.75, 52], [5.0, 2.1, 1.05], 'concrete');
  for (const x of [-112, -96, -80, -64, -48, -32, -16, 5, 20, 58, 72, 88, 104, 116]) {
    if (x > 34 && x < 44) continue;
    addBox(boxes, `portal-wall-buttress-${x}`, [x, 2.45, 51.35], [1.0, 4.9, 1.4], 'concrete');
    addBox(boxes, `portal-wall-cap-${x}`, [x, 5.4, 51.35], [1.35, 0.35, 1.65], 'trim');
  }
  addBox(boxes, 'portal-wall-coping-west', [-53, 6.94, 52], [134, 0.28, 1.08], 'roof');
  addBox(boxes, 'portal-wall-coping-left', [25.25, 6.94, 52], [22.5, 0.28, 1.08], 'roof');
  addBox(boxes, 'portal-wall-coping-right', [49.75, 6.94, 52], [16.5, 0.28, 1.08], 'roof');
  addBox(boxes, 'portal-wall-coping-east', [89, 6.94, 52], [62, 0.28, 1.08], 'roof');

  // Balcon sin escalera: top de deck exactamente a y=4.0. Las columnas son
  // verticales y lisas; no hay cajas, diagonales ni salientes que permitan
  // trepar desde el patio. El borde este queda abierto hacia el portal.
  addBox(boxes, 'portal-balcony-deck', [49.5, 3.8, 66], [10.5, 0.4, 14], 'metalRusted');
  const supports: Vec2[] = [[44.8, 59.5], [44.8, 72.5], [54.1, 59.5], [54.1, 72.5]];
  supports.forEach(([x, z], index) => {
    addBox(boxes, `portal-balcony-support-${index}`, [x, 1.9, z], [0.34, 3.8, 0.34], 'metalRusted');
    addBox(boxes, `portal-balcony-foot-${index}`, [x, 0.12, z], [0.72, 0.24, 0.72], 'concrete');
  });
  addBox(boxes, 'portal-balcony-rail-west-low', [44.2, 4.56, 66], [0.14, 0.14, 14], 'metalRusted');
  addBox(boxes, 'portal-balcony-rail-west-high', [44.2, 5.22, 66], [0.14, 0.14, 14], 'metalRusted');
  addBox(boxes, 'portal-balcony-rail-north-low', [49.4, 4.56, 73.05], [10.55, 0.14, 0.14], 'metalRusted');
  addBox(boxes, 'portal-balcony-rail-north-high', [49.4, 5.22, 73.05], [10.55, 0.14, 0.14], 'metalRusted');
  addBox(boxes, 'portal-balcony-rail-south-low', [49.4, 4.56, 58.95], [10.55, 0.14, 0.14], 'metalRusted');
  addBox(boxes, 'portal-balcony-rail-south-high', [49.4, 5.22, 58.95], [10.55, 0.14, 0.14], 'metalRusted');
  for (const [index, z] of [59.1, 62.5, 66, 69.5, 72.9].entries()) {
    addBox(boxes, `portal-balcony-rail-post-west-${index}`, [44.2, 4.62, z], [0.16, 1.35, 0.16], 'metalRusted');
  }
  for (const [index, x] of [44.3, 47.7, 51.1, 54.6].entries()) {
    addBox(boxes, `portal-balcony-rail-post-n-${index}`, [x, 4.62, 73.05], [0.16, 1.35, 0.16], 'metalRusted');
    addBox(boxes, `portal-balcony-rail-post-s-${index}`, [x, 4.62, 58.95], [0.16, 1.35, 0.16], 'metalRusted');
  }

  // Una unica caja coplanar, continua y sin trim delante: 10.5 m de ancho por
  // 9.6 m de alto, mas que suficiente para validar el ovalo completo.
  addBox(boxes, 'portal-target-wall', [55, 5.4, 66], [0.5, 9.6, 10.5], 'concrete');
  addBox(boxes, 'portal-target-frame-n', [55, 5.4, 72.0], [0.78, 10.3, 0.55], 'signalBlue');
  addBox(boxes, 'portal-target-frame-s', [55, 5.4, 60.0], [0.78, 10.3, 0.55], 'signalRed');
  addBox(boxes, 'portal-target-header', [55, 10.45, 66], [0.78, 0.5, 11.6], 'trim');
  addBox(boxes, 'portal-target-beacon', [54.55, 9.8, 66], [0.12, 0.42, 1.2], 'lightWarm');

  // Señaletica diegetica de cuarentena/portales; no invade la cara objetivo.
  addBox(boxes, 'portal-sign-entry-panel', [14.45, 4.7, 80.2], [0.08, 1.5, 3.0], 'signalRed');
  addBox(boxes, 'portal-sign-entry-stripe-a', [14.4, 4.7, 79.5], [0.04, 1.8, 0.18], 'hazard', [0.3, 0, 0]);
  addBox(boxes, 'portal-sign-entry-stripe-b', [14.4, 4.7, 80.9], [0.04, 1.8, 0.18], 'hazard', [-0.3, 0, 0]);
  addBox(boxes, 'portal-sign-gate', [29, 4.8, 51.55], [4.8, 1.05, 0.08], 'signalBlue');
  addBox(boxes, 'portal-sign-gate-light', [29, 5.45, 51.5], [3.5, 0.12, 0.1], 'lightWarm');
  addBox(boxes, 'portal-wall-lamp-n-base', [31, 5.7, 81.55], [0.8, 0.28, 0.28], 'metalRusted');
  addBox(boxes, 'portal-wall-lamp-n-glow', [31, 5.35, 81.35], [0.54, 0.22, 0.3], 'lightWarm');
  addBox(boxes, 'portal-wall-lamp-w-base', [14.45, 5.7, 60], [0.28, 0.28, 0.8], 'metalRusted');
  addBox(boxes, 'portal-wall-lamp-w-glow', [14.65, 5.35, 60], [0.3, 0.22, 0.54], 'lightWarm');
}

function addRailLine(boxes: StaticBoxDefinition[], id: string, from: Vec2, to: Vec2): void {
  const { center, length, yaw, right } = segmentData(from, to);
  for (const side of [-1, 1] as const) {
    addBox(
      boxes,
      `rail-${id}-${side < 0 ? 'l' : 'r'}`,
      [center[0] + right[0] * side * 0.82, 0.14, center[1] + right[1] * side * 0.82],
      [0.13, 0.18, length],
      'metalRusted',
      [0, yaw, 0],
    );
  }
  const sleepers = Math.max(2, Math.ceil(length / 2.1));
  for (let i = 0; i <= sleepers; i += 1) {
    const t = i / sleepers;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    addBox(boxes, `rail-${id}-sleeper-${i}`, [x, 0.075, z], [2.5, 0.11, 0.24], 'woodDark', [0, yaw, 0]);
  }
}

function addRailWagon(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  addBox(boxes, `wagon-${id}-undercarriage`, [at[0], 0.58, at[1]], [3.2, 0.55, 10.8], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `wagon-${id}-body`, [at[0], 1.75, at[1]], [3.6, 2.1, 11.2], 'signalRed', [0, yaw, 0.015]);
  addBox(boxes, `wagon-${id}-roof`, [at[0], 2.93, at[1]], [3.85, 0.28, 11.55], 'metalRusted', [0, yaw, 0]);
  for (const [index, z] of [-3.55, 0, 3.55].entries()) {
    const sideA = localXZ(at, yaw, -1.84, z);
    const sideB = localXZ(at, yaw, 1.84, z);
    addBox(boxes, `wagon-${id}-brace-a-${index}`, [sideA[0], 1.65, sideA[1]], [0.12, 1.75, 2.5], 'trim', [0, yaw, 0]);
    addBox(boxes, `wagon-${id}-brace-b-${index}`, [sideB[0], 1.65, sideB[1]], [0.12, 1.75, 2.5], 'trim', [0, yaw, 0]);
  }
  for (const [index, z] of [-3.2, 3.2].entries()) {
    const axle = localXZ(at, yaw, 0, z);
    addBox(boxes, `wagon-${id}-axle-${index}`, [axle[0], 0.32, axle[1]], [4.0, 0.38, 0.55], 'floor', [0, yaw, 0]);
  }
  const door = localXZ(at, yaw, -1.86, 0);
  addBox(boxes, `wagon-${id}-door`, [door[0], 1.72, door[1]], [0.08, 1.75, 3.2], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `wagon-${id}-door-handle`, [door[0] - 0.06, 1.7, door[1] - 1.18], [0.12, 0.72, 0.12], 'lightWarm', [0, yaw, 0]);
}

function addCatwalk(boxes: StaticBoxDefinition[], id: string, from: Vec2, to: Vec2, y: number): void {
  const { center, length, yaw, right } = segmentData(from, to);
  addBox(boxes, `catwalk-${id}-deck`, [center[0], y, center[1]], [2.5, 0.24, length], 'metalRusted', [0, yaw, 0]);
  for (const side of [-1, 1] as const) {
    const x = center[0] + right[0] * side * 1.2;
    const z = center[1] + right[1] * side * 1.2;
    addBox(boxes, `catwalk-${id}-rail-${side}-low`, [x, y + 0.72, z], [0.12, 0.12, length], 'metalRusted', [0, yaw, 0]);
    addBox(boxes, `catwalk-${id}-rail-${side}-high`, [x, y + 1.35, z], [0.12, 0.12, length], 'metalRusted', [0, yaw, 0]);
  }
  const supports = Math.max(2, Math.ceil(length / 6));
  for (let i = 0; i <= supports; i += 1) {
    const t = i / supports;
    const px = from[0] + (to[0] - from[0]) * t;
    const pz = from[1] + (to[1] - from[1]) * t;
    addBox(boxes, `catwalk-${id}-post-${i}-l`, [px + right[0] * 1.15, y / 2, pz + right[1] * 1.15], [0.18, y, 0.18], 'metalRusted');
    addBox(boxes, `catwalk-${id}-post-${i}-r`, [px - right[0] * 1.15, y / 2, pz - right[1] * 1.15], [0.18, y, 0.18], 'metalRusted');
  }
}

function addMacroTopology(boxes: StaticBoxDefinition[]): void {
  // Segunda esclusa urbana. Une el muro oeste con la medianera este y deja un
  // boquete de doce metros en x=44..56: desde el osario se ve la estacion,
  // pero solo se llega a ella atravesando el sector de techos/pasarelas.
  addBox(boxes, 'district-mid-wall-west', [-38, 4.2, -20], [164, 8.4, 1.0], 'rock');
  addBox(boxes, 'district-mid-wall-east', [88, 4.2, -20], [64, 8.4, 1.0], 'brick');
  addBox(boxes, 'district-mid-gap-jamb-w', [43.5, 3.1, -20], [1.0, 6.2, 1.55], 'concrete');
  addBox(boxes, 'district-mid-gap-jamb-e', [56.5, 3.1, -20], [1.0, 6.2, 1.55], 'concrete');
  addBox(boxes, 'district-mid-gap-pipe', [50, 6.65, -20], [13.2, 0.42, 0.42], 'metalRusted');
  for (const [index, x] of [-112, -96, -80, -64, -48, -32, -16, 0, 16, 32, 68, 84, 100, 116].entries()) {
    addBox(boxes, `district-mid-buttress-${index}`, [x, 2.9, -19.35], [1.15, 5.8, 1.5], index < 10 ? 'concrete' : 'brick');
  }
  addBox(boxes, 'district-mid-coping-west', [-38, 8.56, -20], [164, 0.32, 1.35], 'roof');
  addBox(boxes, 'district-mid-coping-east', [88, 8.56, -20], [64, 0.32, 1.35], 'roof');

  // Tercera division, diagonal y perpendicular a la cinta estacion-holdout.
  // Se engancha al muro del patio en (-73,52) y sale por el limite sur; por lo
  // tanto no existe un borde libre que permita rodearla.
  const gate: Vec2 = [-16, -58.5];
  const gateYaw = -2.05;
  const negativeStart = -114;
  const negativeEnd = -2.9;
  const positiveStart = 2.9;
  const positiveEnd = 124;
  const negCenterLocal = (negativeStart + negativeEnd) / 2;
  const posCenterLocal = (positiveStart + positiveEnd) / 2;
  const negCenter = localXZ(gate, gateYaw, negCenterLocal, 0);
  const posCenter = localXZ(gate, gateYaw, posCenterLocal, 0);
  addBox(boxes, 'holdout-barrier-south', [negCenter[0], 3.8, negCenter[1]], [negativeEnd - negativeStart, 7.6, 0.95], 'brick', [0, gateYaw, 0]);
  addBox(boxes, 'holdout-barrier-north', [posCenter[0], 3.8, posCenter[1]], [positiveEnd - positiveStart, 7.6, 0.95], 'brick', [0, gateYaw, 0]);
  for (const [index, localX] of [-108, -92, -76, -60, -44, -28, -12, 12, 28, 44, 60, 76, 92, 108, 122].entries()) {
    const p = localXZ(gate, gateYaw, localX, 0.58);
    addBox(boxes, `holdout-barrier-buttress-${index}`, [p[0], 2.75, p[1]], [1.25, 5.5, 1.5], 'concrete', [0, gateYaw, 0]);
  }
  const jambLeft = localXZ(gate, gateYaw, -3.3, 0);
  const jambRight = localXZ(gate, gateYaw, 3.3, 0);
  addBox(boxes, 'holdout-gate-jamb-left', [jambLeft[0], 3.7, jambLeft[1]], [0.8, 7.4, 1.45], 'concrete', [0, gateYaw, 0]);
  addBox(boxes, 'holdout-gate-jamb-right', [jambRight[0], 3.7, jambRight[1]], [0.8, 7.4, 1.45], 'concrete', [0, gateYaw, 0]);
  addBox(boxes, 'holdout-gate-lintel', [gate[0], 6.45, gate[1]], [5.8, 2.3, 1.15], 'concrete', [0, gateYaw, 0]);
  const gateSign = localXZ(gate, gateYaw, 0, -0.62);
  addBox(boxes, 'holdout-gate-sign', [gateSign[0], 6.6, gateSign[1]], [4.4, 0.72, 0.08], 'signalRed', [0, gateYaw, 0]);

  // Ultima terraza: un corte de roca conecta el limite oeste con la barrera
  // diagonal en x≈4. El sendero hacia la mina conserva un hueco de seis metros.
  addBox(boxes, 'mine-terrace-west', [-95, 4.5, -97], [50, 9.0, 1.2], 'rock');
  addBox(boxes, 'mine-terrace-east', [-30, 4.5, -97], [68, 9.0, 1.2], 'rock');
  addBox(boxes, 'mine-gap-jamb-west', [-70.5, 3.4, -97], [1.0, 6.8, 1.8], 'concrete');
  addBox(boxes, 'mine-gap-jamb-east', [-63.5, 3.4, -97], [1.0, 6.8, 1.8], 'concrete');
  for (const [index, x] of [-116, -106, -96, -86, -76, -58, -46, -34, -22, -10, 2].entries()) {
    addBox(boxes, `mine-terrace-stratum-${index}`, [x, 5.5 + (index % 2) * 0.45, -96.25], [8.5, 0.65, 0.3], index % 3 === 0 ? 'brick' : 'rock', [0, 0, (index % 2 ? -1 : 1) * 0.035]);
  }
}

function addIndustrialMachine(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const front = localXZ(at, yaw, 0, -1.05);
  const rear = localXZ(at, yaw, 0, 1.0);
  addBox(boxes, `machine-${id}-skid`, [at[0], 0.16, at[1]], [3.4, 0.32, 3.1], 'concrete', [0, yaw, 0]);
  addBox(boxes, `machine-${id}-motor`, [rear[0], 1.05, rear[1]], [2.0, 1.65, 1.55], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `machine-${id}-housing`, [front[0], 0.92, front[1]], [2.2, 1.4, 1.05], 'trim', [0, yaw, 0]);
  addBox(boxes, `machine-${id}-cap`, [front[0], 1.78, front[1]], [1.72, 0.22, 0.82], 'signalRed', [0, yaw, 0]);
  const pipe = localXZ(at, yaw, 0, -2.05);
  addBox(boxes, `machine-${id}-pipe`, [pipe[0], 1.2, pipe[1]], [0.48, 0.48, 1.8], 'metalRusted', [0, yaw, 0]);
  const gauge = localXZ(at, yaw, 0.82, -1.5);
  addBox(boxes, `machine-${id}-gauge-stem`, [gauge[0], 1.75, gauge[1]], [0.12, 0.75, 0.12], 'trim');
  addBox(boxes, `machine-${id}-gauge`, [gauge[0], 2.1, gauge[1]], [0.5, 0.5, 0.12], 'lightWarm', [0, yaw, 0]);
}

function addPipeGantry(boxes: StaticBoxDefinition[], id: string, center: Vec2, width: number): void {
  const leftX = center[0] - width / 2;
  const rightX = center[0] + width / 2;
  addBox(boxes, `gantry-${id}-foot-l`, [leftX, 0.18, center[1]], [0.85, 0.36, 0.85], 'concrete');
  addBox(boxes, `gantry-${id}-foot-r`, [rightX, 0.18, center[1]], [0.85, 0.36, 0.85], 'concrete');
  addBox(boxes, `gantry-${id}-post-l`, [leftX, 3.2, center[1]], [0.28, 6.1, 0.28], 'metalRusted');
  addBox(boxes, `gantry-${id}-post-r`, [rightX, 3.2, center[1]], [0.28, 6.1, 0.28], 'metalRusted');
  addBox(boxes, `gantry-${id}-beam`, [center[0], 6.05, center[1]], [width + 0.5, 0.3, 0.35], 'metalRusted');
  addBox(boxes, `gantry-${id}-pipe-a`, [center[0], 5.35, center[1]], [width + 0.2, 0.4, 0.4], 'metalRusted');
  addBox(boxes, `gantry-${id}-pipe-b`, [center[0], 4.78, center[1]], [width + 0.2, 0.3, 0.3], 'signalRed');
  for (const x of [leftX + 2.2, center[0], rightX - 2.2]) {
    addBox(boxes, `gantry-${id}-hanger-${x}`, [x, 5.45, center[1]], [0.12, 1.15, 0.12], 'trim');
  }
}

function addMineDressing(boxes: StaticBoxDefinition[]): void {
  // La mina principal empieza en z=-107. Estos marcos y rieles preparan su
  // entrada norte sin ocupar el volumen jugable x=-95..-73,z=-129..-107.
  addRailLine(boxes, 'mine-approach-a', [-67, -97], [-76.5, -105]);
  addRailLine(boxes, 'mine-approach-b', [-76.5, -105], [-84, -106.2]);
  for (const [index, z] of [-100.0, -103.2, -105.7].entries()) {
    const x = -70.6 - index * 5.1;
    addBox(boxes, `mine-timber-${index}-left`, [x - 3.4, 2.45, z], [0.4, 4.9, 0.5], 'woodDark', [0, -0.5, 0]);
    addBox(boxes, `mine-timber-${index}-right`, [x + 3.4, 2.45, z], [0.4, 4.9, 0.5], 'woodDark', [0, -0.5, 0]);
    addBox(boxes, `mine-timber-${index}-top`, [x, 4.75, z], [7.2, 0.45, 0.55], 'woodDark', [0, -0.5, 0.03]);
  }
  addBox(boxes, 'mine-warning-frame', [-79.2, 4.15, -104.7], [5.2, 1.25, 0.24], 'hazard', [0, -0.5, 0]);
  addBox(boxes, 'mine-warning-lamp', [-79.2, 4.2, -104.55], [0.7, 0.35, 0.14], 'lightWarm', [0, -0.5, 0]);

  addBox(boxes, 'mine-cart-bed', [-70.5, 0.72, -108.5], [2.0, 0.7, 3.0], 'metalRusted', [0, 0.18, 0.04]);
  addBox(boxes, 'mine-cart-load', [-70.5, 1.28, -108.5], [1.65, 0.72, 2.45], 'rock', [0.08, 0.18, -0.08]);
  for (const [index, z] of [-1.0, 1.0].entries()) {
    addBox(boxes, `mine-cart-axle-${index}`, [-70.5, 0.34, -108.5 + z], [2.45, 0.3, 0.42], 'floor', [0, 0.18, 0]);
  }
  addBox(boxes, 'mine-rockpile-west-a', [-101, 1.15, -112], [8.5, 2.3, 8.5], 'rock', [0.08, 0.25, -0.12]);
  addBox(boxes, 'mine-rockpile-west-b', [-105, 2.0, -121], [7.5, 4.0, 10], 'rock', [-0.1, -0.15, 0.08]);
  addBox(boxes, 'mine-rockpile-east-a', [-66, 1.3, -118], [7.5, 2.6, 12], 'rock', [0.1, -0.3, 0.07]);
  addBox(boxes, 'mine-ore-crate-a', [-101, 0.55, -101], [1.3, 1.1, 1.3], 'crate', [0, 0.17, 0]);
  addBox(boxes, 'mine-ore-crate-b', [-99.5, 0.4, -101.4], [1.05, 0.8, 1.05], 'crate', [0, -0.12, 0]);
}

function buildDemo2DetailBoxes(): StaticBoxDefinition[] {
  const boxes: StaticBoxDefinition[] = [];

  // La calle nunca atraviesa los volumenes principales. En crematorio y
  // capilla se corta en sus accesos y reaparece al otro lado, dejando al main
  // level decidir interiores, puertas y encuentros.
  const roads: RoadRibbonSpec[] = [
    { id: 'arrival-apron', from: [-106, 151], to: [-92, 140], width: 8.4, sidewalkWidth: 1.55 },
    { id: 'arrival-bend', from: [-92, 140], to: [-73, 135] },
    { id: 'crem-north', from: [-73, 135], to: [-49, 122] },
    { id: 'crem-square', from: [-49, 122], to: [-48, 106] },
    { id: 'chapel-approach-a', from: [-48, 106], to: [-31, 100] },
    { id: 'chapel-approach-b', from: [-31, 100], to: [-23.2, 94] },
    { id: 'chapel-exit-a', from: [3.2, 86], to: [8.5, 80] },
    { id: 'chapel-exit-b', from: [8.5, 80], to: [14, 74], width: 8.8, sidewalkWidth: 1.55 },
    { id: 'portal-gate-exit', from: [39, 50.5], to: [47, 43] },
    { id: 'ossuary-approach', from: [47, 43], to: [60, 31] },
    { id: 'ossuary-roofs-a', from: [60, 31], to: [63, 15] },
    { id: 'ossuary-roofs-b', from: [63, 15], to: [60, -5] },
    { id: 'roofs-mid-gate', from: [60, -5], to: [50, -20], width: 8.8, sidewalkWidth: 1.55 },
    { id: 'mid-gate-station', from: [50, -20], to: [10, -45] },
    { id: 'station-holdout', from: [10, -45], to: [-42, -72], width: 10.4, sidewalkWidth: 1.65 },
    { id: 'holdout-mine-a', from: [-42, -72], to: [-61, -88] },
    { id: 'holdout-mine-b', from: [-61, -88], to: [-67, -97], width: 8.8, sidewalkWidth: 1.5 },
    { id: 'mine-approach', from: [-67, -97], to: [-84, -106.1], width: 8.4, sidewalkWidth: 1.4 },
  ];
  roads.forEach((road) => addRoadRibbon(boxes, road));

  // Ensanches irregulares. Sus centros quedan despejados para NPCs, traps y
  // fisica; la decoracion pesada se apoya en los bordes.
  const hubSlabs: Array<[string, Vec3, Vec3, Material, number]> = [
    ['arrival', [-92, 0.05, 140], [22, 0.1, 17], 'asphalt', -0.1],
    ['crematorium', [-48, 0.055, 106], [30, 0.11, 25], 'concrete', 0.05],
    ['chapel-west', [-27, 0.05, 94], [16, 0.1, 16], 'asphalt', -0.12],
    ['chapel-east', [8, 0.05, 82], [15, 0.1, 15], 'asphalt', 0.09],
    ['ossuary-west', [57, 0.055, 31], [21, 0.11, 22], 'concrete', -0.05],
    ['rooftop-court', [60, 0.05, -5], [22, 0.1, 19], 'asphalt', 0.08],
    ['station-west', [2, 0.05, -45], [22, 0.1, 27], 'asphalt', -0.04],
    ['holdout', [-42, 0.05, -72], [32, 0.1, 27], 'concrete', 0.07],
    ['mine-switchback', [-61, 0.05, -88], [17, 0.1, 14], 'asphalt', -0.18],
    ['mine-mouth', [-75, 0.05, -102], [23, 0.1, 13], 'rock', 0.09],
  ];
  hubSlabs.forEach(([id, position, size, material, yaw]) => {
    addBox(boxes, `hub-${id}`, position, size, material, [0, yaw, 0]);
  });

  addCrosswalk(boxes, 'arrival', [-91, 140], 1.32, 5);
  addCrosswalk(boxes, 'crematorium', [-48, 112], 0, 7);
  addCrosswalk(boxes, 'chapel-west', [-30, 99], 1.23, 5);
  addCrosswalk(boxes, 'ossuary', [55, 35], 0.83, 6);
  addCrosswalk(boxes, 'roofs', [60, -4], 2.55, 5);
  addCrosswalk(boxes, 'station', [4, -42], -2.05, 6);

  // Masa urbana de fondo: cada bloque tiene volumen, cubierta, canaletas,
  // bajadas, ventanas y reparaciones distintas. Todos evitan los footprints
  // del main (casa inicial, crematorio, capilla, osario, fabrica y mina).
  const backdrops: BackdropBuildingSpec[] = [
    { id: 'arrival-west', at: [-113, 132], width: 12, depth: 38, height: 14, stories: 3, facade: 'brick', roof: 'flat', litWindows: [3, 8] },
    { id: 'arrival-north', at: [-68, 152], width: 31, depth: 13, height: 11, stories: 2, facade: 'plaster', roof: 'gable', litWindows: [1, 7] },
    { id: 'arrival-east', at: [-51, 139], width: 18, depth: 15, height: 9.5, stories: 2, facade: 'brick', roof: 'gable', litWindows: [5] },
    { id: 'crem-far-west', at: [-109, 102], width: 18, depth: 34, height: 12.5, stories: 3, facade: 'plaster', roof: 'gable', litWindows: [2, 9] },
    { id: 'crem-north-row', at: [-35, 135], width: 34, depth: 15, height: 13, stories: 3, facade: 'brick', roof: 'gable', litWindows: [4, 12] },
    { id: 'crem-east-row', at: [-31, 120], width: 19, depth: 14, height: 10, stories: 2, facade: 'plaster', roof: 'flat', litWindows: [0, 7] },
    { id: 'chapel-west-row', at: [-41, 82], width: 20, depth: 20, height: 11.5, stories: 3, facade: 'brick', roof: 'gable', litWindows: [1, 6] },
    { id: 'chapel-north-east', at: [17, 109], width: 26, depth: 18, height: 12, stories: 3, facade: 'plaster', roof: 'gable', litWindows: [3, 10] },
    { id: 'quarantine-north', at: [36, 94], width: 42, depth: 18, height: 13.5, stories: 3, facade: 'brick', roof: 'flat', litWindows: [2, 9, 15] },
    { id: 'quarantine-west-wing', at: [-20, 60], width: 24, depth: 22, height: 10.5, stories: 2, facade: 'brick', roof: 'flat', litWindows: [3] },
    { id: 'quarantine-west-annex', at: [3, 59], width: 22, depth: 22, height: 10, stories: 2, facade: 'plaster', roof: 'flat', litWindows: [6] },
    { id: 'quarantine-east-annex', at: [68, 67], width: 20, depth: 38, height: 12.5, stories: 3, facade: 'brick', roof: 'gable', litWindows: [1, 8] },
    { id: 'ossuary-north', at: [70, 44], width: 22, depth: 10, height: 9.5, stories: 2, facade: 'plaster', roof: 'gable', litWindows: [2] },
    { id: 'roof-east-tenement', at: [99, -1], width: 28, depth: 36, height: 15, stories: 4, facade: 'brick', roof: 'gable', litWindows: [5, 14, 21] },
    { id: 'rail-east-factory', at: [81, -47], width: 34, depth: 34, height: 13, stories: 3, facade: 'brick', roof: 'flat', litWindows: [4, 11] },
    { id: 'rail-west-station', at: [-25, -34], width: 20, depth: 18, height: 9, stories: 2, facade: 'plaster', roof: 'gable', litWindows: [1, 5] },
    { id: 'holdout-west', at: [-82, -69], width: 18, depth: 29, height: 11, stories: 2, facade: 'brick', roof: 'flat', litWindows: [0] },
    { id: 'holdout-east', at: [-5, -82], width: 20, depth: 20, height: 10, stories: 2, facade: 'plaster', roof: 'gable', litWindows: [7] },
    { id: 'mine-west-service', at: [-111, -124], width: 13, depth: 48, height: 10, stories: 2, facade: 'brick', roof: 'flat', litWindows: [2] },
    { id: 'mine-south-silhouette', at: [-49, -137], width: 34, depth: 18, height: 13, stories: 3, facade: 'brick', roof: 'gable', litWindows: [8] },
  ];
  backdrops.forEach((building) => addBackdropBuilding(boxes, building));

  // Vitrinas con narrativa ambiental: raciones abandonadas, objetos de culto
  // y boleteria clausurada. Estan adosadas a fachadas, fuera de las calzadas.
  addStorefront(boxes, 'crem-rations', [-31, 112.92], 0);
  addStorefront(boxes, 'chapel-relics', [-41, 71.92], 0);
  addStorefront(boxes, 'station-tickets', [-25, -43.08], 0);

  addCrematoriumYard(boxes);
  addBelfry(boxes);
  addPortalCourtyard(boxes);
  addCemetery(boxes);
  addMacroTopology(boxes);

  // Alumbrado escaso pero repetido: cada hub tiene una referencia calida que
  // ayuda a leer la siguiente curva entre la niebla y los tejados.
  const lamps: Array<[string, Vec2, number]> = [
    ['arrival', [-101, 143], -1.0],
    ['crem-north', [-56, 126], -0.25],
    ['crem-square', [-36, 103], 2.15],
    ['chapel-west', [-27, 89], -1.45],
    ['chapel-east', [6, 89], 1.1],
    ['quarantine-entry', [18, 79.5], -2.7],
    ['ossuary-gate', [51, 41], -0.8],
    ['ossuary-south', [55, 21], 2.45],
    ['rooftops', [68, 1], 2.8],
    ['station', [1, -35], -2.25],
    ['rail-yard', [-18, -49], 1.7],
    ['holdout-north', [-52, -61], -0.4],
    ['holdout-south', [-34, -84], 2.55],
    ['mine-switchback', [-71, -91], -1.15],
  ];
  lamps.forEach(([id, at, yaw]) => addStreetLamp(boxes, id, at, yaw));

  const northPoles: Array<[string, Vec2, number]> = [
    ['arrival-a', [-116, 146], 1.3],
    ['arrival-b', [-84, 151], 1.25],
    ['crem-a', [-55, 140], 1.1],
    ['crem-b', [-28, 127], 0.95],
    ['chapel-a', [5, 119], 0.8],
    ['quarantine-a', [35, 110], 0.65],
    ['quarantine-b', [63, 94], 0.45],
  ];
  northPoles.forEach(([id, at, yaw]) => addUtilityPole(boxes, id, at, yaw));
  for (let i = 0; i < northPoles.length - 1; i += 1) {
    addCableSpan(boxes, `${northPoles[i][0]}-${northPoles[i + 1][0]}`, northPoles[i][1], northPoles[i + 1][1]);
  }

  const southPoles: Array<[string, Vec2, number]> = [
    ['ossuary', [82, 45], -0.1],
    ['roofs-east', [108, 12], -0.35],
    ['roofs-west', [78, -14], -0.7],
    ['rail-east', [57, -29], -0.95],
    ['station', [7, -24], -1.15],
    ['rail-west', [-24, -39], -1.35],
    ['holdout', [-61, -55], -1.55],
    ['mine-north', [-87, -79], -1.8],
    ['mine-south', [-104, -101], -2.0],
  ];
  southPoles.forEach(([id, at, yaw]) => addUtilityPole(boxes, id, at, yaw));
  for (let i = 0; i < southPoles.length - 1; i += 1) {
    addCableSpan(boxes, `${southPoles[i][0]}-${southPoles[i + 1][0]}`, southPoles[i][1], southPoles[i + 1][1]);
  }

  // Cementerio, techos y estacion se conectan visualmente con pasarelas altas;
  // todas estan fuera de la calzada y dejan mas de cuatro metros bajo vigas.
  addCatwalk(boxes, 'ossuary-roof-link', [84.5, 14], [84.5, -13], 4.65);
  addCatwalk(boxes, 'rail-overlook', [58, -29], [58, -64], 5.1);
  addCatwalk(boxes, 'holdout-west', [-65, -60], [-65, -85], 4.85);

  // Rieles convergentes y vagones inmoviles forman calles secundarias y vistas
  // diagonales. Los durmientes son casi rasantes y no cierran el combate.
  addRailLine(boxes, 'station-a', [-3, -25], [-17, -56]);
  addRailLine(boxes, 'station-b', [4, -27], [-10, -57]);
  addRailLine(boxes, 'holdout-a', [-25, -65], [-53, -89]);
  addRailWagon(boxes, 'station', [-9, -42], -2.72);
  addRailWagon(boxes, 'holdout', [-56, -81], -2.28);
  addBox(boxes, 'station-platform', [-20.5, 0.18, -38], [4.5, 0.36, 27], 'concrete', [0, -2.72, 0]);
  addBox(boxes, 'station-canopy', [-23.5, 4.15, -38], [4.8, 0.28, 28], 'roof', [0, -2.72, -0.04]);
  for (const [index, z] of [-47, -40, -33, -26].entries()) {
    addBox(boxes, `station-canopy-post-${index}`, [-22.6 + index * 1.15, 2.05, z], [0.2, 4.0, 0.2], 'metalRusted');
  }
  addBox(boxes, 'station-signal-pole', [2, 2.8, -57], [0.2, 5.4, 0.2], 'metalRusted');
  addBox(boxes, 'station-signal-head', [2, 4.9, -57], [0.75, 1.35, 0.5], 'trim');
  addBox(boxes, 'station-signal-red', [2, 5.18, -56.72], [0.32, 0.32, 0.05], 'signalRed');
  addBox(boxes, 'station-signal-blue', [2, 4.55, -56.72], [0.32, 0.32, 0.05], 'signalBlue');

  // Maquinaria del holdout en corona: el centro [-42,-72] sigue libre para la
  // defensa, pero bombas, tuberias y tanques cortan lineas largas en los bordes.
  addIndustrialMachine(boxes, 'holdout-west', [-59, -69], 1.55);
  addIndustrialMachine(boxes, 'holdout-south', [-25, -84], -0.45);
  addIndustrialMachine(boxes, 'rail-east', [56, -49], 0.25);
  addPipeGantry(boxes, 'holdout-north', [-42, -60], 25);
  addPipeGantry(boxes, 'holdout-south', [-42, -87], 24);
  addBox(boxes, 'holdout-tank-a', [-74, 3.2, -59], [5.2, 6.4, 5.2], 'metalRusted');
  addBox(boxes, 'holdout-tank-a-band-low', [-74, 1.3, -59], [5.5, 0.35, 5.5], 'trim');
  addBox(boxes, 'holdout-tank-a-band-high', [-74, 4.9, -59], [5.5, 0.35, 5.5], 'trim');
  addBox(boxes, 'holdout-tank-a-cap', [-74, 6.55, -59], [5.6, 0.35, 5.6], 'roof');
  addBox(boxes, 'holdout-tank-b', [-72, 2.6, -72], [4.4, 5.2, 4.4], 'metalRusted');
  addBox(boxes, 'holdout-tank-b-band', [-72, 3.65, -72], [4.7, 0.32, 4.7], 'trim');
  addBox(boxes, 'holdout-tank-link', [-73, 3.0, -65.5], [0.48, 0.48, 9.0], 'metalRusted');
  addBox(boxes, 'holdout-control-cabinet', [-57, 1.35, -83], [2.4, 2.7, 1.2], 'wall', [0, -0.1, 0]);
  addBox(boxes, 'holdout-control-face', [-57, 1.55, -82.37], [1.55, 0.9, 0.05], 'signalBlue', [0, -0.1, 0]);
  addBox(boxes, 'holdout-control-warning', [-57.55, 2.25, -82.32], [0.22, 0.22, 0.05], 'signalRed', [0, -0.1, 0]);

  addMineDressing(boxes);

  addWreckedCar(boxes, 'arrival', [-103, 136], 1.25);
  addWreckedCar(boxes, 'ossuary', [43, 35], 0.78);
  addWreckedCar(boxes, 'rail-yard', [25, -68], -0.6);
  addFuneralCart(boxes, 'crematorium', [-38, 116], 0.12);

  // Microhistorias de borde: valijas en la llegada, altar improvisado frente
  // a la capilla y herramientas abandonadas antes de la mina.
  addBox(boxes, 'arrival-luggage-a', [-82, 0.38, 145], [0.9, 0.76, 0.62], 'crate', [0, 0.18, 0]);
  addBox(boxes, 'arrival-luggage-b', [-80.85, 0.28, 145.3], [0.72, 0.56, 0.5], 'signalRed', [0, -0.12, 0]);
  addBox(boxes, 'arrival-luggage-handle', [-80.85, 0.7, 145.3], [0.34, 0.3, 0.06], 'metalRusted');
  addBox(boxes, 'chapel-memorial-plinth', [-27.5, 0.44, 79], [1.8, 0.88, 1.8], 'concrete');
  addBox(boxes, 'chapel-memorial-cross-v', [-27.5, 1.7, 79], [0.34, 1.75, 0.34], 'woodDark', [0.04, 0, -0.04]);
  addBox(boxes, 'chapel-memorial-cross-h', [-27.5, 2.0, 79], [1.25, 0.28, 0.3], 'woodDark');
  for (const [index, x] of [-28.3, -27.8, -27.1, -26.55].entries()) {
    addBox(boxes, `chapel-memorial-candle-${index}`, [x, 0.18, 77.9], [0.1, 0.36 + index * 0.04, 0.1], 'lightWarm');
  }
  addBox(boxes, 'mine-tool-rack', [-58, 1.35, -103], [0.35, 2.7, 3.8], 'woodDark');
  addBox(boxes, 'mine-tool-pick-a', [-57.78, 1.65, -103.7], [0.12, 1.75, 0.12], 'metalRusted', [0.45, 0, 0]);
  addBox(boxes, 'mine-tool-pick-b', [-57.75, 1.55, -102.3], [0.12, 1.65, 0.12], 'metalRusted', [-0.42, 0, 0]);

  // Escombro concentrado en esquinas: sugiere colapso sin convertir la ruta en
  // un slalom de colisionadores ni crear una escalera accidental al balcon.
  addDebrisCluster(boxes, 'arrival', [-105, 126], -0.5);
  addDebrisCluster(boxes, 'crematorium', [-31, 102], 0.3);
  addDebrisCluster(boxes, 'chapel', [7, 96], 1.2);
  addDebrisCluster(boxes, 'ossuary', [47, 20], -0.8);
  addDebrisCluster(boxes, 'rooftops', [72, -11], 0.55);
  addDebrisCluster(boxes, 'station', [14, -29], -1.05);
  addDebrisCluster(boxes, 'holdout', [-28, -63], 0.75);
  addDebrisCluster(boxes, 'mine', [-57, -92], -0.35);

  return boxes;
}

/**
 * Geometria secundaria modular del rediseño de Demo 2. Los IDs usan `d2-`
 * para convivir con puertas, NPCs, triggers y edificios declarados en el mapa
 * principal sin colisiones de namespace.
 */
export const DEMO2_DETAIL_BOXES: StaticBoxDefinition[] = buildDemo2DetailBoxes();

/**
 * Batch semántico para que el editor/Workshop trate las 2.000+ piezas de arte
 * modular como una sola unidad preconstruida. LevelLoader sigue entregando
 * cada caja al renderer, física y navegación; sólo evitamos convertir cada
 * moldura, cable o durmiente en una entidad editable independiente.
 *
 * El envelope queda deliberadamente fuera del mundo jugable: este artefacto
 * no representa una habitación que la IA pueda breachear, sino el shell del
 * distrito. Los seis edificios jugables conservan sus rooms/doorways reales.
 */
export const DEMO2_DETAIL_ARTIFACT: BuildingArtifact = {
  id: 'd2-detail-district-shell',
  boxes: DEMO2_DETAIL_BOXES,
  doorways: [],
  rooms: [],
  envelope: {
    min: [-1000, -1000, -1000],
    max: [-999, -999, -999],
  },
};
