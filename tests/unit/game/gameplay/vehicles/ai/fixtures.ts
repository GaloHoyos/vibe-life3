import type {
  VehicleNavigationProfile,
  VehicleNavCell,
  VehicleNavGrid,
} from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { buildVehicleNavGrid } from '@game/gameplay/vehicles/ai/VehicleNavGridIndex';

export const groundProfile: VehicleNavigationProfile = {
  id: 'buggy',
  surface: 'ground',
  halfWidth: 0.45,
  halfLength: 0.9,
  clearanceHeight: 1.8,
  minTurnRadius: 2.5,
  reverseAllowed: true,
  maxSlopeRadians: 0.6,
  maxSpeed: 24,
  maxAcceleration: 5,
  maxBraking: 8,
  maxSteeringAngle: 0.55,
  wheelbase: 2.4,
  cellSize: 1,
};

export const waterProfile: VehicleNavigationProfile = {
  ...groundProfile,
  id: 'airboat',
  surface: 'water',
  halfWidth: 0.4,
  halfLength: 0.75,
  clearanceHeight: 1.5,
  minTurnRadius: 3,
};

export function rectangularGrid(
  width: number,
  depth: number,
  blocked: ReadonlySet<string> = new Set(),
): VehicleNavGrid {
  const cells: VehicleNavCell[] = [];
  for (let ix = 0; ix < width; ix += 1) {
    for (let iz = 0; iz < depth; iz += 1) {
      if (blocked.has(`${ix}:${iz}`)) continue;
      cells.push({
        ix,
        iz,
        position: [ix + 0.5, 0, iz + 0.5],
        areaId: 'test',
        surface: 'ground',
        cost: 1,
        speedLimit: null,
        flags: [],
        tags: [],
        componentId: 0,
      });
    }
  }
  return buildVehicleNavGrid(groundProfile.id, 1, [0, 0], 'ground', cells);
}
