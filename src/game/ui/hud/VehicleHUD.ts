import type { GameEventMap } from "@game/GameEvents";
import type { Disposable } from "@shared/types/lifecycle";

type VehicleHudState = GameEventMap["vehicle.telemetry"];

const componentLabels: Readonly<Record<string, string>> = {
  hull: "Chasis",
  engine: "Motor",
  steering: "Dirección",
  weapon: "Arma",
  rotor: "Rotor",
  fuel: "Combustible",
};

export class VehicleHUD implements Disposable {
  readonly element = document.createElement("section");

  private readonly name = document.createElement("div");
  private readonly speed = document.createElement("strong");
  private readonly speedUnit = document.createElement("span");
  private readonly integrityFill = document.createElement("i");
  private readonly integrityValue = document.createElement("span");
  private readonly boostFill = document.createElement("i");
  private readonly boostBlock: HTMLDivElement;
  private readonly weaponFill = document.createElement("i");
  private readonly weaponBlock: HTMLDivElement;
  private readonly weaponValue = document.createElement("span");
  private readonly components = document.createElement("div");
  private readonly occupants = document.createElement("div");

  constructor() {
    this.element.className = "vehicle-hud is-hidden";
    this.element.setAttribute("aria-live", "polite");
    this.name.className = "vehicle-hud__name";
    this.speed.className = "vehicle-hud__speed";
    this.speedUnit.className = "vehicle-hud__speed-unit";
    this.speedUnit.textContent = "KM/H";

    const integrity = meter(
      "INTEGRIDAD",
      this.integrityFill,
      this.integrityValue,
      "vehicle-hud__meter--integrity",
    );
    this.boostBlock = meter(
      "IMPULSO",
      this.boostFill,
      undefined,
      "vehicle-hud__meter--boost",
    );
    this.weaponBlock = meter(
      "ARMA / CALOR",
      this.weaponFill,
      this.weaponValue,
      "vehicle-hud__meter--weapon",
    );
    this.components.className = "vehicle-hud__components";
    this.occupants.className = "vehicle-hud__occupants";

    const header = document.createElement("div");
    header.className = "vehicle-hud__header";
    const speedWrap = document.createElement("div");
    speedWrap.className = "vehicle-hud__speed-wrap";
    speedWrap.append(this.speed, this.speedUnit);
    header.append(this.name, speedWrap);

    this.element.append(
      header,
      integrity,
      this.boostBlock,
      this.weaponBlock,
      this.components,
      this.occupants,
    );
  }

  show(): void {
    this.element.classList.remove("is-hidden");
  }

  hide(): void {
    this.element.classList.add("is-hidden");
  }

  update(state: VehicleHudState): void {
    this.name.textContent = state.name.toUpperCase();
    this.speed.textContent = String(Math.round(Math.abs(state.speed) * 3.6)).padStart(3, "0");
    const hull01 = state.hullMax > 0 ? state.hull / state.hullMax : 0;
    setMeter(this.integrityFill, hull01);
    this.integrityValue.textContent = `${Math.max(0, Math.round(hull01 * 100))}%`;
    this.element.classList.toggle("is-critical", hull01 <= 0.25);

    this.boostBlock.classList.toggle("is-hidden", state.archetype === "helicopter");
    setMeter(this.boostFill, state.boost);

    this.weaponBlock.classList.toggle("is-hidden", !state.weaponEnabled);
    setMeter(this.weaponFill, state.weaponHeat);
    this.weaponValue.textContent = `${state.weaponAmmo} · ${Math.round(state.weaponHeat * 100)}%`;

    const degraded = Object.entries(state.components)
      .filter(([, value]) => value < 0.999)
      .sort((a, b) => a[1] - b[1]);
    this.components.replaceChildren(
      ...degraded.map(([id, value]) => {
        const item = document.createElement("span");
        item.className = value <= 0 ? "is-disabled" : value < 0.35 ? "is-damaged" : "";
        item.textContent = `${componentLabels[id] ?? id}: ${Math.max(0, Math.round(value * 100))}%`;
        return item;
      }),
    );
    this.components.classList.toggle("is-hidden", degraded.length === 0);

    this.occupants.replaceChildren(
      ...state.occupants.map((occupant) => {
        const item = document.createElement("span");
        item.textContent = `${occupant.actor === "!player" ? "Gordon" : occupant.actor} · ${roleLabel(occupant.role)}`;
        return item;
      }),
    );
  }

  dispose(): void {
    this.element.remove();
  }
}

function meter(
  label: string,
  fill: HTMLElement,
  value: HTMLElement | undefined,
  modifier: string,
): HTMLDivElement {
  const root = document.createElement("div");
  root.className = `vehicle-hud__meter ${modifier}`;
  const labelElement = document.createElement("span");
  labelElement.className = "vehicle-hud__meter-label";
  labelElement.textContent = label;
  const track = document.createElement("span");
  track.className = "vehicle-hud__meter-track";
  fill.className = "vehicle-hud__meter-fill";
  track.append(fill);
  root.append(labelElement, track);
  if (value) {
    value.className = "vehicle-hud__meter-value";
    root.append(value);
  }
  return root;
}

function setMeter(fill: HTMLElement, value: number): void {
  fill.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
}

function roleLabel(role: VehicleHudState["occupants"][number]["role"]): string {
  switch (role) {
    case "commander":
      return "comandante";
    case "driver":
      return "conductor";
    case "pilot":
      return "piloto";
    case "gunner":
      return "artillero";
    case "passenger":
      return "pasajero";
  }
}
