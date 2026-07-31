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
      /** Derriba por guion, como la entrada `Crash` del I/O. */
      crash: (vehicleId: string) => string;
      /** Conmuta el blindaje escenográfico, como `DisableDamage`/`EnableDamage`. */
      invulnerable: (vehicleId: string, enabled: boolean) => string;
      /** Telemetría de vuelo de los aparatos pilotables. */
      flight: () => Array<{
        id: string;
        altitude: number;
        grounded: boolean;
        speed: number;
        forwardSpeed: number;
        verticalSpeed: number;
        roll: number;
        engineOn: boolean;
        /** Estado del piloto IA; `null` si lo vuela el jugador. */
        state: string | null;
        behavior: string | null;
        targetAltitude: number | null;
        targetSpeed: number | null;
        landingSpot: string | null;
        routeLength: number;
        /** Ángulo de la torreta; delata si el artillero IA está siguiendo. */
        turretYaw: number | null;
        /** Cayendo sin control, todavía entero. */
        crashing: boolean;
        wreckage: boolean;
        crew: string[];
      }>;
      /** Estado de la IA: decisión, blanco percibido y torreta. */
      ai: () => Array<{
        id: string;
        behavior: string | null;
        state: string | null;
        goal: [number, number, number] | null;
        targetSpeed: number | null;
        timeToCollision: number | null;
        blockedSeconds: number;
        steering: number | null;
        recovery: string | null;
        threat: string | null;
        threatVisible: boolean;
        threatMemoryAge: number | null;
        turretYaw: number | null;
        hull: number;
      }>;
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
    crash: (vehicleId) => {
      const vehicle = getVehicles()?.getVehicle(vehicleId);
      if (!vehicle) return "vehiculo no encontrado";
      vehicle.beginCrash();
      return `${vehicle.id} derribado`;
    },
    invulnerable: (vehicleId, enabled) => {
      const vehicle = getVehicles()?.getVehicle(vehicleId);
      if (!vehicle) return "vehiculo no encontrado";
      vehicle.setInvulnerable(enabled);
      return `${vehicle.id} invulnerable=${vehicle.isInvulnerable()}`;
    },
    flight: () => {
      const system = getVehicles();
      return (system?.getVehicles() ?? [])
        .filter((vehicle) => vehicle.preset.motor.kind === "rotorcraft")
        .map((vehicle) => {
          const telemetry = vehicle.getTelemetry();
          const report = system?.getAirReport(vehicle.id) ?? null;
          return {
            id: vehicle.id,
            altitude: telemetry.altitude,
            grounded: telemetry.grounded,
            speed: telemetry.speed,
            forwardSpeed: telemetry.forwardSpeed,
            verticalSpeed: vehicle.getLinearVelocity().y,
            roll: telemetry.steering,
            engineOn: vehicle.isEngineOn(),
            state: report?.state ?? null,
            behavior: report?.behavior ?? null,
            targetAltitude: report?.targetAltitude ?? null,
            targetSpeed: report?.targetSpeed ?? null,
            landingSpot: report?.landingSpot?.source ?? null,
            routeLength: report?.routeLength ?? 0,
            turretYaw: system?.getTurretYaw(vehicle.id) ?? null,
            crashing: vehicle.isCrashing(),
            wreckage: vehicle.isWreckage(),
            crew: vehicle
              .getOccupants()
              .map((occupant) => `${occupant.role}:${occupant.actor}`),
          };
        });
    },
    ai: () => {
      const system = getVehicles();
      return (system?.getVehicles() ?? []).map((vehicle) => {
        const report = system?.getAiReport(vehicle.id) ?? null;
        const hull = vehicle.damage.getHull();
        return {
          id: vehicle.id,
          behavior: report?.behavior ?? null,
          state: report?.state ?? null,
          goal: report?.goal ?? null,
          targetSpeed: report?.targetSpeed ?? null,
          timeToCollision: report?.timeToCollision ?? null,
          blockedSeconds: report?.blockedSeconds ?? 0,
          steering: vehicle.getTelemetry().steering,
          recovery: report?.recovery ?? null,
          threat: report?.threat ?? null,
          threatVisible: report?.threatVisible ?? false,
          threatMemoryAge: report?.threatMemoryAge ?? null,
          turretYaw: report?.turretYaw ?? null,
          hull: hull.max > 0 ? hull.current / hull.max : 0,
        };
      });
    },
  };
  window.__vehicles = api;
  return () => {
    if (window.__vehicles === api) {
      delete window.__vehicles;
    }
  };
}
