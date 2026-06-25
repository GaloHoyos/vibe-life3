import type { Disposable } from "@shared/types/lifecycle";
import { HazardStrings } from "@game/config/strings";
import type { HazardKind } from "@game/levels/HazardVolumeSystem";

/** Iconos line-art por tipo, heredan el color vía `currentColor`. */
const HAZARD_ICONS: Record<HazardKind, string> = {
  toxic: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 3 C 16 3 6 16 6 22 C 6 27 10 30 16 30 C 22 30 26 27 26 22 C 26 16 16 3 16 3 Z" fill="currentColor"/></svg>`,
  fire: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 2 C 22 9 24 14 21 20 C 24 19 24 15 24 15 C 27 21 23 30 16 30 C 9 30 6 22 9 17 C 10 20 12 20 12 20 C 10 14 14 8 16 2 Z" fill="currentColor"/></svg>`,
  electric: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M18 2 L 7 18 L 14 18 L 12 30 L 25 12 L 17 12 Z" fill="currentColor"/></svg>`,
  void: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 8 L 16 16 L 26 8"/><path d="M6 18 L 16 26 L 26 18"/></svg>`,
};

/** Tinte de acento por peligro (sobre la base ámbar HL2). */
const HAZARD_COLOR: Record<HazardKind, string> = {
  toxic: "#8fdc3a",
  fire: "#ff7b2a",
  electric: "#6ea8ff",
  void: "#ff3e27",
};

/** > intervalo del tick de daño (0.4s): el anuncio persiste mientras está dentro. */
const HIDE_DELAY_MS = 700;

/**
 * Anuncio del traje H.E.V. estilo HL2: aparece al costado izquierdo cuando el
 * jugador recibe daño ambiental e indica el tipo (tóxico/fuego/eléctrico/letal).
 * Se refresca con cada tick de `player.hazard` y se desvanece ~0.7s después de
 * salir. Widget hoja: el `HUD` lo dispara desde el evento; maneja su propio
 * auto-ocultado con `setTimeout`, por eso expone `dispose()`.
 */
export class HazardWarning implements Disposable {
  readonly element = document.createElement("div");

  private readonly iconEl = document.createElement("div");
  private readonly titleEl = document.createElement("div");
  private readonly detailEl = document.createElement("div");
  private hideTimer = 0;
  private currentKind: HazardKind | null = null;

  constructor() {
    this.element.className = "hev-hazard";
    this.iconEl.className = "hev-hazard__icon";
    const text = document.createElement("div");
    text.className = "hev-hazard__text";
    this.titleEl.className = "hev-hazard__title";
    this.detailEl.className = "hev-hazard__detail";
    text.append(this.titleEl, this.detailEl);
    this.element.append(this.iconEl, text);
  }

  show(kind: HazardKind): void {
    if (kind !== this.currentKind) {
      this.currentKind = kind;
      const strings = HazardStrings[kind];
      this.iconEl.innerHTML = HAZARD_ICONS[kind];
      this.titleEl.textContent = strings.title.toUpperCase();
      this.detailEl.textContent = strings.detail.toUpperCase();
      this.element.style.setProperty("--hazard-color", HAZARD_COLOR[kind]);
    }
    this.element.classList.add("is-active");
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  private hide(): void {
    this.element.classList.remove("is-active");
    this.currentKind = null;
  }

  dispose(): void {
    window.clearTimeout(this.hideTimer);
  }
}
