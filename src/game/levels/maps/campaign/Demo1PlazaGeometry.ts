import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';

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

const HALF_PI = Math.PI / 2;

function addBox(
  boxes: StaticBoxDefinition[],
  id: string,
  position: Vec3,
  size: Vec3,
  material: Material,
  rotation?: Rotation,
): void {
  boxes.push({
    id: `d1-${id}`,
    position,
    size,
    material,
    ...(rotation ? { rotation } : {}),
  });
}

/** Transforma un offset local X/Z usando el mismo yaw de una caja. */
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
 * Cinta vial completa. El asfalto deja siempre 8.8 m libres y las veredas
 * elevan solo 18 cm; los cordones marcan el borde sin convertir el loop en un
 * corredor cerrado.
 */
function addRoadRibbon(boxes: StaticBoxDefinition[], spec: RoadRibbonSpec): void {
  const { center, length, yaw, right } = segmentData(spec.from, spec.to);
  const width = spec.width ?? 8.8;
  const sidewalkWidth = spec.sidewalkWidth ?? 1.9;
  const sidewalkOffset = width / 2 + sidewalkWidth / 2 + 0.18;
  const curbOffset = width / 2 + 0.1;

  addBox(boxes, `road-${spec.id}`, [center[0], 0.035, center[1]], [width, 0.07, length + 1.4], 'asphalt', [0, yaw, 0]);
  for (const side of [-1, 1] as const) {
    const tag = side < 0 ? 'l' : 'r';
    addBox(
      boxes,
      `walk-${spec.id}-${tag}`,
      [center[0] + right[0] * sidewalkOffset * side, 0.09, center[1] + right[1] * sidewalkOffset * side],
      [sidewalkWidth, 0.18, length + 0.8],
      'concrete',
      [0, yaw, 0],
    );
    addBox(
      boxes,
      `curb-${spec.id}-${tag}`,
      [center[0] + right[0] * curbOffset * side, 0.15, center[1] + right[1] * curbOffset * side],
      [0.2, 0.3, length + 0.9],
      'concrete',
      [0, yaw, 0],
    );
  }
}

function addCrosswalk(
  boxes: StaticBoxDefinition[],
  id: string,
  center: Vec2,
  yaw: number,
  stripes = 5,
): void {
  for (let i = 0; i < stripes; i += 1) {
    const along = (i - (stripes - 1) / 2) * 0.86;
    const at = localXZ(center, yaw, 0, along);
    addBox(boxes, `crosswalk-${id}-${i}`, [at[0], 0.082, at[1]], [7.5, 0.025, 0.46], 'concrete', [0, yaw, 0]);
  }
}

function addStreetLamp(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const arm = localXZ(at, yaw, 0.58, 0);
  const head = localXZ(at, yaw, 1.12, 0);
  addBox(boxes, `lamp-${id}-base`, [at[0], 0.14, at[1]], [0.52, 0.28, 0.52], 'metalRusted');
  addBox(boxes, `lamp-${id}-pole`, [at[0], 2.7, at[1]], [0.16, 5.15, 0.16], 'metalRusted');
  addBox(boxes, `lamp-${id}-arm`, [arm[0], 5.18, arm[1]], [1.25, 0.12, 0.12], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `lamp-${id}-hood`, [head[0], 5.08, head[1]], [0.62, 0.18, 0.34], 'trim', [0, yaw, 0]);
  addBox(boxes, `lamp-${id}-glow`, [head[0], 4.97, head[1]], [0.46, 0.035, 0.23], 'lightWarm', [0, yaw, 0]);
}

function addUtilityPole(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const left = localXZ(at, yaw, -0.72, 0);
  const right = localXZ(at, yaw, 0.72, 0);
  addBox(boxes, `utility-${id}-foot`, [at[0], 0.18, at[1]], [0.6, 0.36, 0.6], 'concrete');
  addBox(boxes, `utility-${id}-pole`, [at[0], 3.75, at[1]], [0.22, 7.5, 0.22], 'woodDark');
  addBox(boxes, `utility-${id}-cross`, [at[0], 7.05, at[1]], [1.9, 0.16, 0.18], 'woodDark', [0, yaw, 0]);
  addBox(boxes, `utility-${id}-ins-l`, [left[0], 7.22, left[1]], [0.13, 0.3, 0.13], 'signalBlue');
  addBox(boxes, `utility-${id}-ins-r`, [right[0], 7.22, right[1]], [0.13, 0.3, 0.13], 'signalBlue');
}

