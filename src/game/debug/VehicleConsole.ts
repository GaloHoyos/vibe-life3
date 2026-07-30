import type { VehicleSystem } from "@game/gameplay/vehicles/VehicleSystem";

declare global {
  interface Window {
    /** Consola de vehículos para debug/verificación headless (igual espíritu que __npcs). */
    __vehicles?: {
      list: () => Array<{
        id: string;
        preset: string;
        position: [number, number, number];
        engineOn: boolean;
        locked: boolean;
        speed: number;
        occupants: Array<{
          actor: string;
          seatId: string;
          role: string;
          seatWorld: [number, number, number] | null;
        }>;
      }>;
      /** Sube un NPC (id de actor) al primer asiento libre. */
      board: (vehicleId: string, actor: string) => string;
      /** Saca a un ocupante por su id de actor; sin id, vacía el vehículo. */
      eject: (vehicleId: string, actor?: string) => string;
      /** Aplica daño a una zona (default `hull`): humo, fuego y destrucción. */
      damage: (vehicleId: string, amount: number, zone?: string) => string;
    };
  }
}

export function installVehicleConsole(
  getVehicles: () => VehicleSystem | null,
): () => void {
  const api: NonNullable<Window["__vehicles"]> = {
    list: () =>
      (getVehicles()?.getVehicles() ?? []).map((vehicle) => {
        const position = vehicle.getWorldPosition();
        return {
          id: vehicle.id,
          preset: vehicle.preset.id,
          position: [position.x, position.y, position.z],
          engineOn: vehicle.isEngineOn(),
          locked: vehicle.isLocked(),
          speed: vehicle.getTelemetry().speed,
          occupants: vehicle.getOccupants().map((occupant) => {
            const seat = vehicle.getSeatWorldPosition(occupant.seatId);
            return {
              actor: occupant.actor,
              seatId: occupant.seatId,
              role: occupant.role,
              seatWorld: seat ? ([seat.x, seat.y, seat.z] as [number, number, number]) : null,
            };
          }),
        };
      }),
    board: (vehicleId, actor) => {
      const system = getVehicles();
      const vehicle = system?.getVehicle(vehicleId);
      if (!system || !vehicle) return "vehiculo no encontrado";
      system.boardActor(vehicle, actor);
      return vehicle.getOccupant(actor)
        ? `${actor} a bordo de ${vehicle.id}`
        : `${actor} no pudo subir a ${vehicle.id}`;
    },
    eject: (vehicleId, actor) => {
      const system = getVehicles();
      const vehicle = system?.getVehicle(vehicleId);
      if (!system || !vehicle) return "vehiculo no encontrado";
      const targets = actor
        ? [actor]
        : vehicle.getOccupants().map((occupant) => occupant.actor);
      targets.forEach((target) => {
        system.ejectActor(vehicle, target);
      });
      return `${targets.length} ocupante(s) fuera de ${vehicle.id}`;
    },
    damage: (vehicleId, amount, zone) => {
      const vehicle = getVehicles()?.getVehicle(vehicleId);
      if (!vehicle) return "vehiculo no encontrado";
      vehicle.damage.applyDamage(
        amount,
        undefined,
        zone,
        "debug-console",
        vehicle.getWorldPosition(),
      );
      const hull = vehicle.damage.getHull();
      return `${vehicle.id} casco ${Math.round(hull.current)}/${hull.max}`;
    },
  };
  window.__vehicles = api;
  return () => {
    if (window.__vehicles === api) {
      delete window.__vehicles;
    }
  };
}
