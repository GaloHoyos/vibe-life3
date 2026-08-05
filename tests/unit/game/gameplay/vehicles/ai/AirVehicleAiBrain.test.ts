import { describe, expect, it } from "vitest";
import {
  AirVehicleAiBrain,
  airBrainTuning,
} from "@game/gameplay/vehicles/ai/AirVehicleAiBrain";
import type { AirBrainContext } from "@game/gameplay/vehicles/ai/AirVehicleAiTypes";
import { pilotProfile } from "@game/config/vehicleAi.config";
import type {
  VehicleAiBehavior,
  VehicleAiDefinition,
} from "@game/levels/LevelDefinition";

const WEAPON_RANGE = 110;

describe("AirVehicleAiBrain", () => {
  it("posado con misión que volar, despega antes que nada", () => {
    const brain = create("intercept");

    const decision = tick(brain, context({ grounded: true, altitude: 0 }));

    expect(decision.state).toBe("takeoff");
    // Despegar es subir en vertical: irse en diagonal desde una plataforma es
    // cómo se engancha un patín.
    expect(decision.intent.target?.[0]).toBe(0);
    expect(decision.intent.target?.[2]).toBe(0);
    expect(decision.intent.targetAltitude).toBeGreaterThan(20);
  });

  it("no despega dejando en tierra a la tripulación que viene", () => {
    const brain = create("intercept");

    const waiting = tick(
      brain,
      context({ grounded: true, altitude: 0, crewPending: true }),
    );
    expect(waiting.state).toBe("grounded");

    const ready = tick(brain, context({ grounded: true, altitude: 0 }));
    expect(ready.state).toBe("takeoff");
  });

  it("si al que falta lo matan en el camino, se va igual", () => {
    const brain = create("intercept");

    // La espera tiene tope: un aparato clavado esperando a un muerto es peor
    // que uno que despega a medio tripular.
    let last = tick(brain, context({ grounded: true, altitude: 0, crewPending: true }));
    for (let i = 0; i < 200 && last.state === "grounded"; i += 1) {
      last = tick(brain, context({ grounded: true, altitude: 0, crewPending: true }));
    }

    expect(last.state).toBe("takeoff");
  });

  it("sin piloto se posa en vez de quedarse flotando", () => {
    const brain = create("intercept");

    const decision = tick(
      brain,
      context({ pilotAvailable: false, altitude: 40 }),
    );

    expect(decision.state).toBe("landing");
    expect(decision.intent.descend).toBe(true);
  });

  it("orbita al blanco a distancia de tiro con el morro apuntado", () => {
    const brain = create("intercept");

    const decision = tick(
      brain,
      context({
        threat: { id: "player", position: [0, 1, 0], visible: true },
      }),
    );

    expect(decision.state).toBe("engaging");
    const target = decision.intent.target;
    expect(target).not.toBeNull();
    const radius = Math.hypot(target?.[0] ?? 0, target?.[2] ?? 0);
    // El standoff sale de `standoffRangeFactor` sobre el alcance del arma.
    expect(radius).toBeGreaterThan(WEAPON_RANGE * 0.35);
    expect(radius).toBeLessThan(WEAPON_RANGE * 0.75);
    // El morro va al blanco aunque el aparato viaje por la tangente: es lo que
    // le da ángulo a la torreta de puerta.
    expect(decision.intent.facing).toEqual([0, 1, 0]);
  });

  it("pierde el contacto y persigue el último-visto", () => {
    const brain = create("intercept");

    const decision = tick(
      brain,
      context({
        threat: {
          id: "player",
          position: [30, 1, 30],
          visible: false,
          memoryAge: 1.5,
        },
      }),
    );

    expect(decision.state).toBe("pursuing");
    expect(decision.intent.target).toEqual([30, 1, 30]);
  });

  it("con el casco bajo rompe contacto y sube", () => {
    const brain = create("intercept");

    const decision = tick(
      brain,
      context({
        healthFraction: 0.18,
        threat: { id: "player", position: [0, 1, 0], visible: true },
      }),
    );

    expect(decision.state).toBe("evading");
    // Romper contacto es alejarse Y ganar altura.
    expect(decision.intent.targetAltitude).toBeGreaterThan(
      pilotProfile("gunship").cruiseAltitude,
    );
  });

  it("con el casco crítico va primero a la zona y después baja", () => {
    const brain = create("intercept");

    // Lejos del claro: se aproxima, no se desploma donde está.
    const far = tick(
      brain,
      context({
        healthFraction: 0.05,
        landingSpot: { position: [90, 0, 90], source: "improvised" },
      }),
    );
    expect(far.state).toBe("approach");
    expect(far.intent.descend).toBe(false);

    const overhead = tick(
      brain,
      context({
        position: [90, 30, 90],
        healthFraction: 0.05,
        landingSpot: { position: [90, 0, 90], source: "improvised" },
      }),
    );
    expect(overhead.state).toBe("landing");
    expect(overhead.intent.descend).toBe(true);
  });

  it("reventado y sin dónde posarse, baja donde esté", () => {
    const brain = create("intercept");

    const decision = tick(brain, context({ healthFraction: 0.05 }));

    expect(decision.state).toBe("landing");
    expect(decision.intent.descend).toBe(true);
  });

  it("un transporte con carga se aproxima, aterriza y manda desembarcar", () => {
    const brain = create("transport");
    const spot = { position: [40, 0, 0], source: "authored" } as const;

    const approaching = tick(
      brain,
      context({ landingSpot: spot, passengersOnboard: true }),
    );
    expect(approaching.state).toBe("approach");
    expect(approaching.intent.descend).toBe(false);

    const overhead = tick(
      brain,
      context({
        position: [40, 30, 0],
        landingSpot: spot,
        passengersOnboard: true,
      }),
    );
    expect(overhead.state).toBe("landing");

    const landed = tick(
      brain,
      context({
        position: [40, 0, 0],
        altitude: 0,
        grounded: true,
        landingSpot: spot,
        passengersOnboard: true,
      }),
    );
    expect(landed.state).toBe("grounded");
    expect(landed.crewAction).toBe("requestDisembark");
    expect(landed.intent.shutdown).toBe(true);
  });

  it("un patrullero no abandona la misión para pelear", () => {
    const brain = create("patrol");

    const decision = tick(
      brain,
      context({
        patrolPoints: [[80, 0, 80]],
        threat: { id: "player", position: [0, 1, 0], visible: true },
      }),
    );

    // `patrol` no permite desvío: el blanco visible no lo saca de la ronda.
    expect(decision.state).toBe("cruising");
    expect(decision.intent.target).toEqual([80, 0, 80]);
  });

  it("no vuelve a pedir ruta si el destino apenas se movió", () => {
    const brain = create("patrol");
    const first = tick(brain, context({ patrolPoints: [[200, 0, 0]] }));
    expect(first.planGoal).not.toBeNull();

    const second = tick(brain, context({ patrolPoints: [[203, 0, 0]] }));
    // El A* aéreo raycastea por tramo: replanificar por 3 m es tirar el frame.
    expect(second.planGoal).toBeNull();

    const third = tick(brain, context({ patrolPoints: [[260, 0, 0]] }));
    expect(third.planGoal).not.toBeNull();
  });

  describe("extracción", () => {
    const LZ = [80, 0, 40] as const;

    it("baja a recoger aunque venga vacío", () => {
      const brain = create("transport");
      const decision = tick(brain, context({
        pickupAt: LZ,
        landingSpot: { position: LZ, source: "authored" },
        passengersOnboard: false,
      }));

      // Sin extracción, un transporte vacío no se posa: ya cumplió su misión.
      expect(decision.state).toBe("approach");
    });

    it("pide embarco al posarse en la zona de recogida", () => {
      const brain = create("transport");
      const decision = tick(brain, context({
        pickupAt: LZ,
        landingSpot: { position: LZ, source: "authored" },
        position: [LZ[0], 0, LZ[2]],
        altitude: 0,
        grounded: true,
        passengersOnboard: false,
      }));

      expect(decision.state).toBe("grounded");
      expect(decision.crewAction).toBe("requestBoarding");
    });

    it("un transporte vacío sin extracción no se queda dando vueltas", () => {
      const brain = create("transport");
      const decision = tick(brain, context({
        landingSpot: { position: LZ, source: "authored" },
        passengersOnboard: false,
      }));

      expect(decision.state).not.toBe("approach");
    });

    it("con carga a bordo pide desembarco, no embarco", () => {
      const brain = create("transport");
      const decision = tick(brain, context({
        landingSpot: { position: LZ, source: "authored" },
        position: [LZ[0], 0, LZ[2]],
        altitude: 0,
        grounded: true,
        passengersOnboard: true,
      }));

      expect(decision.crewAction).toBe("requestDisembark");
    });
  });
});

function create(behavior: VehicleAiBehavior): AirVehicleAiBrain {
  const ai: VehicleAiDefinition = { enabled: true, behavior };
  return new AirVehicleAiBrain(
    "test-heli",
    ai,
    airBrainTuning("test-heli", pilotProfile("gunship"), ai, WEAPON_RANGE),
  );
}

function tick(brain: AirVehicleAiBrain, ctx: AirBrainContext) {
  brain.advance(0.2);
  return brain.update(ctx, 40);
}

function context(overrides: Partial<AirBrainContext> = {}): AirBrainContext {
  return {
    position: [0, 30, 0],
    heading: 0,
    velocity: [0, 0, 0],
    altitude: 30,
    grounded: false,
    healthFraction: 1,
    pilotAvailable: true,
    gunnerAvailable: true,
    passengersOnboard: false,
    hasPlayerOccupant: false,
    crewPending: false,
    weaponRange: WEAPON_RANGE,
    ...overrides,
  };
}