/** Tres tramos a distinta altura sugieren la catenaria sin curvas ni azar. */
function addCableSpan(boxes: StaticBoxDefinition[], id: string, from: Vec2, to: Vec2): void {
  const oneThird: Vec2 = [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3];
  const twoThirds: Vec2 = [from[0] + (to[0] - from[0]) * 2 / 3, from[1] + (to[1] - from[1]) * 2 / 3];
  const parts: Array<[Vec2, Vec2, number]> = [
    [from, oneThird, 7.05],
    [oneThird, twoThirds, 6.76],
    [twoThirds, to, 7.05],
  ];
  parts.forEach(([a, b, y], index) => {
    const { center, length, yaw } = segmentData(a, b);
    addBox(boxes, `cable-${id}-${index}`, [center[0], y, center[1]], [0.045, 0.045, length + 0.08], 'metalRusted', [0, yaw, 0]);
  });
}

function addMarketStall(
  boxes: StaticBoxDefinition[],
  id: string,
  at: Vec2,
  yaw: number,
  canopy: Material,
): void {
  const postOffsets: Vec2[] = [[-1.75, -1.25], [1.75, -1.25], [-1.75, 1.25], [1.75, 1.25]];
  postOffsets.forEach(([x, z], index) => {
    const p = localXZ(at, yaw, x, z);
    addBox(boxes, `market-${id}-post-${index}`, [p[0], 1.35, p[1]], [0.12, 2.7, 0.12], 'woodDark', [0, yaw, 0]);
  });
  addBox(boxes, `market-${id}-canopy`, [at[0], 2.72, at[1]], [3.9, 0.16, 2.9], canopy, [0, yaw, 0.04]);
  const counter = localXZ(at, yaw, 0, -0.72);
  addBox(boxes, `market-${id}-counter`, [counter[0], 0.92, counter[1]], [3.15, 0.18, 0.62], 'woodDark', [0, yaw, 0]);
  const shelf = localXZ(at, yaw, 0, 1.08);
  addBox(boxes, `market-${id}-shelf`, [shelf[0], 1.25, shelf[1]], [3.2, 2.15, 0.18], 'crate', [0, yaw, 0]);
  const crateA = localXZ(at, yaw, -1.15, -1.75);
  const crateB = localXZ(at, yaw, 1.1, -1.66);
  addBox(boxes, `market-${id}-crate-a`, [crateA[0], 0.38, crateA[1]], [0.72, 0.72, 0.72], 'crate', [0, yaw + 0.08, 0]);
  addBox(boxes, `market-${id}-crate-b`, [crateB[0], 0.27, crateB[1]], [0.86, 0.54, 0.62], 'crate', [0, yaw - 0.12, 0]);
}

function addBlankSign(
  boxes: StaticBoxDefinition[],
  id: string,
  at: Vec2,
  yaw: number,
  face: Material,
): void {
  addBox(boxes, `sign-${id}-foot`, [at[0], 0.1, at[1]], [0.68, 0.2, 0.58], 'concrete');
  addBox(boxes, `sign-${id}-pole`, [at[0], 1.65, at[1]], [0.13, 3.1, 0.13], 'metalRusted');
  addBox(boxes, `sign-${id}-panel`, [at[0], 2.72, at[1]], [2.15, 0.98, 0.13], 'trim', [0, yaw, 0]);
  const inset = localXZ(at, yaw, 0, -0.075);
  addBox(boxes, `sign-${id}-face`, [inset[0], 2.72, inset[1]], [1.86, 0.7, 0.025], face, [0, yaw, 0]);
}

