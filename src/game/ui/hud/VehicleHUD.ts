import type { GameEventMap } from "@game/GameEvents";
import type { Disposable } from "@shared/types/lifecycle";
import { VehicleIcon } from "./HudIcons";

type VehicleHudState = GameEventMap["vehicle.telemetry"];

const componentLabels: Readonly<Record<string, string>> = {
  hull: "Chasis",
  engine: "Motor",
  steering: "Dirección",
  weapon: "Arma",
  rotor: "Rotor",
  fuel: "Combustible",
};

const SPEED_SEGMENTS = 16;
const METER_SEGMENTS = 12;

/**
 * Panel del vehículo en el lenguaje del traje HEV: ámbar, condensada y barras
 * segmentadas, igual que salud y AUX. POWER. Vive abajo al centro, entre los
 * vitales y la munición, que es la franja que queda libre.
 */
export class VehicleHUD implements Disposable {
  readonly element = document.createElement("section");

  private readonly name = document.createElement("div");
  private readonly speedValue = document.createElement("div");
  private readonly gear = document.createElement("span");
  private readonly speedBar: SegmentBar;
  private readonly integrity: Meter;
  private readonly boost: Meter;
  private readonly weapon: Meter;
  private readonly warnings = document.createElement("div");
  private readonly crew = document.createElement("div");

  constructor() {
    this.element.className = "hl-vehicle is-hidden";
    this.element.setAttribute("aria-live", "polite");

    this.name.className = "hl-vehicle__name";
    this.speedValue.className = "hl-vehicle__speed";
    this.gear.className = "hl-vehicle__gear";
    this.speedBar = new SegmentBar(SPEED_SEGMENTS, "hl-vehicle__speedbar");

    const unit = document.createElement("span");
    unit.className = "hl-vehicle__unit";
    unit.textContent = "KM/H";

    const readout = document.createElement("div");
    readout.className = "hl-vehicle__readout";
    readout.append(this.speedValue, unit, this.gear);

    const icon = document.createElement("div");
    icon.className = "hl-vehicle__icon";
    icon.innerHTML = VehicleIcon;

    const dial = document.createElement("div");
    dial.className = "hl-vehicle__dial";
    dial.append(readout, this.speedBar.element);

    const head = document.createElement("div");
    head.className = "hl-vehicle__head";
    head.append(icon, dial);

    this.integrity = new Meter("INTEGRIDAD", "hl-vehicle__meter--integrity");
    this.boost = new Meter("IMPULSO", "hl-vehicle__meter--boost");
    this.weapon = new Meter("ARMA", "hl-vehicle__meter--weapon");

    const meters = document.createElement("div");
    meters.className = "hl-vehicle__meters";
    meters.append(this.integrity.element, this.boost.element, this.weapon.element);

    this.warnings.className = "hl-vehicle__warnings";
    this.crew.className = "hl-vehicle__crew";

    this.element.append(this.name, head, meters, this.warnings, this.crew);
  }

  show(): void {
    this.element.classList.remove("is-hidden");
  }

  hide(): void {
    this.element.classList.add("is-hidden");
  }

  update(state: VehicleHudState): void {
    this.name.textContent = state.name.toUpperCase();

    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    this.speedValue.textContent = String(kmh).padStart(3, "0");
    const topKmh = Math.max(1, state.topSpeed * 3.6);
    this.speedBar.set(kmh / topKmh);
    this.gear.textContent = gearLabel(state);
    this.element.classList.toggle("is-braking", state.handbrake);

    const hull01 = state.hullMax > 0 ? state.hull / state.hullMax : 0;
    this.integrity.set(hull01, `${Math.max(0, Math.round(hull01 * 100))}%`);
    this.element.classList.toggle("is-critical", hull01 <= 0.25);
    this.element.classList.toggle("is-stalled", !state.engineOn);

    // El helicóptero no tiene sobrealimentación que mostrar.
    this.boost.element.classList.toggle(
      "is-hidden",
      state.archetype === "helicopter",
    );
    this.boost.set(state.boost);

    this.weapon.element.classList.toggle("is-hidden", !state.weaponEnabled);
    this.weapon.set(1 - state.weaponHeat, String(state.weaponAmmo));
    this.weapon.element.classList.toggle("is-overheated", state.weaponHeat > 0.85);

    const degraded = Object.entries(state.components)
      .filter(([, value]) => value < 0.999)
      .sort((a, b) => a[1] - b[1]);
    this.warnings.replaceChildren(
      ...degraded.map(([id, value]) => {
        const item = document.createElement("span");
        item.className =
          value <= 0 ? "is-disabled" : value < 0.35 ? "is-damaged" : "";
        const label = (componentLabels[id] ?? id).toUpperCase();
        item.textContent =
          value <= 0
            ? `${label} FUERA`
            : `${label} ${Math.max(0, Math.round(value * 100))}%`;
        return item;
      }),
    );
    this.warnings.classList.toggle("is-hidden", degraded.length === 0);

    // El conductor ya sabe que va a bordo: sólo interesa quién lo acompaña.
    const others = state.occupants.filter(
      (occupant) => occupant.actor !== "!player",
    );
    this.crew.replaceChildren(
      ...others.map((occupant) => {
        const item = document.createElement("span");
        item.textContent = `${occupant.actor} · ${roleLabel(occupant.role)}`;
        return item;
      }),
    );
    this.crew.classList.toggle("is-hidden", others.length === 0);
  }

  dispose(): void {
    this.element.remove();
  }
}

/** Barra segmentada al estilo AUX. POWER, reutilizada por todos los medidores. */
class SegmentBar {
  readonly element = document.createElement("div");

  private readonly segments: HTMLElement[] = [];

  constructor(count: number, className: string) {
    this.element.className = `hl-vehicle__bar ${className}`;
    for (let index = 0; index < count; index += 1) {
      const segment = document.createElement("i");
      segment.className = "hl-vehicle__seg";
      this.segments.push(segment);
      this.element.append(segment);
    }
  }

  set(value: number): void {
    const lit = Math.round(
      Math.min(1, Math.max(0, value)) * this.segments.length,
    );
    this.segments.forEach((segment, index) => {
      segment.classList.toggle("is-on", index < lit);
    });
  }
}

class Meter {
  readonly element = document.createElement("div");

  private readonly bar: SegmentBar;
  private readonly value = document.createElement("span");

  constructor(label: string, modifier: string) {
    this.element.className = `hl-vehicle__meter ${modifier}`;
    const caption = document.createElement("span");
    caption.className = "hl-vehicle__meter-label";
    caption.textContent = label;
    this.value.className = "hl-vehicle__meter-value";
    this.bar = new SegmentBar(METER_SEGMENTS, "hl-vehicle__meterbar");
    this.element.append(caption, this.bar.element, this.value);
  }

  set(value: number, text = ""): void {
    this.bar.set(value);
    this.value.textContent = text;
    this.element.classList.toggle("is-low", value <= 0.25);
  }
}

function gearLabel(state: VehicleHudState): string {
  if (!state.engineOn) return "OFF";
  if (state.handbrake) return "FRENO";
  if (state.forwardSpeed < -0.4) return "R";
  if (Math.abs(state.forwardSpeed) < 0.4) return "N";
  return "D";
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
