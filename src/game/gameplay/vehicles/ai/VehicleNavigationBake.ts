import type {
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
import { vehicleNavigationHash } from './VehicleNavigationHash';

export function bakeVehicleNavigation(
  input: VehicleNavigationBakeInput,
  expectedHash = vehicleNavigationHash(input),
): VehicleNavigationBake {
  const actualHash = vehicleNavigationHash(input);
  if (actualHash !== expectedHash) {
    throw new Error('El input de navegación vehicular cambió durante el bake.');
  }
  const grids = input.profiles
    .map((profile) => bakeProfileGrid(input, profile))
    .sort((a, b) => a.profileId.localeCompare(b.profileId));
  return {
    schemaVersion: 1,
    hash: actualHash,
    grids,
    laneGraph: buildVehicleLaneGraph(input.lanes, {
      endpointConnectionDistance: input.options?.endpointConnectionDistance,
      maxVerticalConnection: input.options?.maxVerticalConnection,
    }),
    markers: [...input.markers].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function bakeProfileGrid(
  input: VehicleNavigationBakeInput,
  profile: VehicleNavigationProfile,
): VehicleNavGrid {
  const cellSize = Math.max(0.25, input.options?.cellSize ?? profile.cellSize);
  if (!profileHasNavGrid(profile)) {
    return { profileId: profile.id, cellSize, origin: [0, 0], cells: [] };
  }
  const eligibleAreas = input.areas.filter((area) =>
    (area.surface === profile.surface || area.surface === 'both')
  );
  if (eligibleAreas.length === 0) {
    return { profileId: profile.id, cellSize, origin: [0, 0], cells: [] };
  }
  const allPoints = eligibleAreas.flatMap((area) => area.polygon);
  const minimumX = Math.min(...allPoints.map((point) => point[0]));
  const minimumZ = Math.min(...allPoints.map((point) => point[2]));
  const origin: readonly [number, number] = [
    Math.floor(minimumX / cellSize) * cellSize,
    Math.floor(minimumZ / cellSize) * cellSize,
  ];
  const cellsByKey = new Map<string, VehicleNavCell>();

  for (const area of [...eligibleAreas].sort((a, b) => a.id.localeCompare(b.id))) {
    if (area.polygon.length < 3) continue;
    const minX = Math.min(...area.polygon.map((point) => point[0]));
    const maxX = Math.max(...area.polygon.map((point) => point[0]));
    const minZ = Math.min(...area.polygon.map((point) => point[2]));
    const maxZ = Math.max(...area.polygon.map((point) => point[2]));
    const minIx = Math.floor((minX - origin[0]) / cellSize);
    const maxIx = Math.ceil((maxX - origin[0]) / cellSize);
    const minIz = Math.floor((minZ - origin[1]) / cellSize);
    const maxIz = Math.ceil((maxZ - origin[1]) / cellSize);
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      for (let iz = minIz; iz <= maxIz; iz += 1) {
        const x = origin[0] + (ix + 0.5) * cellSize;
        const z = origin[1] + (iz + 0.5) * cellSize;
        const areaHeight = averageHeight(area.polygon);
        const candidate: VehicleNavPoint = [x, areaHeight, z];
        if (!footprintInside(candidate, area.polygon, profile)) continue;
        const surface = resolveSurface(input, profile, candidate, cellSize);
        if (!surface || !surfacePassesProfile(surface.sample, profile)) continue;
        const position: VehicleNavPoint = [x, surface.height, z];
        if (collidesWithObstacle(position, profile, input.geometry.obstacles)) continue;
        const key = `${ix}:${iz}`;
        const cost = Math.max(0.05, area.cost ?? 1);
        const existing = cellsByKey.get(key);
        if (existing && existing.cost <= cost) continue;
        cellsByKey.set(key, {
          key,
          ix,
          iz,
          position,
          areaId: area.id,
          surface: profile.surface,
          cost,
          speedLimit: area.speedLimit ?? null,
          flags: [...(area.flags ?? [])].sort(),
          tags: [...(area.tags ?? [])].sort(),
        });
      }
    }
  }

  return {
    profileId: profile.id,
    cellSize,
    origin,
    cells: [...cellsByKey.values()].sort((a, b) => a.ix - b.ix || a.iz - b.iz),
  };
}

function resolveSurface(
  input: VehicleNavigationBakeInput,
  profile: VehicleNavigationProfile,
  candidate: VehicleNavPoint,
  cellSize: number,
): { height: number; sample: VehicleSurfaceSample | null } | null {
  const samples = input.geometry.surfaceSamples ?? [];
  const maximumDistance = Math.max(
    cellSize,
    input.options?.maxSampleDistance ?? cellSize * 1.35,
  );
  let nearest: VehicleSurfaceSample | null = null;
  let nearestDistance = maximumDistance;
  for (const sample of samples) {
    if (sample.surface !== profile.surface) continue;
    const distance = planarDistance(candidate, sample.position);
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }

  if (profile.surface === 'water') {
    const waterHeight = waterSurfaceAt(candidate, input.waterVolumes);
    if (waterHeight === null && !nearest) return null;
    return { height: waterHeight ?? nearest?.position[1] ?? candidate[1], sample: nearest };
  }
  return { height: nearest?.position[1] ?? candidate[1], sample: nearest };
}

function surfacePassesProfile(
  sample: VehicleSurfaceSample | null,
  profile: VehicleNavigationProfile,
): boolean {
  if (!sample) return true;
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
  center: VehicleNavPoint,
  polygon: readonly VehicleNavPoint[],
  profile: VehicleNavigationProfile,
): boolean {
  const insetX = profile.halfWidth;
  const insetZ = Math.min(profile.halfLength, profile.halfWidth * 1.5);
  const probes: readonly VehicleNavPoint[] = [
    center,
    [center[0] - insetX, center[1], center[2]],
    [center[0] + insetX, center[1], center[2]],
    [center[0], center[1], center[2] - insetZ],
    [center[0], center[1], center[2] + insetZ],
  ];
  return probes.every((probe) => pointInPolygonXZ(probe, polygon));
}

function collidesWithObstacle(
  position: VehicleNavPoint,
  profile: VehicleNavigationProfile,
  obstacles: VehicleNavigationBakeInput['geometry']['obstacles'],
): boolean {
  const minY = position[1] + 0.08;
  const maxY = position[1] + profile.clearanceHeight;
  for (const obstacle of obstacles) {
    const horizontalOverlap =
      position[0] + profile.halfWidth > obstacle.min[0] &&
      position[0] - profile.halfWidth < obstacle.max[0] &&
      position[2] + profile.halfWidth > obstacle.min[2] &&
      position[2] - profile.halfWidth < obstacle.max[2];
    const verticalOverlap = maxY > obstacle.min[1] && minY < obstacle.max[1];
    if (horizontalOverlap && verticalOverlap) return true;
  }
  return false;
}

function averageHeight(points: readonly VehicleNavPoint[]): number {
  return points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
}