function addWreckedCar(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const hood = localXZ(at, yaw, 0, -1.38);
  const trunk = localXZ(at, yaw, 0, 1.46);
  const cabin = localXZ(at, yaw, 0, 0.05);
  addBox(boxes, `car-${id}-chassis`, [at[0], 0.36, at[1]], [2.05, 0.36, 4.3], 'metalRusted', [0, yaw, 0.018]);
  addBox(boxes, `car-${id}-hood`, [hood[0], 0.7, hood[1]], [1.9, 0.38, 1.25], 'signalRed', [0, yaw, -0.055]);
  addBox(boxes, `car-${id}-trunk`, [trunk[0], 0.72, trunk[1]], [1.92, 0.42, 1.0], 'signalRed', [0, yaw, 0.03]);
  addBox(boxes, `car-${id}-cabin`, [cabin[0], 1.05, cabin[1]], [1.72, 0.82, 1.65], 'wall', [0, yaw, 0]);
  const windscreen = localXZ(at, yaw, 0, -0.78);
  addBox(boxes, `car-${id}-glass`, [windscreen[0], 1.2, windscreen[1]], [1.48, 0.55, 0.08], 'signalBlue', [0.25, yaw, 0]);
  for (const [index, [x, z]] of [[-1.03, -1.28], [1.03, -1.28], [-1.03, 1.28], [1.03, 1.28]].entries()) {
    const wheel = localXZ(at, yaw, x, z);
    addBox(boxes, `car-${id}-wheel-${index}`, [wheel[0], 0.35, wheel[1]], [0.34, 0.65, 0.68], 'floor', [0, yaw, 0]);
  }
  const bumper = localXZ(at, yaw, 0, -2.18);
  addBox(boxes, `car-${id}-bumper`, [bumper[0], 0.42, bumper[1]], [2.1, 0.2, 0.18], 'trim', [0, yaw + 0.07, 0]);
}

function addBench(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const back = localXZ(at, yaw, 0, 0.42);
  const left = localXZ(at, yaw, -0.72, 0);
  const right = localXZ(at, yaw, 0.72, 0);
  addBox(boxes, `bench-${id}-seat`, [at[0], 0.62, at[1]], [1.9, 0.18, 0.7], 'woodDark', [0, yaw, 0]);
  addBox(boxes, `bench-${id}-back`, [back[0], 1.05, back[1]], [1.9, 0.72, 0.14], 'woodDark', [0, yaw, -0.08]);
  addBox(boxes, `bench-${id}-leg-l`, [left[0], 0.3, left[1]], [0.15, 0.58, 0.52], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `bench-${id}-leg-r`, [right[0], 0.3, right[1]], [0.15, 0.58, 0.52], 'metalRusted', [0, yaw, 0]);
}

function addFenceRun(boxes: StaticBoxDefinition[], id: string, from: Vec2, to: Vec2, spacing = 6): void {
  const { center, length, yaw } = segmentData(from, to);
  const count = Math.ceil(length / spacing);
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    addBox(boxes, `fence-${id}-post-${i}`, [x, 1.25, z], [0.14, 2.5, 0.14], 'metalRusted');
  }
  addBox(boxes, `fence-${id}-rail-low`, [center[0], 0.62, center[1]], [0.1, 0.1, length], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `fence-${id}-rail-high`, [center[0], 2.05, center[1]], [0.1, 0.1, length], 'metalRusted', [0, yaw, 0]);
}

