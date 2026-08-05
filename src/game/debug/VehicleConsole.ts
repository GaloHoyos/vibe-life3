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
        landingSurface: string | null;
        landingPosition: [number, number, number] | null;
        landingRequested: [number, number, number] | null;
        landingDeviation: number | null;
        landingStatus: string;
        landingOrderId: string | null;
        landingRevision: number | null;
        landingFailure: string | null;
        landingPurpose: string | null;
        landingReserved: boolean;
        routeLength: number;
        /** Ángulo de la torreta; delata si el artillero IA está siguiendo. */
        turretYaw: number | null;
        /** Cayendo sin control, todavía entero. */
        crashing: boolean;
        wreckage: boolean;
        crew: string[];
      }>;
      /** Intenciones de tripulación: quién va a qué asiento y en qué fase. */
      crew: () => {
        assignments: Array<{
          actorId: string;
          vehicleId: string;
          seatId: string;
          role: string;
          phase: string;
          approachTarget: [number, number, number] | null;
        }>;
        extractions: Array<{
          faction: string;
          vehicleId: string | null;
          actors: string[];
          phase: string;
          cargo: string[];
          delivered: string[];
          failed: string[];
        }>;
      };
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
        /** Última orden a la tripulación: delata por qué nadie se baja. */
        crewAction: string | null;
        crewCommand: {
          commandId: string;
          action: string;
          actors: string[];
          confirmed: string[];
          rejected: string[];
          status: string;
          reason: string | null;
        } | null;
        objective: {
          id: string;
          revision: number;
          source: string;
          kind: string;
          status: string;
        } | null;
        tactic: string | null;
        objectiveFailure: string | null;
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
            landingSurface: report?.landingSpot
              ? `${report.landingSpot.surfaceType ?? "unknown"}:${report.landingSpot.surfaceId ?? "world"}`
              : null,
            landingPosition: report?.landingSpot
              ? [...report.landingSpot.position]
              : null,
            landingRequested: report?.landingRequested
              ? [...report.landingRequested]
              : null,
            landingDeviation: report?.landingDeviation ?? null,
            landingStatus: report?.landingStatus ?? "none",
            landingOrderId: report?.landingOrderId ?? null,
            landingRevision: report?.landingRevision ?? null,
            landingFailure: report?.landingFailure ?? null,
            landingPurpose: report?.landingPurpose ?? null,
            landingReserved: report?.landingReserved ?? false,
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
    crew: () => {
      const system = getVehicles();
      return {
        assignments: (system?.getCrewIntents() ?? []).map((assignment) => ({
          actorId: assignment.actorId,
          vehicleId: assignment.vehicleId,
          seatId: assignment.seatId,
          role: assignment.role,
          phase: assignment.phase,
          approachTarget: assignment.approachTarget
            ? ([
                assignment.approachTarget.x,
                assignment.approachTarget.y,
                assignment.approachTarget.z,
              ] as [number, number, number])
            : null,
        })),
        extractions: (system?.getExtractionIntents() ?? []).map((request) => ({
          faction: request.faction,
          vehicleId: request.vehicleId,
          actors: [...request.actors],
          phase: request.phase,
          cargo: [...request.cargo],
          delivered: [...request.delivered],
          failed: [...request.failed],
        })),
      };
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
          crewAction: report?.crewAction ?? null,
          crewCommand: report?.crewCommand
            ? {
                commandId: report.crewCommand.commandId,
                action: report.crewCommand.action,
                actors: [...report.crewCommand.actorIds],
                confirmed: [...report.crewCommand.confirmedActorIds],
                rejected: [...report.crewCommand.rejectedActorIds],
                status: report.crewCommand.status,
                reason: report.crewCommand.reason ?? null,
              }
            : null,
          objective: report?.objective
            ? {
                id: report.objective.id,
                revision: report.objective.revision,
                source: report.objective.source,
                kind: report.objective.kind,
                status: report.objective.status,
              }
            : null,
          tactic: report?.tactic?.tactic ?? null,
          objectiveFailure: report?.objectiveFailure?.reason ?? null,
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
