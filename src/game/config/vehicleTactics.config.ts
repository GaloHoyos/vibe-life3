import type { Faction } from '@engine/ai/Faction';
import type {
  VehicleTacticalDoctrine,
  VehicleTacticId,
} from '@game/gameplay/vehicles/ai/VehicleTacticalTypes';

export const VEHICLE_TACTICAL_SELECTOR = {
  commitSeconds: 2,
  switchMargin: 10,
  anchorHoldSeconds: 3,
  memory: {
    maxAttempts: 16,
    ttlSeconds: 30,
    failuresBeforeCooldown: 2,
    cooldownSeconds: 8,
    failurePenalty: 12,
    cooldownPenalty: 60,
    progressClearMeters: 5,
  },
} as const;

const combineUtility: Readonly<Record<VehicleTacticId, number>> = {
  follow: 48,
  intercept: 76,
  attackRun: 66,
  suppress: 68,
  reposition: 58,
  deploy: 72,
  search: 52,
  recover: 90,
  replaceDriver: 86,
  switchVehicle: 62,
  continueOnFoot: 56,
  requestExtraction: 24,
  abandon: 12,
};

const resistanceUtility: Readonly<Record<VehicleTacticId, number>> = {
  follow: 62,
  intercept: 55,
  attackRun: 56,
  suppress: 64,
  reposition: 62,
  deploy: 60,
  search: 58,
  recover: 90,
  replaceDriver: 84,
  switchVehicle: 58,
  continueOnFoot: 68,
  requestExtraction: 48,
  abandon: 22,
};

const transportUtility: Readonly<Record<VehicleTacticId, number>> = {
  follow: 82,
  intercept: 12,
  attackRun: 14,
  suppress: 34,
  reposition: 30,
  deploy: 28,
  search: 18,
  recover: 96,
  replaceDriver: 92,
  switchVehicle: 38,
  continueOnFoot: 24,
  requestExtraction: 52,
  abandon: 46,
};

export const VEHICLE_TACTICAL_DOCTRINES = {
  combine: {
    id: 'combine',
    utility: combineUtility,
    riskTolerance: 0.8,
    ramEnemyVehicles: true,
    deployAgainstFootTargets: true,
    preserveCargo: false,
  },
  resistance: {
    id: 'resistance',
    utility: resistanceUtility,
    riskTolerance: 0.45,
    ramEnemyVehicles: false,
    deployAgainstFootTargets: true,
    preserveCargo: false,
  },
  transport: {
    id: 'transport',
    utility: transportUtility,
    riskTolerance: 0.25,
    ramEnemyVehicles: false,
    deployAgainstFootTargets: false,
    preserveCargo: true,
  },
} as const satisfies Readonly<Record<VehicleTacticalDoctrine['id'], VehicleTacticalDoctrine>>;

export function vehicleTacticalDoctrine(
  faction: Faction,
  transportMission: boolean,
  profile?: VehicleTacticalDoctrine['id'],
): VehicleTacticalDoctrine {
  if (profile) return VEHICLE_TACTICAL_DOCTRINES[profile];
  if (transportMission) return VEHICLE_TACTICAL_DOCTRINES.transport;
  return faction === 'combine'
    ? VEHICLE_TACTICAL_DOCTRINES.combine
    : VEHICLE_TACTICAL_DOCTRINES.resistance;
}
