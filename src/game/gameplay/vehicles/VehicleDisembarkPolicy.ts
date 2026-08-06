import type { VehicleCrewRole } from "@game/config/vehicles.config";

export interface VehicleDisembarkCandidate {
  readonly actor: string;
  readonly role: VehicleCrewRole;
}

/**
 * Orden en que se abandona el vehículo: primero lo prescindible. El conductor
 * es lo último que se suelta porque sin él el vehículo deja de ser vehículo, y
 * el artillero va después de los pasajeros porque es lo que cubre la salida
 * mientras la infantería entra.
 */
const RETENTION_RANK: Readonly<Record<VehicleCrewRole, number>> = {
  driver: 0,
  pilot: 0,
  gunner: 1,
  commander: 2,
  passenger: 3,
};

/**
 * Cuántos se quedan a bordo. Un vehículo de dos plazas sólo conserva al
 * conductor; de tres o más, conductor y artillero.
 */
export function crewRetentionCap(seatCount: number): number {
  return seatCount <= 2 ? 1 : 2;
}

/**
 * Quiénes bajan cuando el vehículo deja de servir para el objetivo actual.
 *
 * Siempre baja al menos uno: si la tripulación ya cabe entera en el cupo de
 * retención, igual desembarca el más prescindible, porque la decisión de bajar
 * ya se tomó y un vehículo que no sirve no puede dejar a todos sentados. Con un
 * solo tripulante eso significa que baja el propio conductor.
 */
export function selectDisembarkingCrew(
  crew: readonly VehicleDisembarkCandidate[],
  seatCount: number,
  armed = false,
): VehicleDisembarkCandidate[] {
  if (crew.length === 0) return [];
  if (armed) {
    const driver = crew.find(
      (candidate) => candidate.role === "driver" || candidate.role === "pilot",
    );
    const gunner = crew.find((candidate) => candidate.role === "gunner");
    if (seatCount <= 2 && driver && gunner) return [driver];
    const assault = crew.filter(
      (candidate) =>
        candidate.role !== "driver" &&
        candidate.role !== "pilot" &&
        candidate.role !== "gunner",
    );
    if (assault.length > 0) {
      return assault.sort(
        (first, second) =>
          RETENTION_RANK[second.role] - RETENTION_RANK[first.role],
      );
    }
    if (driver && !gunner) return [driver];
    return [];
  }
  const count = Math.max(1, crew.length - crewRetentionCap(seatCount));
  return [...crew]
    .sort((first, second) => RETENTION_RANK[second.role] - RETENTION_RANK[first.role])
    .slice(0, count);
}
