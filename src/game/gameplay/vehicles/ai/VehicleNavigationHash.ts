import type {
  VehicleNavigationBakeInput,
  VehicleNavigationProfile,
} from './VehicleAiTypes';

const VEHICLE_NAVIGATION_FORMAT_VERSION = 2;

export function vehicleNavigationHash(input: VehicleNavigationBakeInput): string {
  const canonical = {
    version: VEHICLE_NAVIGATION_FORMAT_VERSION,
    geometry: {
      revision: input.geometry.revision ?? '',
      obstacles: [...input.geometry.obstacles]
        .sort(compareId)
        .map((obstacle) => ({
          id: obstacle.id,
          min: quantizedPoint(obstacle.min),
          max: quantizedPoint(obstacle.max),
        })),
      surfaceSamples: [...(input.geometry.surfaceSamples ?? [])]
        .map((sample) => ({
          position: quantizedPoint(sample.position),
          normal: quantizedPoint(sample.normal),
          surface: sample.surface,
          clearance: sample.clearance === null
            ? null
            : quantize(sample.clearance ?? Number.MAX_SAFE_INTEGER),
          blocked: sample.blocked ?? false,
        }))
        .sort((a, b) => comparePoint(a.position, b.position) || a.surface.localeCompare(b.surface)),
    },
    waterVolumes: [...input.waterVolumes].sort(compareId).map((volume) => ({
      id: volume.id,
      position: quantizedPoint(volume.position),
      size: quantizedPoint(volume.size),
      flow: volume.flow ? quantizedPoint(volume.flow) : null,
      surface: volume.surface ?? null,
    })),
    areas: [...input.areas].sort(compareId).map((area) => ({
      id: area.id,
      polygon: area.polygon.map(quantizedPoint),
      surface: area.surface,
      cost: quantize(area.cost ?? 1),
      speedLimit: area.speedLimit === undefined ? null : quantize(area.speedLimit),
      tags: [...(area.tags ?? [])].sort(),
      flags: [...(area.flags ?? [])].sort(),
      blocked: area.blocked ?? false,
    })),
    lanes: [...input.lanes].sort(compareId).map((lane) => ({
      id: lane.id,
      points: lane.points.map(quantizedPoint),
      width: quantize(lane.width),
      direction: lane.direction,
      speedLimit: lane.speedLimit === undefined ? null : quantize(lane.speedLimit),
      priority: quantize(lane.priority ?? 0),
      tags: [...(lane.tags ?? [])].sort(),
    })),
    markers: [...input.markers].sort(compareId).map((marker) => ({
      id: marker.id,
      position: quantizedPoint(marker.position),
      heading: marker.heading === undefined ? null : quantize(marker.heading),
      kind: marker.kind,
      allowedPresets: [...(marker.allowedPresets ?? [])].sort(),
      allowRecoverySnap: marker.allowRecoverySnap ?? false,
    })),
    seeds: [...(input.seeds ?? [])].map(quantizedPoint).sort(comparePoint),
    profiles: [...input.profiles].sort(compareId).map(canonicalProfile),
    options: {
      cellSize: input.options?.cellSize === undefined ? null : quantize(input.options.cellSize),
      maxSampleDistance: input.options?.maxSampleDistance === undefined
        ? null
        : quantize(input.options.maxSampleDistance),
      endpointConnectionDistance: input.options?.endpointConnectionDistance === undefined
        ? null
        : quantize(input.options.endpointConnectionDistance),
      maxVerticalConnection: input.options?.maxVerticalConnection === undefined
        ? null
        : quantize(input.options.maxVerticalConnection),
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v${VEHICLE_NAVIGATION_FORMAT_VERSION}-${hash.toString(16).padStart(8, '0')}`;
}

function canonicalProfile(profile: VehicleNavigationProfile): object {
  return {
    id: profile.id,
    surface: profile.surface,
    halfWidth: quantize(profile.halfWidth),
    halfLength: quantize(profile.halfLength),
    clearanceHeight: quantize(profile.clearanceHeight),
    minTurnRadius: quantize(profile.minTurnRadius),
    reverseAllowed: profile.reverseAllowed,
    maxSlopeRadians: quantize(profile.maxSlopeRadians),
    maxSpeed: quantize(profile.maxSpeed),
    maxAcceleration: quantize(profile.maxAcceleration),
    maxBraking: quantize(profile.maxBraking),
    maxSteeringAngle: quantize(profile.maxSteeringAngle),
    wheelbase: quantize(profile.wheelbase),
    cellSize: quantize(profile.cellSize),
  };
}

function compareId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function quantize(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function quantizedPoint(point: readonly [number, number, number]): readonly [number, number, number] {
  return [quantize(point[0]), quantize(point[1]), quantize(point[2])];
}

function comparePoint(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
