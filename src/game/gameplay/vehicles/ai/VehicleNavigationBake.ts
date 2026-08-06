import type { VehicleNavAreaDefinition } from '@game/levels/LevelDefinition';
import type {
  VehicleBakeObstacle,
  VehicleNavigationBake,
  VehicleNavigationBakeInput,
  VehicleNavigationProfile,
  VehicleNavCell,
  VehicleNavGrid,
  VehicleNavPoint,
  VehicleSurfaceSample,
} from './VehicleAiTypes';
import { profileHasNavGrid } from './VehicleAiTypes';
import { finiteOr, planarDistance, pointInPolygonXZ } from './VehicleAiMath';
import { buildVehicleLaneGraph } from './VehicleLaneGraph';
import { buildVehicleNavGrid, emptyVehicleNavGrid } from './VehicleNavGridIndex';
import { vehicleNavigationHash } from './VehicleNavigationHash';

/** Desnivel que se perdona entre celdas vecinas por encima de la pendiente: un cordón. */
const STEP_TOLERANCE = 0.25;
/** Separación mínima entre el piso de la celda y lo que haya encima. */
const SURFACE_EPSILON = 0.08;
/**
 * Lado de cubeta del índice de obstáculos. Va desacoplado del tamaño de celda a
 * propósito: una losa de 100 m indexada con cubetas de 0,8 m ocupa ~15.000
 * entradas y armar el índice cuesta más que rasterizar.
 */
const OBSTACLE_BUCKET_SIZE = 8;

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const NO_FLAGS: VehicleNavCell['flags'] = [];
const NO_TAGS: readonly string[] = [];

