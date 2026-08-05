import { Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';
import {
  VehicleOpportunityRegistry,
  type VehicleSeatOffer,
} from '@game/gameplay/vehicles/ai/VehicleOpportunityRegistry';
import { NavigationProfiles } from '@game/npc/navigation/NavAgentProfiles';
import type { NpcNavigationQueries } from '@game/npc/brain/NpcBrainContext';
import {
  NpcVehicleSensor,
  type NpcVehicleSeatBroker,
} from '@game/npc/brain/NpcVehicleSensor';

const SPRINT_SPEED = 5;
const FAR_GOAL = new Vector3(0, 0, 220);

describe('NpcVehicleSensor', () => {
  let registry: VehicleOpportunityRegistry;
  let broker: NpcVehicleSeatBroker;
  let sensor: NpcVehicleSensor;

  beforeEach(() => {
    registry = new VehicleOpportunityRegistry();
    broker = { requestSeat: vi.fn(() => true), releaseSeat: vi.fn() };
    sensor = new NpcVehicleSensor(
      'combine-1',
      'combine',
      { canDrive: true },
      registry,
      broker,
      SPRINT_SPEED,
    );
  });

  /** Recorrido manejable proporcional a la línea recta, con un rodeo. */
  function publish(driveFactor = 1.1, offers = [buggyAt(new Vector3(0, 0, 10))]): void {
    registry.publish(offers, (_profileId, from, to) => {
      const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
      return distance * driveFactor;
    });
  }

  const navigation: NpcNavigationQueries = {
    projectPoint: (position) => position,
    // Sin obstáculos: el camino peatonal es la línea recta.
    pathDistance: (_profile, from, to) => from.distanceTo(to),
  };

  function evaluate(elapsed: number, goal: Vector3 | null, visible = false): void {
    sensor.update(
      elapsed,
      new Vector3(),
      goal,
      visible,
      navigation,
      NavigationProfiles.humanoid,
    );
  }

  it('no propone nada sin objetivo', () => {
    publish();
    evaluate(0, null);

    expect(sensor.isVehicleUseful()).toBe(false);
  });

  it('descarta el vehículo cuando el objetivo está a mano', () => {
    publish();
    evaluate(0, new Vector3(0, 0, VEHICLE_CREW_DECISION.minGoalDistance - 1));

    expect(sensor.isVehicleUseful()).toBe(false);
  });

  it('propone el vehículo cuando el objetivo está lejos', () => {
    publish();
    evaluate(0, FAR_GOAL);

    expect(sensor.isVehicleUseful()).toBe(true);
    expect(sensor.bestOffer()?.vehicleId).toBe('buggy');
  });

  it('descarta el vehículo si el destino está en otra isla', () => {
    registry.publish([buggyAt(new Vector3(0, 0, 10))], () => null);
    evaluate(0, FAR_GOAL);

    expect(sensor.isVehicleUseful()).toBe(false);
  });

  it('descarta el vehículo cuando la carretera da toda la vuelta', () => {
    publish(6);
    evaluate(0, FAR_GOAL);

    expect(sensor.isVehicleUseful()).toBe(false);
  });

  it('deja de proponer una vez reservado y sostiene el compromiso', () => {
    publish();
    evaluate(0, FAR_GOAL);

    expect(sensor.requestSeat()).toBe(true);
    expect(broker.requestSeat).toHaveBeenCalledOnce();
    expect(sensor.isVehicleUseful()).toBe(false);

    // Mientras dura el compromiso no vuelve a comparar, aunque el mundo cambie.
    registry.publish([], () => null);
    evaluate(VEHICLE_CREW_DECISION.commitSeconds - 0.1, FAR_GOAL);
    expect(sensor.bestOffer()?.vehicleId).toBe('buggy');
  });

  it('vuelve a estar disponible después de soltar la reserva', () => {
    publish();
    evaluate(0, FAR_GOAL);
    sensor.requestSeat();
    sensor.releaseSeat();

    expect(broker.releaseSeat).toHaveBeenCalledWith('combine-1');
    evaluate(VEHICLE_CREW_DECISION.evaluateSeconds * 2, FAR_GOAL);
    expect(sensor.isVehicleUseful()).toBe(true);
  });

  it('no pide asiento si el director lo niega', () => {
    broker.requestSeat = vi.fn(() => false);
    publish();
    evaluate(0, FAR_GOAL);

    expect(sensor.requestSeat()).toBe(false);
    expect(sensor.isVehicleUseful()).toBe(true);
  });

  describe('blanco que se escapa', () => {
    /** Dos medidas con el blanco a la vista, alejándose a `speed` m/s. */
    function recede(speed: number, from = 12): void {
      publish();
      evaluate(0, new Vector3(0, 0, from), true);
      evaluate(1, new Vector3(0, 0, from + speed), true);
    }

    it('toma el vehículo aunque el blanco esté cerca, si se le escapa', () => {
      // A 12 m la comparación de tiempos siempre pierde; lo que decide es que a
      // pie, contra alguien que se aleja a 20 m/s, no lo alcanza nunca.
      recede(20);

      expect(sensor.isVehicleUseful()).toBe(true);
    });

    it('no se inmuta si el blanco apenas se mueve', () => {
      recede(0.5);

      expect(sensor.isVehicleUseful()).toBe(false);
      expect(sensor.decisionTrace().verdict).toBe('objetivo-cerca');
    });

    it('no cuenta como escape acercarse', () => {
      publish();
      evaluate(0, new Vector3(0, 0, 30), true);
      evaluate(1, new Vector3(0, 0, 12), true);

      expect(sensor.isVehicleUseful()).toBe(false);
    });

    it('no inventa velocidad contra un último-visto congelado', () => {
      publish();
      // Visible y después sólo recordado: el salto de una fuente a la otra no
      // es movimiento del blanco.
      evaluate(0, new Vector3(0, 0, 12), true);
      evaluate(1, new Vector3(0, 0, 40), false);

      expect(sensor.decisionTrace().verdict).not.toBe('conviene');
    });

    it('no sirve un vehículo más lento que correr', () => {
      registry.publish(
        [{ ...buggyAt(new Vector3(0, 0, 10)), cruiseSpeed: 4 }],
        (_id, from, to) => Math.hypot(to[0] - from[0], to[2] - from[2]),
      );
      evaluate(0, new Vector3(0, 0, 12), true);
      evaluate(1, new Vector3(0, 0, 32), true);

      expect(sensor.isVehicleUseful()).toBe(false);
    });
  });

  describe('traza de decisión', () => {
    it('distingue los motivos de rechazo, que es lo que se tunea', () => {
      publish();

      evaluate(0, null);
      expect(sensor.decisionTrace().verdict).toBe('sin-objetivo');

      evaluate(1, new Vector3(0, 0, 5));
      expect(sensor.decisionTrace().verdict).toBe('objetivo-cerca');

      registry.publish([], () => null);
      evaluate(2, FAR_GOAL);
      expect(sensor.decisionTrace().verdict).toBe('sin-vehiculo');

      registry.publish([buggyAt(new Vector3(0, 0, 10))], () => null);
      evaluate(3, FAR_GOAL);
      expect(sensor.decisionTrace().verdict).toBe('no-se-llega');

      publish(6);
      evaluate(4, FAR_GOAL);
      expect(sensor.decisionTrace().verdict).toBe('no-compensa');
    });

    it('publica los dos tiempos comparados cuando llegó a medirlos', () => {
      publish();
      evaluate(0, FAR_GOAL);

      const trace = sensor.decisionTrace();
      expect(trace.verdict).toBe('conviene');
      expect(trace.vehicleId).toBe('buggy');
      expect(trace.footSeconds).toBeCloseTo(220 / SPRINT_SPEED);
      expect(trace.vehicleSeconds).toBeLessThan(trace.footSeconds ?? 0);
    });

    it('marca la reserva viva', () => {
      publish();
      evaluate(0, FAR_GOAL);
      sensor.requestSeat();

      expect(sensor.decisionTrace().verdict).toBe('reservado');
      expect(sensor.decisionTrace().vehicleId).toBe('buggy');
    });

    it('conserva los tiempos del candidato más rápido al rechazarlo', () => {
      publish(6);
      evaluate(0, FAR_GOAL);

      const trace = sensor.decisionTrace();
      expect(trace.verdict).toBe('no-compensa');
      expect(trace.vehicleSeconds).toBeGreaterThan(trace.footSeconds ?? 0);
    });
  });

  it('respeta el throttle entre evaluaciones', () => {
    publish();
    evaluate(0, FAR_GOAL);
    expect(sensor.isVehicleUseful()).toBe(true);

    registry.publish([], () => null);
    evaluate(VEHICLE_CREW_DECISION.evaluateSeconds - 0.05, FAR_GOAL);
    expect(sensor.isVehicleUseful()).toBe(true);

    evaluate(VEHICLE_CREW_DECISION.evaluateSeconds + 0.05, FAR_GOAL);
    expect(sensor.isVehicleUseful()).toBe(false);
  });
});

function buggyAt(position: Vector3): VehicleSeatOffer {
  return {
    vehicleId: 'buggy',
    profileId: 'buggy',
    seatId: 'driver',
    role: 'driver',
    position,
    boarding: position,
    cruiseSpeed: 24,
    hasDriver: false,
    access: { accessPolicy: 'combine' },
    authored: false,
  };
}
