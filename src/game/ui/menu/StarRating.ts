export interface StarRatingOptions {
  /** Cantidad de estrellas. Default 5. */
  max?: number;
  /** Estrellas rellenas iniciales (se redondea). Default 0. */
  value?: number;
  /** Solo lectura (sin click ni hover); para mostrar el promedio. */
  readonly?: boolean;
  /** Callback al elegir una puntuacion (1..max). Ignorado si `readonly`. */
  onRate?: (value: number) => void;
}

/**
 * Widget de estrellas (hoja de UI): muestra/captura una puntuacion 1..max.
 * En modo interactivo previsualiza al pasar el mouse y emite `onRate` al click.
 * No toca el bus de eventos ni hace fetch — eso lo orquesta `WorkshopMenu`.
 */
export class StarRating {
  readonly element = document.createElement("div");
  private readonly stars: HTMLButtonElement[] = [];
  private readonly max: number;
  private readonly readonly: boolean;
  private value: number;

  constructor(options: StarRatingOptions = {}) {
    this.max = options.max ?? 5;
    this.readonly = options.readonly ?? false;
    this.value = clamp(Math.round(options.value ?? 0), 0, this.max);

    this.element.className = `hl2-stars${this.readonly ? " hl2-stars--readonly" : ""}`;

    for (let i = 1; i <= this.max; i += 1) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "hl2-star";
      star.textContent = "★";
      star.setAttribute("aria-label", `${i} de ${this.max}`);
      if (!this.readonly) {
        star.addEventListener("click", () => {
          this.setValue(i);
          options.onRate?.(i);
        });
        star.addEventListener("pointerenter", () => this.paint(i));
        star.addEventListener("pointerleave", () => this.paint(this.value));
      }
      this.stars.push(star);
      this.element.append(star);
    }

    this.paint(this.value);
  }

  setValue(value: number): void {
    this.value = clamp(Math.round(value), 0, this.max);
    this.paint(this.value);
  }

  private paint(filled: number): void {
    this.stars.forEach((star, index) => {
      star.classList.toggle("is-filled", index < filled);
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
