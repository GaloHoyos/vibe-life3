const SEGMENT_COUNT = 10;
const FULL_THRESHOLD = 99.5;

/**
 * Indicador "AUX. POWER" estilo Half-Life 2: barra horizontal de 10 segmentos
 * rectangulares amarillos. Los segmentos se prenden/apagan enteros (binario,
 * no parcial). La barra se autoesconde cuando el aux estÃ¡ al 100% (no en uso)
 * y reaparece apenas baja, con fade-in rÃ¡pido y fade-out lento.
 */
export class AuxPowerBar {
  readonly element = document.createElement("div");
  private readonly segments: HTMLSpanElement[] = [];

  constructor() {
    this.element.className = "hl-aux";

    const label = document.createElement("div");
    label.className = "hl-aux__label";
    label.textContent = "AUX. POWER";

    const bar = document.createElement("div");
    bar.className = "hl-aux__bar";

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = document.createElement("span");
      seg.className = "hl-aux__seg";
      this.segments.push(seg);
      bar.append(seg);
    }

    this.element.append(label, bar);
  }

  setAux(percent: number, depleted: boolean): void {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = depleted ? 0 : Math.round(clamped / 10);
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      this.segments[i].classList.toggle("is-on", i < filled);
    }
    const atFull = !depleted && clamped >= FULL_THRESHOLD;
    this.element.classList.toggle("is-active", !atFull);
    this.element.classList.toggle("is-depleted", depleted);
    this.element.classList.toggle("is-low", !depleted && clamped <= 25);
  }
}