function addRadioTower(boxes: StaticBoxDefinition[]): void {
  const cx = 0;
  // El transmisor ocupa x +/-10, z 32..48. La antena queda en el patio sur:
  // conserva la silueta central sin atravesar su interior ni sus puertas.
  const cz = 26.5;
  const half = 2.45;
  const feet: Vec2[] = [[-half, -half], [half, -half], [-half, half], [half, half]];
  feet.forEach(([x, z], index) => {
    addBox(boxes, `radio-pad-${index}`, [cx + x, 0.2, cz + z], [1.15, 0.4, 1.15], 'concrete');
    addBox(boxes, `radio-leg-${index}`, [cx + x, 11.5, cz + z], [0.22, 22.6, 0.22], 'metalRusted');
  });

  const tiers = [2.5, 6.5, 10.5, 14.5, 18.5, 22.5];
  tiers.forEach((y, tier) => {
    addBox(boxes, `radio-tier-${tier}-north`, [cx, y, cz - half], [half * 2, 0.13, 0.13], 'metalRusted');
    addBox(boxes, `radio-tier-${tier}-south`, [cx, y, cz + half], [half * 2, 0.13, 0.13], 'metalRusted');
    addBox(boxes, `radio-tier-${tier}-west`, [cx - half, y, cz], [0.13, 0.13, half * 2], 'metalRusted');
    addBox(boxes, `radio-tier-${tier}-east`, [cx + half, y, cz], [0.13, 0.13, half * 2], 'metalRusted');
  });

  const braceLength = Math.hypot(half * 2, 4);
  const braceAngle = Math.atan2(4, half * 2);
  // Bracing alternado: cubre base, centro y remate sin convertir la torre en
  // una masa opaca de colisionadores.
  for (const tier of [0, 2, 4]) {
    const y = 4.5 + tier * 4;
    const flip = tier % 2 === 0 ? 1 : -1;
    addBox(boxes, `radio-brace-${tier}-north`, [cx, y, cz - half], [braceLength, 0.11, 0.11], 'metalRusted', [0, 0, braceAngle * flip]);
    addBox(boxes, `radio-brace-${tier}-south`, [cx, y, cz + half], [braceLength, 0.11, 0.11], 'metalRusted', [0, 0, -braceAngle * flip]);
    addBox(boxes, `radio-brace-${tier}-west`, [cx - half, y, cz], [0.11, 0.11, braceLength], 'metalRusted', [braceAngle * flip, 0, 0]);
    addBox(boxes, `radio-brace-${tier}-east`, [cx + half, y, cz], [0.11, 0.11, braceLength], 'metalRusted', [-braceAngle * flip, 0, 0]);
  }

  addBox(boxes, 'radio-mast', [cx, 25.1, cz], [0.2, 5.2, 0.2], 'trim');
  addBox(boxes, 'radio-top-cross-x', [cx, 24.7, cz], [3.1, 0.12, 0.12], 'trim');
  addBox(boxes, 'radio-top-cross-z', [cx, 24.7, cz], [0.12, 0.12, 3.1], 'trim');
  addBox(boxes, 'radio-beacon-base', [cx, 27.76, cz], [0.48, 0.24, 0.48], 'metalRusted');
  addBox(boxes, 'radio-beacon', [cx, 28.08, cz], [0.3, 0.4, 0.3], 'signalRed');
  addBox(boxes, 'radio-dish-boom', [2.8, 17.2, cz], [2.0, 0.13, 0.13], 'trim');
  addBox(boxes, 'radio-dish', [3.82, 17.2, cz], [0.18, 1.9, 2.45], 'signalBlue', [0, 0, -0.18]);
}

function addPumpUnit(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const rear = localXZ(at, yaw, 0, 1.1);
  const front = localXZ(at, yaw, 0, -1.1);
  addBox(boxes, `pump-${id}-skid`, [at[0], 0.16, at[1]], [3.2, 0.32, 2.5], 'concrete', [0, yaw, 0]);
  addBox(boxes, `pump-${id}-motor`, [rear[0], 0.9, rear[1]], [1.55, 1.35, 1.45], 'metalRusted', [0, yaw, 0]);
  addBox(boxes, `pump-${id}-housing`, [front[0], 0.78, front[1]], [1.65, 1.15, 1.0], 'trim', [0, yaw, 0]);
  addBox(boxes, `pump-${id}-cap`, [front[0], 1.45, front[1]], [1.25, 0.22, 0.72], 'signalBlue', [0, yaw, 0]);
  const pipe = localXZ(at, yaw, 0, -2.05);
  addBox(boxes, `pump-${id}-pipe`, [pipe[0], 1.0, pipe[1]], [0.42, 0.42, 2.0], 'metalRusted', [0, yaw, 0]);
  const gauge = localXZ(at, yaw, 0.65, -1.62);
  addBox(boxes, `pump-${id}-gauge`, [gauge[0], 1.72, gauge[1]], [0.14, 0.72, 0.14], 'trim');
  addBox(boxes, `pump-${id}-dial`, [gauge[0], 2.02, gauge[1]], [0.42, 0.42, 0.12], 'lightWarm', [0, yaw, 0]);
}

