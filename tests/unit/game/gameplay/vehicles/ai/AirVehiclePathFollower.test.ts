import { describe, expect, it } from "vitest";
import { AirVehiclePathFollower } from "@game/gameplay/vehicles/ai/AirVehiclePathFollower";
import type {
  AirFlightIntent,
  AirFollowerInput,
} from "@game/gameplay/vehicles/ai/AirVehicleAiTypes";
import type { VehicleNavPoint } from "@game/gameplay/vehicles/ai/VehicleAiTypes";

const CRUISE_ALTITUDE = 30;

describe("AirVehiclePathFollower", () => {
  it("inclina el morro hacia adelante para ir hacia adelante", () => {
    const follower = new AirVehiclePathFollower();

    const command = follower.update(
      input({ target: [0, CRUISE_ALTITUDE, 60] }, { heading: 0 }),
    );

    // Con el morro a +Z y el objetivo a +Z, avanzar es bajar el morro.
    expect(command.throttle).toBeGreaterThan(0.3);
    expect(Math.abs(command.steering)).toBeLessThan(0.2);
  });

  it("alabea hacia el lado correcto para desplazarse de costado", () => {
    const follower = new AirVehiclePathFollower();

    // Objetivo a -X, que con +Z adelante es la DERECHA del proyecto.
    const right = follower.update(
      input({ target: [-60, CRUISE_ALTITUDE, 0] }, { heading: 0 }),
    );
    const left = follower.update(
      input({ target: [60, CRUISE_ALTITUDE, 0] }, { heading: 0 }),
    );

    expect(right.steering).toBeGreaterThan(0.3);
    expect(left.steering).toBeLessThan(-0.3);
  });

  it("el colectivo persigue la altura y no la posición", () => {
    const follower = new AirVehiclePathFollower();

    const low = follower.update(
      input({ target: null }, { altitude: 5 }),
    );
    const high = follower.update(
      input({ target: null }, { altitude: 60 }),
    );

    expect(low.collective).toBeGreaterThan(0.3);
    expect(high.collective).toBeLessThan(-0.3);
  });

  it("compensa el hundimiento del rotor al ralentí sin conocer el preset", () => {
    const follower = new AirVehiclePathFollower();

    // A la altura pedida pero cayendo: el servo es sobre velocidad vertical,
    // así que pide colectivo aunque el error de altura sea cero.
    const command = follower.update(
      input(
        { target: null },
        { altitude: CRUISE_ALTITUDE, velocity: [0, -1.4, 0] },
      ),
    );

    expect(command.collective).toBeGreaterThan(0);
  });

  it("sin terreno debajo sostiene la altura en vez de hundirse", () => {
    const follower = new AirVehiclePathFollower();

    // Un hueco entre plataformas deja la altura sobre el suelo en Infinity:
    // restarla daba error infinito y el aparato caía fuera del mundo.
    const floating = follower.update(
      input({ target: null }, { altitude: Number.POSITIVE_INFINITY }),
    );
    expect(floating.collective).toBeCloseTo(0, 5);

    const sinking = follower.update(
      input(
        { target: null },
        { altitude: Number.POSITIVE_INFINITY, velocity: [0, -6, 0] },
      ),
    );
    expect(sinking.collective).toBeGreaterThan(0);
  });

  it("apunta el morro al blanco aunque viaje de costado", () => {
    const follower = new AirVehiclePathFollower();

    // Viaja hacia +Z pero mira hacia -X: es la órbita de combate.
    const command = follower.update(
      input(
        { target: [0, CRUISE_ALTITUDE, 40], facing: [-40, CRUISE_ALTITUDE, 0] },
        { heading: 0 },
      ),
    );

    // Guiñar a la derecha baja el rumbo, así que el mando sale positivo.
    expect(command.yaw).toBeGreaterThan(0.3);
    expect(command.throttle).toBeGreaterThan(0);
  });

  it("suelta velocidad al acercarse al destino", () => {
    const follower = new AirVehiclePathFollower();

    const far = follower.update(input({ target: [0, CRUISE_ALTITUDE, 120] }));
    const near = follower.update(input({ target: [0, CRUISE_ALTITUDE, 6] }));

    expect(far.targetSpeed).toBeGreaterThan(20);
    expect(near.targetSpeed).toBeLessThan(6);
  });

  it("aterrizar manda un descenso fijo y corta al tocar el suelo", () => {
    const follower = new AirVehiclePathFollower();

    const descending = follower.update(
      input({ target: [0, 0, 0], descend: true }, { altitude: 12 }),
    );
    const landed = follower.update(
      input({ target: [0, 0, 0], descend: true }, { altitude: 0, grounded: true }),
    );

    expect(descending.collective).toBeLessThan(0);
    // Ya posado, el colectivo se va al fondo: si no, el aparato rebota.
    expect(landed.collective).toBe(-1);
  });

  it("el rotor apagado no pide nada más que bajar el colectivo", () => {
    const follower = new AirVehiclePathFollower();

    const command = follower.update(
      input({ target: [0, 30, 60], shutdown: true }, { altitude: 30 }),
    );

    expect(command.collective).toBe(-1);
    expect(command.throttle).toBe(0);
    expect(command.steering).toBe(0);
    expect(command.yaw).toBe(0);
  });

  it("sigue la ruta punto a punto sin volver atrás", () => {
    const follower = new AirVehiclePathFollower();
    const route: VehicleNavPoint[] = [
      [0, CRUISE_ALTITUDE, 0],
      [0, CRUISE_ALTITUDE, 40],
      [40, CRUISE_ALTITUDE, 40],
    ];

    // Arranca sobre el primer punto: el cursor tiene que saltar al segundo.
    const first = follower.update(
      input({ target: [40, CRUISE_ALTITUDE, 40] }, { route }),
    );
    expect(first.targetPoint?.[2]).toBe(40);
    expect(first.targetPoint?.[0]).toBe(0);

    // Ya en el segundo punto, pasa al tercero y no retrocede.
    const second = follower.update(
      input(
        { target: [40, CRUISE_ALTITUDE, 40] },
        { route, position: [0, CRUISE_ALTITUDE, 40] },
      ),
    );
    expect(second.targetPoint?.[0]).toBe(40);
  });
});

function input(
  intent: Partial<AirFlightIntent>,
  state: Partial<AirFollowerInput> = {},
): AirFollowerInput {
  return {
    delta: 1 / 60,
    position: [0, CRUISE_ALTITUDE, 0],
    velocity: [0, 0, 0],
    heading: 0,
    altitude: CRUISE_ALTITUDE,
    grounded: false,
    ...state,
    intent: {
      target: null,
      targetAltitude: CRUISE_ALTITUDE,
      facing: null,
      cruiseSpeed: 26,
      descend: false,
      shutdown: false,
      ...intent,
    },
  };
}
