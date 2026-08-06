import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';

export interface VehicleTravelOption {
  /** Recorrido a pie hasta el objetivo, medido sobre el navmesh. */
  footDistance: number;
  /** Velocidad sostenida del NPC a pie. */
  footSpeed: number;
  /** Recorrido a pie desde el NPC hasta el punto de subida. */
  approachDistance: number;
  /** Recorrido manejable desde el vehículo hasta el objetivo. */
  driveDistance: number;
  /** Velocidad sostenida del vehículo, ya descontado lo que no se aprovecha. */
  driveSpeed: number;
}

export interface VehicleTravelComparison {
  footSeconds: number;
  vehicleSeconds: number;
  /** El vehículo gana por el margen exigido. */
  worthIt: boolean;
}

/**
 * Compara ir a pie contra ir en vehículo. El tiempo en vehículo incluye lo que
 * cuesta llegar hasta él y subirse, que es justamente lo que hace que a corta
 * distancia nunca convenga: un buggy a 30 m no compensa para un objetivo a 40.
 *
 * El margen existe para que dos opciones parejas no alternen: el vehículo tiene
 * que ganar con claridad, no por un segundo.
 */
export function compareTravelOptions(
  option: VehicleTravelOption,
  margin: number = VEHICLE_CREW_DECISION.advantageMargin,
): VehicleTravelComparison {
  const footSpeed = Math.max(0.1, option.footSpeed);
  const driveSpeed = Math.max(0.1, option.driveSpeed);
  const footSeconds = option.footDistance / footSpeed;
  const vehicleSeconds =
    option.approachDistance / footSpeed +
    VEHICLE_CREW_DECISION.boardingSeconds +
    option.driveDistance / driveSpeed;
  return {
    footSeconds,
    vehicleSeconds,
    worthIt: vehicleSeconds < footSeconds * margin,
  };
}