function addDebrisCluster(boxes: StaticBoxDefinition[], id: string, at: Vec2, yaw: number): void {
  const a = localXZ(at, yaw, -0.7, 0.15);
  const b = localXZ(at, yaw, 0.55, -0.28);
  const c = localXZ(at, yaw, 0.12, 0.72);
  addBox(boxes, `debris-${id}-beam`, [a[0], 0.15, a[1]], [1.9, 0.25, 0.28], 'woodDark', [0.08, yaw + 0.28, 0.12]);
  addBox(boxes, `debris-${id}-slab`, [b[0], 0.12, b[1]], [1.25, 0.2, 0.86], 'concrete', [0.06, yaw - 0.17, -0.08]);
  addBox(boxes, `debris-${id}-scrap`, [c[0], 0.18, c[1]], [0.72, 0.34, 0.42], 'metalRusted', [0.18, yaw + 0.52, 0.05]);
}

function buildDemo1DetailBoxes(): StaticBoxDefinition[] {
  const boxes: StaticBoxDefinition[] = [];

  // Loop legible: la torre central se ve desde temprano, pero ninguna calle
  // atraviesa su recinto antes del retorno por el corredor oeste.
  const roads: RoadRibbonSpec[] = [
    { id: 'start-market', from: [-72, 138], to: [-45, 112] },
    { id: 'market-plaza', from: [-45, 112], to: [-10, 82] },
    { id: 'plaza-safehouse', from: [-10, 82], to: [38, 60] },
    { id: 'safehouse-depot', from: [38, 60], to: [55, 15] },
    { id: 'depot-bridge', from: [55, 15], to: [39, -4.5] },
    { id: 'bridge-canal', from: [39, -19.5], to: [10, -25] },
    { id: 'canal-pumps', from: [10, -25], to: [-55, -20] },
    { id: 'pumps-service', from: [-55, -20], to: [-72, -20] },
    { id: 'service-west', from: [-72, -4.5], to: [-72, 30] },
    { id: 'west-return', from: [-72, 30], to: [-25, 65] },
    { id: 'return-plaza', from: [-25, 65], to: [-10, 82] },
    { id: 'west-exit', from: [-72, 30], to: [-92, 45], width: 7.4, sidewalkWidth: 1.6 },
    { id: 'return-radio', from: [-25, 65], to: [0, 62], width: 6.5, sidewalkWidth: 1.4 },
  ];
  roads.forEach((road) => addRoadRibbon(boxes, road));

  // Ensanches de lectura y hubs: no son una cadena de pasillos de ancho fijo.
  const hubSlabs: Array<[string, Vec3, Vec3, Material, number]> = [
    ['start-court', [-72, 0.045, 138], [18, 0.09, 15], 'asphalt', -0.12],
    ['market-court', [-45, 0.05, 112], [23, 0.1, 20], 'concrete', 0.08],
    ['main-plaza', [-10, 0.045, 82], [27, 0.09, 23], 'asphalt', -0.08],
    ['safehouse-court', [38, 0.045, 60], [20, 0.09, 17], 'asphalt', 0.12],
    ['depot-apron', [55, 0.045, 15], [25, 0.09, 21], 'asphalt', -0.06],
    ['pump-apron', [-55, 0.045, -20], [22, 0.09, 17], 'asphalt', 0.03],
  ];
  hubSlabs.forEach(([id, position, size, material, yaw]) => addBox(boxes, `hub-${id}`, position, size, material, [0, yaw, 0]));

  addCrosswalk(boxes, 'market', [-46, 112], 0.78);
  addCrosswalk(boxes, 'plaza', [-9, 82], 1.14);
  addCrosswalk(boxes, 'safehouse', [38, 59], 0.36);
  addCrosswalk(boxes, 'depot', [53, 15], 2.3);
  addCrosswalk(boxes, 'west-return', [-70, 30], 0.94);

  // Canal industrial alineado con el hazard del nivel (z=-12, ancho 14). Las
  // dos riberas se cortan exactamente en los puentes principal y de servicio.
  addBox(boxes, 'canal-bed', [-5, 0.025, -12], [200, 0.05, 14], 'hazard');
  const bankSegments: Array<[string, number, number]> = [
    ['west', -90, 30],       // x -105..-75
    ['middle', -17, 104],    // x -69..35
    ['east', 69, 52],        // x 43..95
  ];
  for (const [id, x, width] of bankSegments) {
    addBox(boxes, `canal-bank-n-${id}`, [x, 0.18, -4.5], [width, 0.36, 2], 'concrete');
    addBox(boxes, `canal-bank-s-${id}`, [x, 0.18, -19.5], [width, 0.36, 2], 'concrete');
    addBox(boxes, `canal-rail-n-${id}`, [x, 0.92, -5.55], [width, 1.45, 0.12], 'metalRusted');
    addBox(boxes, `canal-rail-s-${id}`, [x, 0.92, -18.45], [width, 1.45, 0.12], 'metalRusted');
  }
  addBox(boxes, 'canal-main-bridge-deck', [39, 0.12, -12], [8, 0.2, 17], 'metalRusted');
  addBox(boxes, 'canal-main-bridge-rail-w', [34.82, 0.86, -12], [0.12, 1.42, 17], 'metalRusted');
  addBox(boxes, 'canal-main-bridge-rail-e', [43.18, 0.86, -12], [0.12, 1.42, 17], 'metalRusted');
  addBox(boxes, 'canal-service-bridge-deck', [-72, 0.12, -12], [6, 0.2, 17], 'metalRusted');
  addBox(boxes, 'canal-service-bridge-rail-w', [-75.18, 0.86, -12], [0.12, 1.42, 17], 'metalRusted');
  addBox(boxes, 'canal-service-bridge-rail-e', [-68.82, 0.86, -12], [0.12, 1.42, 17], 'metalRusted');

  // Depósito/estación: rieles, durmientes y un tranvía abandonado funcionan
  // como fondo monumental sin invadir la calle de 8.8 m.
  addBox(boxes, 'depot-track-w', [82.2, 0.12, 15], [0.16, 0.2, 42], 'metalRusted');
  addBox(boxes, 'depot-track-e', [85.4, 0.12, 15], [0.16, 0.2, 42], 'metalRusted');
  for (let i = 0; i < 9; i += 1) {
    addBox(boxes, `depot-sleeper-${i}`, [83.8, 0.07, -1 + i * 4], [4.5, 0.14, 0.28], 'woodDark');
  }
  addBox(boxes, 'tram-undercarriage', [83.8, 0.55, 14], [3.25, 0.62, 17.5], 'metalRusted');
  addBox(boxes, 'tram-lower-body', [83.8, 1.35, 14], [3.65, 1.25, 18.2], 'signalRed');
  addBox(boxes, 'tram-upper-body', [83.8, 2.55, 14], [3.5, 1.22, 17.6], 'wall');
  addBox(boxes, 'tram-roof', [83.8, 3.3, 14], [3.8, 0.28, 18.3], 'metalRusted', [0, 0, 0.018]);
  addBox(boxes, 'tram-front', [83.8, 2.25, 4.8], [3.48, 2.15, 0.2], 'signalBlue', [0.05, 0, 0]);
  addBox(boxes, 'tram-rear', [83.8, 2.25, 23.2], [3.48, 2.15, 0.2], 'signalBlue', [-0.04, 0, 0]);
  for (let i = 0; i < 4; i += 1) {
    const z = 7.4 + i * 4.35;
    addBox(boxes, `tram-window-w-${i}`, [81.98, 2.62, z], [0.035, 0.76, 2.75], 'signalBlue');
    addBox(boxes, `tram-window-e-${i}`, [85.62, 2.62, z], [0.035, 0.76, 2.75], 'signalBlue');
  }
  addBox(boxes, 'tram-roof-hvac-a', [83.8, 3.68, 10.1], [1.65, 0.52, 2.1], 'trim');
  addBox(boxes, 'tram-roof-hvac-b', [83.8, 3.68, 17.9], [1.65, 0.52, 2.1], 'trim');
  addBox(boxes, 'tram-trolley-base', [83.8, 3.78, 14], [0.8, 0.18, 0.8], 'metalRusted');
  addBox(boxes, 'tram-trolley-arm', [83.8, 4.55, 14], [0.12, 1.75, 0.12], 'metalRusted', [0.36, 0, 0]);
  for (const [index, z] of [8.2, 19.8].entries()) {
    addBox(boxes, `tram-wheelbar-${index}`, [83.8, 0.35, z], [4.05, 0.36, 0.48], 'floor');
  }
  // Andén cubierto y clutter técnico sobre el techo.
  addBox(boxes, 'station-platform', [75, 0.16, 15], [5.1, 0.32, 30], 'concrete');
  for (const [index, z] of [-8, 5, 18, 31].entries()) {
    addBox(boxes, `station-post-${index}`, [73.2, 2.1, z], [0.18, 3.9, 0.18], 'metalRusted');
  }
  addBox(boxes, 'station-canopy', [73.2, 4.05, 11], [4.2, 0.25, 42], 'roof', [0, 0, -0.04]);
  addBox(boxes, 'station-roof-duct', [73.2, 4.4, 16], [1.15, 0.55, 6.5], 'metalRusted');
  addBox(boxes, 'station-roof-vent-a', [73.2, 4.72, 8], [0.7, 0.75, 0.7], 'trim');
  addBox(boxes, 'station-roof-vent-b', [73.2, 4.72, 24], [0.7, 0.75, 0.7], 'trim');

  // Mercado de raciones: los puestos están fuera de la diagonal transitable.
  addMarketStall(boxes, 'produce', [-58.5, 116.5], 0.72, 'signalBlue');
  addMarketStall(boxes, 'ration', [-43, 124], -0.16, 'signalRed');
  addMarketStall(boxes, 'salvage', [-31.5, 108], 0.92, 'signalBlue');

  // Mobiliario repetido con siluetas diferentes en cada hub.
  const lamps: Array<[string, Vec2, number]> = [
    ['market', [-57, 103], -0.75],
    ['plaza', [-21, 91], -1.0],
    ['safehouse', [29, 70], -1.2],
    ['depot', [66, 21], 2.65],
    ['canal', [24, -19], 2.8],
    ['pumps', [-47, -9], -2.8],
    ['west', [-82, 19], 0.15],
    ['return', [-55, 53], -0.7],
  ];
  lamps.forEach(([id, at, yaw]) => addStreetLamp(boxes, id, at, yaw));

  const utilityPoles: Array<[string, Vec2, number]> = [
    ['north-a', [-97, 135], 0.7],
    ['north-b', [-70, 106], 0.8],
    ['west-high', [-58, 58], 0.7],
    ['west-low', [-87, 29], 0.2],
    ['pump', [-82, -2], -0.2],
  ];
  utilityPoles.forEach(([id, at, yaw]) => addUtilityPole(boxes, id, at, yaw));
  for (let i = 0; i < utilityPoles.length - 1; i += 1) {
    addCableSpan(boxes, `${utilityPoles[i][0]}-${utilityPoles[i + 1][0]}`, utilityPoles[i][1], utilityPoles[i + 1][1]);
  }

  addBlankSign(boxes, 'market', [-53, 125], -0.14, 'signalRed');
  addBlankSign(boxes, 'plaza', [5, 89], 1.12, 'signalBlue');
  addBlankSign(boxes, 'depot', [64, 7], 2.4, 'signalRed');
  addBlankSign(boxes, 'exit', [-89, 36], -0.95, 'signalBlue');

  addWreckedCar(boxes, 'plaza', [10, 72], 1.13);
  addWreckedCar(boxes, 'canal', [53, -27], 2.26);

  addBench(boxes, 'market', [-54, 128], 0.1);
  addBench(boxes, 'plaza', [-24, 77], 1.45);
  addBench(boxes, 'return', [-39, 69], -0.9);

  // Bombas y cañerías: instaladas al sur del play-space, dejando el centro del
  // hub despejado para combate y para el giro hacia el corredor oeste.
  addPumpUnit(boxes, 'west', [-65, -31], HALF_PI);
  addPumpUnit(boxes, 'east', [-48, -34], HALF_PI);
  addBox(boxes, 'pump-header-main', [-56.5, 1.0, -38], [20.5, 0.42, 0.42], 'metalRusted');
  addBox(boxes, 'pump-header-rise-w', [-66.5, 2.25, -38], [0.42, 2.9, 0.42], 'metalRusted');
  addBox(boxes, 'pump-header-rise-e', [-46.5, 2.25, -38], [0.42, 2.9, 0.42], 'metalRusted');
  addBox(boxes, 'pump-header-top', [-56.5, 3.7, -38], [20.4, 0.42, 0.42], 'metalRusted');
  for (const [index, x] of [-65, -56.5, -48].entries()) {
    addBox(boxes, `pump-header-support-${index}`, [x, 1.78, -38], [0.2, 3.2, 0.2], 'trim');
    addBox(boxes, `pump-header-joint-${index}`, [x, 3.7, -38], [0.72, 0.72, 0.72], 'metalRusted');
  }
  addBox(boxes, 'pump-control-cabinet', [-76, 1.3, -27], [2.2, 2.6, 1.1], 'wall', [0, -0.2, 0]);
  addBox(boxes, 'pump-control-face', [-75.88, 1.55, -26.45], [1.4, 0.82, 0.04], 'signalBlue', [0, -0.2, 0]);
  addBox(boxes, 'pump-control-light', [-76.4, 2.25, -26.42], [0.18, 0.18, 0.04], 'signalRed', [0, -0.2, 0]);

  // Recinto final. La cerca es visualmente permeable; el único hueco queda al
  // norte (x -2.7..2.7) para el radio-gate que Demo1Plaza controla por I/O.
  addFenceRun(boxes, 'radio-north-w', [-18, 59], [-2.7, 59]);
  addFenceRun(boxes, 'radio-north-e', [2.7, 59], [18, 59]);
  addFenceRun(boxes, 'radio-east', [18, 59], [18, 20]);
  addFenceRun(boxes, 'radio-south', [18, 20], [-18, 20]);
  addFenceRun(boxes, 'radio-west', [-18, 20], [-18, 59]);
  addBox(boxes, 'radio-gate-jamb-w', [-2.95, 1.6, 59], [0.55, 3.2, 0.55], 'concrete');
  addBox(boxes, 'radio-gate-jamb-e', [2.95, 1.6, 59], [0.55, 3.2, 0.55], 'concrete');
  addBox(boxes, 'radio-gate-bollard-w', [-4.15, 0.45, 61.2], [0.22, 0.9, 0.22], 'signalRed');
  addBox(boxes, 'radio-gate-bollard-e', [4.15, 0.45, 61.2], [0.22, 0.9, 0.22], 'signalRed');
  addRadioTower(boxes);

  // Props narrativos: equipaje abandonado, memorial rebelde y escombro
  // concentrado en bordes. Ningún cluster invade el eje de las calles.
  addBox(boxes, 'start-luggage-a', [-79, 0.36, 145], [0.9, 0.72, 0.58], 'crate', [0, 0.18, 0]);
  addBox(boxes, 'start-luggage-b', [-77.8, 0.27, 145.4], [0.7, 0.54, 0.48], 'signalRed', [0, -0.12, 0]);
  addBox(boxes, 'start-luggage-handle', [-77.8, 0.69, 145.4], [0.32, 0.3, 0.05], 'metalRusted');
  addBox(boxes, 'memorial-plinth', [-62.5, 0.45, 43], [1.8, 0.9, 1.8], 'concrete');
  addBox(boxes, 'memorial-marker', [-62.5, 1.65, 43], [0.42, 1.55, 0.42], 'metalRusted', [0.08, 0, -0.05]);
  addBox(boxes, 'memorial-light', [-61.8, 0.22, 42.2], [0.14, 0.38, 0.14], 'lightWarm');
  addDebrisCluster(boxes, 'market', [-29, 121], -0.25);
  addDebrisCluster(boxes, 'depot', [66, -1], 1.2);
  addDebrisCluster(boxes, 'west', [-89, 17], -0.7);

  return boxes;
}

/**
 * Geometría secundaria y decoración modular del rediseño de Demo 1.
 * Todos los IDs viven en el namespace `d1-` para poder combinar el bloque con
 * edificios, puertas, triggers y NPCs definidos en `Demo1Plaza`.
 */
export const DEMO1_DETAIL_BOXES: StaticBoxDefinition[] = buildDemo1DetailBoxes();
