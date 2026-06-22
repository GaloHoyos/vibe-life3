import type { Disposable } from "@shared/types/lifecycle";

/**
 * Crosshair HL2-style: cuatro segmentos finos amber con gap central,
 * sin punto central. Pulsos sutiles al disparar y al confirmar hit.
 */
export class Crosshair implements Disposable {
  readonly element = document.createElement("div");

  private hitTimer = 0;
  private fireTimer = 0;

  constructor() {
    this.element.className = "hl-crosshair";
    this.element.innerHTML =
      '<span class="hl-crosshair__seg hl-crosshair__seg--n"></span>' +
      '<span class="hl-crosshair__seg hl-crosshair__seg--s"></span>' +
      '<span class="hl-crosshair__seg hl-crosshair__seg--w"></span>' +
      '<span class="hl-crosshair__seg hl-crosshair__seg--e"></span>';
  }

  pulseFire(): void {
    this.element.classList.remove("is-firing");
    void this.element.offsetWidth;
    this.element.classList.add("is-firing");
    window.clearTimeout(this.fireTimer);
    this.fireTimer = window.setTimeout(
      () => this.element.classList.remove("is-firing"),
      110,
    );
  }

  pulseHit(): void {
    this.element.classList.remove("is-hit");
    void this.element.offsetWidth;
    this.element.classList.add("is-hit");
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(
      () => this.element.classList.remove("is-hit"),
      150,
    );
  }

  dispose(): void {
    window.clearTimeout(this.hitTimer);
    window.clearTimeout(this.fireTimer);
  }
}