export function bakeVehicleNavigation(
  input: VehicleNavigationBakeInput,
  expectedHash = vehicleNavigationHash(input),
): VehicleNavigationBake {
  const actualHash = vehicleNavigationHash(input);
  if (actualHash !== expectedHash) {
    throw new Error('El input de navegación vehicular cambió durante el bake.');
  }
  // Dos presets con la misma huella rasterizan idéntico (el deslizador y el
  // nadador Combine, por ejemplo): rasterizar una vez y reetiquetar ahorra un
  // barrido entero del nivel por perfil repetido.
  const bakedByShape = new Map<string, VehicleNavGrid>();
  const grids = input.profiles
    .map((profile) => {
      const shape = rasterShapeKey(profile, input.options?.cellSize);
      const shared = bakedByShape.get(shape);
      if (shared) return { ...shared, profileId: profile.id };
      const grid = bakeProfileGrid(input, profile);
      bakedByShape.set(shape, grid);
      return grid;
    })
    .sort((a, b) => a.profileId.localeCompare(b.profileId));
  return {
    schemaVersion: 2,
    hash: actualHash,
    grids,
    laneGraph: buildVehicleLaneGraph(input.lanes, {
      endpointConnectionDistance: input.options?.endpointConnectionDistance,
      maxVerticalConnection: input.options?.maxVerticalConnection,
    }),
    markers: [...input.markers].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Todo lo del perfil que cambia qué celdas salen del rasterizado. */
function rasterShapeKey(
  profile: VehicleNavigationProfile,
  cellSizeOverride: number | undefined,
): string {
  return [
    profile.surface,
    profile.halfWidth,
    profile.halfLength,
    profile.clearanceHeight,
    profile.maxSlopeRadians,
    cellSizeOverride ?? profile.cellSize,
  ].join(':');
}

/**
 * El terreno manejable sale de la colisión real: muestras de superficie, caras
 * superiores de los obstáculos y volúmenes de agua. Las áreas autoradas ya no
 * deciden dónde se puede conducir —eso lo dice la geometría— sino que anotan
 * (`cost`, `speedLimit`, `flags`) o recortan (`blocked`). Sin esta derivación un
 * nivel que nadie pintó a mano se quedaba con cero celdas.
 */
function bakeProfileGrid(
  input: VehicleNavigationBakeInput,
  profile: VehicleNavigationProfile,
): VehicleNavGrid {
  const cellSize = Math.max(0.25, input.options?.cellSize ?? profile.cellSize);
  if (!profileHasNavGrid(profile)) {
    return emptyVehicleNavGrid(profile.id, cellSize, profile.surface);
  }

  const eligibleAreas = input.areas.filter(
    (area) =>
      area.polygon.length >= 3 &&
      (area.surface === profile.surface || area.surface === 'both'),
  );
  const blockedAreas = eligibleAreas.filter((area) => area.blocked === true);
  const paintAreas = [...eligibleAreas]
    .filter((area) => area.blocked !== true)
    .sort((a, b) => a.id.localeCompare(b.id));

  const maxSampleDistance = Math.max(
    cellSize,
    input.options?.maxSampleDistance ?? cellSize * 1.35,
  );
  const samples = buildSampleIndex(
    input.geometry.surfaceSamples ?? [],
    profile.surface,
    maxSampleDistance,
  );
  const obstacles = buildObstacleIndex(input.geometry.obstacles, OBSTACLE_BUCKET_SIZE);
  const bounds = rasterBounds(input, profile, paintAreas, blockedAreas);
  if (!bounds) {
    return emptyVehicleNavGrid(profile.id, cellSize, profile.surface);
  }

  const origin: readonly [number, number] = [
    Math.floor(bounds.minX / cellSize) * cellSize,
    Math.floor(bounds.minZ / cellSize) * cellSize,
  ];
  const maxIx = Math.ceil((bounds.maxX - origin[0]) / cellSize);
  const maxIz = Math.ceil((bounds.maxZ - origin[1]) / cellSize);
  const cells: VehicleNavCell[] = [];

  for (let ix = 0; ix <= maxIx; ix += 1) {
    const x = origin[0] + (ix + 0.5) * cellSize;
    for (let iz = 0; iz <= maxIz; iz += 1) {
      const z = origin[1] + (iz + 0.5) * cellSize;
      if (blockedAreas.some((area) => pointInPolygonXZ([x, 0, z], area.polygon))) {
        continue;
      }
      const area = paintAreaAt(x, z, paintAreas, profile);
      const height = resolveCellHeight(
        x,
        z,
        input,
        profile,
        samples,
        obstacles,
        maxSampleDistance,
        area,
      );
      if (height === null) continue;
      cells.push({
        ix,
        iz,
        position: [x, height, z],
        areaId: area?.id ?? '',
        surface: profile.surface,
        cost: Math.max(0.05, area?.cost ?? 1),
        speedLimit: area?.speedLimit ?? null,
        flags: area?.flags ? [...area.flags].sort() : NO_FLAGS,
        tags: area?.tags ? [...area.tags].sort() : NO_TAGS,
        componentId: 0,
      });
    }
  }

  return buildVehicleNavGrid(
    profile.id,
    cellSize,
    origin,
    profile.surface,
    connectedCells(cells, cellSize, profile, input.seeds ?? []),
  );
}

/**
 * Altura navegable de la celda, o `null` si no hay ninguna. Gana la candidata
 * más baja que tenga el gálibo del perfil libre encima: así una losa fina queda
 * manejable, el interior de un edificio queda a la altura de su piso y el techo
 * nunca compite con el suelo.
 */
function resolveCellHeight(
  x: number,
  z: number,
  input: VehicleNavigationBakeInput,
  profile: VehicleNavigationProfile,
  samples: SpatialIndex<VehicleSurfaceSample>,
  obstacles: SpatialIndex<VehicleBakeObstacle>,
  maxSampleDistance: number,
  area: VehicleNavAreaDefinition | null,
): number | null {
  const sample = nearestSample(samples, x, z, maxSampleDistance);
  // La muestra manda sobre su celda: si su pendiente o su gálibo no pasan, no
  // vale caer en la altura autorada del área y declararla manejable igual.
  if (sample && !surfacePassesProfile(sample, profile)) return null;

  const candidates: number[] = [];
  if (profile.surface === 'water') {
    // Para un casco la superficie es el plano de agua: ni la cara superior de
    // una caja ni la cota del área son sitios donde pueda flotar.
    const water = waterSurfaceAt([x, 0, z], input.waterVolumes);
    if (water !== null) candidates.push(water);
    else if (sample) candidates.push(sample.position[1]);
    else if (area) candidates.push(averageHeight(area.polygon));
  } else {
    if (sample) candidates.push(sample.position[1]);
    forEachObstacleAt(obstacles, x, z, (obstacle) => {
      candidates.push(obstacle.max[1]);
    });
    if (!sample && area) candidates.push(averageHeight(area.polygon));
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a - b);
  for (const height of candidates) {
    if (collidesWithObstacle(x, height, z, profile, obstacles)) continue;
    // La cota más baja que pasa dice a qué nivel se conduce, pero no sobre qué
    // se apoya: si encima hay una losa a un escalón de distancia, el vehículo va
    // arriba de la losa, no atravesándola. Sin esto una plataforma baja existe
    // en el grid con la altura del suelo que tapa.
    let supported = height;
    for (const candidate of candidates) {
      if (candidate <= supported || candidate > height + STEP_TOLERANCE) continue;
      if (!collidesWithObstacle(x, candidate, z, profile, obstacles)) supported = candidate;
    }
    return supported;
  }
  return null;
}

function paintAreaAt(
  x: number,
  z: number,
  areas: readonly VehicleNavAreaDefinition[],
  profile: VehicleNavigationProfile,
): VehicleNavAreaDefinition | null {
  let best: VehicleNavAreaDefinition | null = null;
  for (const area of areas) {
    if (!footprintInside(x, z, area.polygon, profile)) continue;
    if (!best || (area.cost ?? 1) < (best.cost ?? 1)) best = area;
  }
  return best;
}

/**
 * Agrupa las celdas en islas y descarta las que ningún vehículo puede pisar. La
 * cara superior de un muro o de un edificio pasa todos los tests de celda —hay
 * superficie y hay gálibo encima— y sólo se cae acá: o por quedar como
 * plataforma suelta sin sitio para maniobrar, o por no alcanzar ninguna semilla.
 *
 * Sin semillas que peguen se conserva todo: un nivel que todavía no colocó sus
 * vehículos debe poder planificar igual.
 */
function connectedCells(
  cells: readonly VehicleNavCell[],
  cellSize: number,
  profile: VehicleNavigationProfile,
  seeds: readonly VehicleNavPoint[],
): VehicleNavCell[] {
  const sorted = [...cells].sort((a, b) => a.ix - b.ix || a.iz - b.iz);
  const byKey = new Map(sorted.map((cell) => [cellKey(cell), cell]));
  const componentByKey = new Map<string, number>();
  const slopeRise = Math.tan(profile.maxSlopeRadians);
  const sizes: number[] = [];
  const stack: VehicleNavCell[] = [];

  for (const start of sorted) {
    if (componentByKey.has(cellKey(start))) continue;
    const component = sizes.length;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    componentByKey.set(cellKey(start), component);
    while (stack.length > 0) {
      const cell = stack.pop();
      if (!cell) break;
      size += 1;
      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        const neighbor = byKey.get(`${cell.ix + dx}:${cell.iz + dz}`);
        if (!neighbor || componentByKey.has(cellKey(neighbor))) continue;
        const reach = Math.hypot(dx, dz) * cellSize * slopeRise + STEP_TOLERANCE;
        if (Math.abs(neighbor.position[1] - cell.position[1]) > reach) continue;
        componentByKey.set(cellKey(neighbor), component);
        stack.push(neighbor);
      }
    }
    sizes.push(size);
  }

  const minimum = minimumComponentCells(profile, cellSize);
  const seeded = seededComponents(sorted, componentByKey, seeds, cellSize, profile);
  const renumbered = new Map<number, number>();
  const kept: VehicleNavCell[] = [];
  for (const cell of sorted) {
    const component = componentByKey.get(cellKey(cell)) ?? -1;
    if ((sizes[component] ?? 0) < minimum) continue;
    if (seeded && !seeded.has(component)) continue;
    let id = renumbered.get(component);
    if (id === undefined) {
      id = renumbered.size;
      renumbered.set(component, id);
    }
    kept.push({ ...cell, componentId: id });
  }
  return kept;
}

function cellKey(cell: VehicleNavCell): string {
  return `${cell.ix}:${cell.iz}`;
}

/**
 * Islas que alcanzan alguna semilla, o `null` si ninguna pegó. Una semilla es un
 * punto del mundo (el spawn de un vehículo está sobre la superficie, no en
 * ella), así que se resuelve por cercanía en planta y se desempata por la cota
 * más parecida: el techo justo encima del spawn no debe robarse la semilla.
 */
function seededComponents(
  cells: readonly VehicleNavCell[],
  componentByKey: ReadonlyMap<string, number>,
  seeds: readonly VehicleNavPoint[],
  cellSize: number,
  profile: VehicleNavigationProfile,
): Set<number> | null {
  if (seeds.length === 0) return null;
  const radius = Math.max(cellSize * 3, profile.halfLength * 2);
  const found = new Set<number>();
  for (const seed of seeds) {
    let best: VehicleNavCell | null = null;
    let bestRise = Infinity;
    let bestDistance = Infinity;
    for (const cell of cells) {
      const distance = planarDistance(cell.position, seed);
      if (distance > radius) continue;
      const rise = Math.abs(cell.position[1] - seed[1]);
      if (rise < bestRise || (rise === bestRise && distance < bestDistance)) {
        best = cell;
        bestRise = rise;
        bestDistance = distance;
      }
    }
    const component = best ? componentByKey.get(cellKey(best)) : undefined;
    if (component !== undefined) found.add(component);
  }
  return found.size > 0 ? found : null;
}

function minimumComponentCells(
  profile: VehicleNavigationProfile,
  cellSize: number,
): number {
  const footprint =
    (profile.halfWidth * 2 * profile.halfLength * 2) / (cellSize * cellSize);
  return Math.max(4, Math.ceil(footprint) * 4);
}

interface RasterBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function rasterBounds(
  input: VehicleNavigationBakeInput,
  profile: VehicleNavigationProfile,
  paintAreas: readonly VehicleNavAreaDefinition[],
  blockedAreas: readonly VehicleNavAreaDefinition[],
): RasterBounds | null {
  let bounds: RasterBounds | null = null;
  const grow = (x: number, z: number): void => {
    if (!bounds) {
      bounds = { minX: x, minZ: z, maxX: x, maxZ: z };
      return;
    }
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (z < bounds.minZ) bounds.minZ = z;
    if (z > bounds.maxZ) bounds.maxZ = z;
  };

  for (const sample of input.geometry.surfaceSamples ?? []) {
    if (sample.surface !== profile.surface) continue;
    grow(sample.position[0], sample.position[2]);
  }
  for (const obstacle of input.geometry.obstacles) {
    grow(obstacle.min[0], obstacle.min[2]);
    grow(obstacle.max[0], obstacle.max[2]);
  }
  if (profile.surface === 'water') {
    for (const volume of input.waterVolumes) {
      grow(
        volume.position[0] - volume.size[0] * 0.5,
        volume.position[2] - volume.size[2] * 0.5,
      );
      grow(
        volume.position[0] + volume.size[0] * 0.5,
        volume.position[2] + volume.size[2] * 0.5,
      );
    }
  }
  // Las áreas recortadas no aportan superficie, pero sí acotan el barrido: sin
  // ellas el dominio no cambia y la celda se descarta igual al entrar al bucle.
  for (const area of [...paintAreas, ...blockedAreas]) {
    for (const point of area.polygon) grow(point[0], point[2]);
  }
  return bounds;
}

function surfacePassesProfile(
  sample: VehicleSurfaceSample,
  profile: VehicleNavigationProfile,
): boolean {
  if (sample.blocked) return false;
  const normalLength = Math.hypot(sample.normal[0], sample.normal[1], sample.normal[2]);
  const normalizedY = normalLength > 1e-6 ? sample.normal[1] / normalLength : 0;
  if (normalizedY < Math.cos(profile.maxSlopeRadians)) return false;
  return finiteOr(sample.clearance, Number.MAX_SAFE_INTEGER) >= profile.clearanceHeight;
}

function waterSurfaceAt(
  point: VehicleNavPoint,
  volumes: VehicleNavigationBakeInput['waterVolumes'],
): number | null {
  let surface: number | null = null;
  for (const volume of volumes) {
    const halfX = volume.size[0] * 0.5;
    const halfZ = volume.size[2] * 0.5;
    if (
      Math.abs(point[0] - volume.position[0]) > halfX ||
      Math.abs(point[2] - volume.position[2]) > halfZ
    ) continue;
    const top = volume.position[1] + volume.size[1] * 0.5;
    surface = surface === null ? top : Math.max(surface, top);
  }
  return surface;
}

function footprintInside(
  x: number,
  z: number,
  polygon: readonly VehicleNavPoint[],
  profile: VehicleNavigationProfile,
): boolean {
  const insetX = profile.halfWidth;
  const insetZ = Math.min(profile.halfLength, profile.halfWidth * 1.5);
  const probes: readonly VehicleNavPoint[] = [
    [x, 0, z],
    [x - insetX, 0, z],
    [x + insetX, 0, z],
    [x, 0, z - insetZ],
    [x, 0, z + insetZ],
  ];
  return probes.every((probe) => pointInPolygonXZ(probe, polygon));
}

function collidesWithObstacle(
  x: number,
  height: number,
  z: number,
  profile: VehicleNavigationProfile,
  obstacles: SpatialIndex<VehicleBakeObstacle>,
): boolean {
  const minY = height + SURFACE_EPSILON;
  const maxY = height + profile.clearanceHeight;
  const half = profile.halfWidth;
  // Lo que no sobresale más que un cordón se pisa, no se esquiva. Sin esto el
  // canto de cualquier plataforma baja abre un foso de celdas muertas a su
  // alrededor: las que apoyan a caballo del borde no encuentran altura válida,
  // y la plataforma queda desconectada del suelo que la rodea.
  const curb = height + STEP_TOLERANCE;
  let hit = false;
  forEachObstacleNear(obstacles, x - half, z - half, x + half, z + half, (obstacle) => {
    if (hit || obstacle.max[1] <= curb) return;
    const horizontalOverlap =
      x + half > obstacle.min[0] &&
      x - half < obstacle.max[0] &&
      z + half > obstacle.min[2] &&
      z - half < obstacle.max[2];
    if (horizontalOverlap && maxY > obstacle.min[1] && minY < obstacle.max[1]) {
      hit = true;
    }
  });
  return hit;
}

function averageHeight(points: readonly VehicleNavPoint[]): number {
  return points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
}

/**
 * Grilla de cubetas para no barrer linealmente todas las muestras y obstáculos
 * por celda: rasterizar un nivel entero pasó a ser cuadrático sin esto. Una
 * misma entrada puede visitarse dos veces si abarca varias cubetas; todos los
 * consumidores son idempotentes.
 */
interface SpatialIndex<T> {
  readonly size: number;
  readonly buckets: ReadonlyMap<string, readonly T[]>;
}

function buildSampleIndex(
  samples: readonly VehicleSurfaceSample[],
  surface: VehicleNavigationProfile['surface'],
  size: number,
): SpatialIndex<VehicleSurfaceSample> {
  const buckets = new Map<string, VehicleSurfaceSample[]>();
  for (const sample of samples) {
    if (sample.surface !== surface) continue;
    push(buckets, bucketIndex(sample.position[0], size), bucketIndex(sample.position[2], size), sample);
  }
  return { size, buckets };
}

function buildObstacleIndex(
  obstacles: readonly VehicleBakeObstacle[],
  size: number,
): SpatialIndex<VehicleBakeObstacle> {
  const buckets = new Map<string, VehicleBakeObstacle[]>();
  for (const obstacle of obstacles) {
    const startX = bucketIndex(obstacle.min[0], size);
    const endX = bucketIndex(obstacle.max[0], size);
    const startZ = bucketIndex(obstacle.min[2], size);
    const endZ = bucketIndex(obstacle.max[2], size);
    for (let ix = startX; ix <= endX; ix += 1) {
      for (let iz = startZ; iz <= endZ; iz += 1) push(buckets, ix, iz, obstacle);
    }
  }
  return { size, buckets };
}

function push<T>(
  buckets: Map<string, T[]>,
  ix: number,
  iz: number,
  item: T,
): void {
  const key = `${ix}:${iz}`;
  const bucket = buckets.get(key);
  if (bucket) bucket.push(item);
  else buckets.set(key, [item]);
}

function bucketIndex(value: number, size: number): number {
  return Math.floor(value / size);
}

function nearestSample(
  index: SpatialIndex<VehicleSurfaceSample>,
  x: number,
  z: number,
  maxDistance: number,
): VehicleSurfaceSample | null {
  let nearest: VehicleSurfaceSample | null = null;
  let nearestDistance = maxDistance;
  const startX = bucketIndex(x - maxDistance, index.size);
  const endX = bucketIndex(x + maxDistance, index.size);
  const startZ = bucketIndex(z - maxDistance, index.size);
  const endZ = bucketIndex(z + maxDistance, index.size);
  for (let ix = startX; ix <= endX; ix += 1) {
    for (let iz = startZ; iz <= endZ; iz += 1) {
      const bucket = index.buckets.get(`${ix}:${iz}`);
      if (!bucket) continue;
      for (const sample of bucket) {
        const distance = planarDistance([x, 0, z], sample.position);
        if (distance < nearestDistance) {
          nearest = sample;
          nearestDistance = distance;
        }
      }
    }
  }
  return nearest;
}

function forEachObstacleAt(
  index: SpatialIndex<VehicleBakeObstacle>,
  x: number,
  z: number,
  visit: (obstacle: VehicleBakeObstacle) => void,
): void {
  const bucket = index.buckets.get(
    `${bucketIndex(x, index.size)}:${bucketIndex(z, index.size)}`,
  );
  if (!bucket) return;
  for (const obstacle of bucket) {
    if (
      x >= obstacle.min[0] &&
      x <= obstacle.max[0] &&
      z >= obstacle.min[2] &&
      z <= obstacle.max[2]
    ) {
      visit(obstacle);
    }
  }
}

function forEachObstacleNear(
  index: SpatialIndex<VehicleBakeObstacle>,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  visit: (obstacle: VehicleBakeObstacle) => void,
): void {
  const startX = bucketIndex(minX, index.size);
  const endX = bucketIndex(maxX, index.size);
  const startZ = bucketIndex(minZ, index.size);
  const endZ = bucketIndex(maxZ, index.size);
  for (let ix = startX; ix <= endX; ix += 1) {
    for (let iz = startZ; iz <= endZ; iz += 1) {
      const bucket = index.buckets.get(`${ix}:${iz}`);
      if (!bucket) continue;
      for (const obstacle of bucket) visit(obstacle);
    }
  }
}
