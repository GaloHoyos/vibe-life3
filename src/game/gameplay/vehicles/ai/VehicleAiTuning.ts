import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import type { VehicleAiDefinition } from '@game/levels/LevelDefinition';
import {
  defaultAllowsMissionDeviation,
  defaultDriverProfileId,
  driverProfile,
  VEHICLE_DEVIATION_BUDGET_SECONDS,
  type VehicleDriverProfile,
} from '@game/config/vehicleAi.config';
import type { VehicleAiBrainTuning } from './VehicleAiBrain';
import type { VehicleControlSmootherTuning } from './VehicleControlSmoother';
import { stableJitter } from './VehicleAiMath';

/** Sales del molde: variación por vehículo para que dos clones no conduzcan igual. */
const SPEED_JITTER = 0.08;
const REACTION_JITTER = 0.15;

export interface VehicleAiTuningSet {
  brain: VehicleAiBrainTuning;
  smoother: VehicleControlSmootherTuning;
  driver: VehicleDriverProfile;
}

/**
 * Traduce el perfil de conductor autorado a los tunings que ya existían en el
 * cerebro y el path follower y que hasta ahora nunca se llenaban: en producción
 * todos los vehículos corrían los mismos defaults hardcodeados.
 */
export function vehicleAiTuning(
  vehicleId: string,
  preset: VehiclePresetDefinition,
  ai: VehicleAiDefinition,
): VehicleAiTuningSet {
  const driver = driverProfile(ai.driverProfile ?? defaultDriverProfileId(preset.id));
  const speedFactor = Math.min(
    1,
    driver.speedFactor * stableJitter(vehicleId, 3, SPEED_JITTER),
  );
  const reactionSeconds = Math.max(
    0.05,
    driver.reactionSeconds * stableJitter(vehicleId, 4, REACTION_JITTER),
  );
  return {
    driver,
    brain: {
      fleeThreshold: driver.fleeThreshold,
      engagementRangeFactor: driver.engagementRangeFactor,
      allowMissionDeviation:
        ai.allowMissionDeviation ?? defaultAllowsMissionDeviation(ai.behavior),
      deviationBudgetSeconds: VEHICLE_DEVIATION_BUDGET_SECONDS,
      follower: {
        cruiseSpeedFactor: speedFactor,
        minimumSpeedFactor: driver.minSpeedFactor,
        maximumLateralAcceleration: driver.corneringAcceleration,
        arrivalDeceleration: driver.arrivalDeceleration,
        cautionTtc: driver.cautionTtc,
        emergencyTtc: driver.emergencyTtc,
        avoidanceSteeringGain: driver.avoidanceGain,
      },
    },
    smoother: {
      steeringRate: driver.steeringRate,
      throttleRate: driver.throttleRate,
      brakeRate: driver.throttleRate * 1.8,
      reactionSeconds,
    },
  };
}
