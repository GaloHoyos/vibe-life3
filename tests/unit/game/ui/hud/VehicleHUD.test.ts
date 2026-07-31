import { describe, expect, it } from "vitest";
import type { GameEventMap } from "@game/GameEvents";
import { VehicleHUD } from "@game/ui/hud/VehicleHUD";

type State = GameEventMap["vehicle.telemetry"];

describe("VehicleHUD", () => {
  it("muestra velocidad, marcha y llena el velocímetro según la punta", () => {
    const hud = new VehicleHUD();

    hud.update(state({ speed: 20, forwardSpeed: 20, topSpeed: 40 }));

    expect(text(hud, ".hl-vehicle__speed")).toBe("072");
    expect(text(hud, ".hl-vehicle__gear")).toBe("D");
    // A media punta se enciende la mitad de los segmentos.
    expect(lit(hud, ".hl-vehicle__speedbar")).toBe(8);

    hud.dispose();
  });

  it("distingue marcha atrás, punto muerto, freno de mano y motor parado", () => {
    const hud = new VehicleHUD();

    hud.update(state({ speed: 4, forwardSpeed: -4 }));
    expect(text(hud, ".hl-vehicle__gear")).toBe("R");

    hud.update(state({ speed: 0, forwardSpeed: 0 }));
    expect(text(hud, ".hl-vehicle__gear")).toBe("N");

    hud.update(state({ speed: 10, forwardSpeed: 10, handbrake: true }));
    expect(text(hud, ".hl-vehicle__gear")).toBe("FRENO");
    expect(hud.element.classList.contains("is-braking")).toBe(true);

    hud.update(state({ engineOn: false }));
    expect(text(hud, ".hl-vehicle__gear")).toBe("OFF");
    expect(hud.element.classList.contains("is-stalled")).toBe(true);

    hud.dispose();
  });

  it("marca la integridad crítica y avisa de los componentes rotos", () => {
    const hud = new VehicleHUD();

    hud.update(
      state({
        hull: 80,
        hullMax: 450,
        components: { hull: 0.18, engine: 0, steering: 1 },
      }),
    );

    expect(hud.element.classList.contains("is-critical")).toBe(true);
    const warnings = Array.from(
      hud.element.querySelectorAll(".hl-vehicle__warnings span"),
    ).map((node) => node.textContent);
    // Ordenados de peor a mejor, y sin listar lo que está intacto.
    expect(warnings).toEqual(["MOTOR FUERA", "CHASIS 18%"]);

    hud.dispose();
  });

  it("esconde impulso en el helicóptero y el arma cuando no está operativa", () => {
    const hud = new VehicleHUD();

    hud.update(state({ archetype: "helicopter", weaponEnabled: false }));
    expect(hidden(hud, ".hl-vehicle__meter--boost")).toBe(true);
    expect(hidden(hud, ".hl-vehicle__meter--weapon")).toBe(true);

    hud.update(state({ archetype: "buggy", weaponEnabled: true }));
    expect(hidden(hud, ".hl-vehicle__meter--boost")).toBe(false);
    expect(hidden(hud, ".hl-vehicle__meter--weapon")).toBe(false);

    hud.dispose();
  });

  it("lista sólo a los acompañantes, no al propio jugador", () => {
    const hud = new VehicleHUD();

    hud.update(
      state({
        occupants: [
          { actor: "!player", seatId: "driver", role: "driver" },
          { actor: "Alyx", seatId: "gunner", role: "gunner" },
        ],
      }),
    );

    const crew = Array.from(
      hud.element.querySelectorAll(".hl-vehicle__crew span"),
    ).map((node) => node.textContent);
    expect(crew).toEqual(["Alyx · artillero"]);

    hud.dispose();
  });

  it("show y hide alternan la visibilidad", () => {
    const hud = new VehicleHUD();

    expect(hud.element.classList.contains("is-hidden")).toBe(true);
    hud.show();
    expect(hud.element.classList.contains("is-hidden")).toBe(false);
    hud.hide();
    expect(hud.element.classList.contains("is-hidden")).toBe(true);

    hud.dispose();
  });
});

function state(overrides: Partial<State> = {}): State {
  return {
    id: "buggy-1",
    name: "Buggy de la Resistencia",
    archetype: "buggy",
    speed: 0,
    forwardSpeed: 0,
    topSpeed: 35,
    handbrake: false,
    hull: 450,
    hullMax: 450,
    components: {},
    boost: 1,
    engineOn: true,
    weaponEnabled: false,
    weaponHeat: 0,
    weaponAmmo: 0,
    occupants: [],
    ...overrides,
  };
}

function text(hud: VehicleHUD, selector: string): string {
  return hud.element.querySelector(selector)?.textContent ?? "";
}

function hidden(hud: VehicleHUD, selector: string): boolean {
  return (
    hud.element.querySelector(selector)?.classList.contains("is-hidden") ?? false
  );
}

function lit(hud: VehicleHUD, selector: string): number {
  return hud.element.querySelectorAll(`${selector} .is-on`).length;
}
