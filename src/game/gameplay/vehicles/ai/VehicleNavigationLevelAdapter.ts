import {
  usesGroundNavigation,
  VehiclePresets,
  type VehiclePresetDefinition,
} from '@game/config/vehicles.config';
import type {
  LevelDefinition,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import { generateHeightField } from '@shared/math/HeightField';
import type {
  VehicleBakeObstacle,
  VehicleNavigationBakeInput,
  VehicleNavigationBakeOptions,
  VehicleNavPoint,
  VehicleSurfaceSample,
} from './VehicleAiTypes';

import { navigationProfileFromPreset } from './VehicleAiTypes';

export interface VehicleNavigationLevelAdapterOptions {
  presets?: readonly VehiclePresetDefinition[];
  bake?: VehicleNavigationBakeOptions;
  terrainSampleStride?: number;
  includeDynamicObstacles?: boolean;
}

export function vehicleNavigationInputFromLevel(
  level: LevelDefinition,
  options: VehicleNavigationLevelAdapterOptions = {},
): VehicleNavigationBakeInput {
  const buildingBoxes = (level.buildings ?? []).flatMap((building) => building.boxes);
  const staticBoxes = [...level.staticBoxes, ...buildingBoxes];
  const dynamicBoxes = options.includeDynamicObstacles
    ? level.dynamicBoxes.map<StaticBoxDefinition>((box) => ({
        id: box.id,
        position: box.position,
        size: box.size,
        material: box.material,
        rotation: box.rotation,
      }))
    : [];
  const presets = options.presets ?? navigationPresetsFromLevel(level);
  const terrain = terrainSurface(level, options.terrainSampleStride);
  return {
    geometry: {
      revision: level.id,
      obstacles: [...staticBoxes, ...dynamicBoxes].map(boxObstacle),
      surfaceSamples: terrain.samples,
    },
    waterVolumes: level.waterVolumes ?? [],
    areas: level.vehicleNavAreas ?? [],
    lanes: level.vehicleNavLanes ?? [],
    markers: level.vehicleNavMarkers ?? [],
    profiles: presets.map(navigationProfileFromPreset),
    seeds: navigationSeeds(level),
    options: resolveBakeOptions(options.bake, terrain.spacing),
  };
}

/**
 * Dónde hay vehículos de verdad: spawns, carriles y marcadores. El bake conserva
 * sólo las islas que alcanzan alguno de estos puntos.
 */
function navigationSeeds(level: LevelDefinition): VehicleNavPoint[] {
  const seeds: VehicleNavPoint[] = [];
  for (const vehicle of level.vehicles ?? []) {
    const preset = VehiclePresets[vehicle.presetId];
    if (!usesGroundNavigation(preset)) continue;
    seeds.push(vehicle.position);
  }
  for (const lane of level.vehicleNavLanes ?? []) seeds.push(...lane.points);
  for (const marker of level.vehicleNavMarkers ?? []) seeds.push(marker.position);
  return seeds;
}

/**
 * El tope por defecto del bake se calibra contra el tamaño de celda, que puede
 * ser bastante menor que el paso del heightfield. Sin subirlo al paso real del
 * terreno, las celdas que caen entre dos muestras no encuentran superficie y el
 * grid sale agujereado.
 */
function resolveBakeOptions(
  bake: VehicleNavigationBakeOptions | undefined,
  spacing: number,
): VehicleNavigationBakeOptions | undefined {
  if (spacing <= 0 || bake?.maxSampleDistance !== undefined) return bake;
  return { ...bake, maxSampleDistance: spacing * 0.75 };
}

function navigationPresetsFromLevel(
  level: LevelDefinition,
): VehiclePresetDefinition[] {
  const presets = new Map<string, VehiclePresetDefinition>();
  for (const vehicle of level.vehicles ?? []) {
    const preset = VehiclePresets[vehicle.presetId];
    if (!usesGroundNavigation(preset)) continue;
    presets.set(preset.id, preset);
  }
  return [...presets.values()];
}

function boxObstacle(box: StaticBoxDefinition): VehicleBakeObstacle {
  const halfX = Math.abs(box.size[0]) * 0.5;
  const halfY = Math.abs(box.size[1]) * 0.5;
  const halfZ = Math.abs(box.size[2]) * 0.5;
  const rotation = box.rotation ?? [0, 0, 0];
  const sineX = Math.sin(rotation[0]);
  const cosineX = Math.cos(rotation[0]);
  const sineY = Math.sin(rotation[1]);
  const cosineY = Math.cos(rotation[1]);
  const sineZ = Math.sin(rotation[2]);
  const cosineZ = Math.cos(rotation[2]);
  const matrix = [
    [
      cosineY * cosineZ,
      sineX * sineY * cosineZ - cosineX * sineZ,
      cosineX * sineY * cosineZ + sineX * sineZ,
    ],
    [
      cosineY * sineZ,
      sineX * sineY * sineZ + cosineX * cosineZ,
      cosineX * sineY * sineZ - sineX * cosineZ,
    ],
    [-sineY, sineX * cosineY, cosineX * cosineY],
  ] as const;
  const extentX =
    Math.abs(matrix[0][0]) * halfX +
    Math.abs(matrix[0][1]) * halfY +
    Math.abs(matrix[0][2]) * halfZ;
  const extentY =
    Math.abs(matrix[1][0]) * halfX +
    Math.abs(matrix[1][1]) * halfY +
    Math.abs(matrix[1][2]) * halfZ;
  const extentZ =
    Math.abs(matrix[2][0]) * halfX +
    Math.abs(matrix[2][1]) * halfY +
    Math.abs(matrix[2][2]) * halfZ;
  return {
    id: box.id,
    min: [
      box.position[0] - extentX,
      box.position[1] - extentY,
      box.position[2] - extentZ,
    ],
    max: [
      box.position[0] + extentX,
      box.position[1] + extentY,
      box.position[2] + extentZ,
    ],
  };
}

interface TerrainSurface {
  samples: VehicleSurfaceSample[];
  /** Distancia entre muestras vecinas en diagonal; 0 sin terreno. */
  spacing: number;
}

function terrainSurface(
  level: LevelDefinition,
  requestedStride: number | undefined,
): TerrainSurface {
  const terrain = level.terrain;
  if (!terrain) return { samples: [], spacing: 0 };
  const field = generateHeightField({
    widthSamples: terrain.widthSamples,
    depthSamples: terrain.depthSamples,
    size: terrain.size,
    source: terrain.source,
  });
  const stride = Math.max(1, Math.floor(requestedStride ?? 1));
  const stepX = terrain.size[0] / Math.max(1, field.widthSamples - 1);
  const stepZ = terrain.size[1] / Math.max(1, field.depthSamples - 1);
  const samples: VehicleSurfaceSample[] = [];
  for (let xIndex = 0; xIndex < field.widthSamples; xIndex += stride) {
    for (let zIndex = 0; zIndex < field.depthSamples; zIndex += stride) {
      const left = heightAt(field.heights, field.widthSamples, field.depthSamples, xIndex - 1, zIndex);
      const right = heightAt(field.heights, field.widthSamples, field.depthSamples, xIndex + 1, zIndex);
      const back = heightAt(field.heights, field.widthSamples, field.depthSamples, xIndex, zIndex - 1);
      const front = heightAt(field.heights, field.widthSamples, field.depthSamples, xIndex, zIndex + 1);
      const normalX = -(right - left) / Math.max(1e-4, stepX * 2);
      const normalZ = -(front - back) / Math.max(1e-4, stepZ * 2);
      const normalLength = Math.hypot(normalX, 1, normalZ);
      const height = field.heights[xIndex + zIndex * field.widthSamples];
      const normalizedX = normalX / normalLength;
      const normalizedZ = normalZ / normalLength;
      samples.push({
        position: [
          terrain.position[0] - terrain.size[0] * 0.5 + xIndex * stepX,
          terrain.position[1] + height,
          terrain.position[2] - terrain.size[1] * 0.5 + zIndex * stepZ,
        ],
        normal: [
          Math.abs(normalizedX) < 1e-12 ? 0 : normalizedX,
          1 / normalLength,
          Math.abs(normalizedZ) < 1e-12 ? 0 : normalizedZ,
        ],
        surface: 'ground',
      });
    }
  }
  return { samples, spacing: Math.hypot(stepX * stride, stepZ * stride) };
}

function heightAt(
  heights: Float32Array,
  width: number,
  depth: number,
  x: number,
  z: number,
): number {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedZ = Math.max(0, Math.min(depth - 1, z));
  return heights[clampedX + clampedZ * width];
}
