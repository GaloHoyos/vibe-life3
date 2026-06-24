import type { Disposable } from "@shared/types/lifecycle";

/**
 * Overlay translúcido de transición entre niveles (estilo Half-Life 2): un velo
 * tenue con "Cargando {título}…" + spinner que se muestra SOBRE el último frame
 * congelado mientras el nivel siguiente se construye in-place (sin recargar la
 * página). `Game` congela el render durante la transición, así el mundo viejo
 * queda quieto detrás del velo hasta que aparece el nuevo.
 */
export class TransitionOverlay implements Disposable {
  readonly element = document.createElement("div");
  private readonly label = document.createElement("p");

  constructor(container: HTMLElement) {
    this.element.className = "hev-transition";
    const spinner = document.createElement("div");
    spinner.className = "hev-transition__spinner";
    this.label.className = "hev-transition__label";
    this.element.append(spinner, this.label);
    container.append(this.element);
  }

  show(title: string): void {
    this.label.textContent = `Cargando ${title}…`.toUpperCase();
    this.element.classList.add("is-visible");
  }

  hide(): void {
    this.element.classList.remove("is-visible");
  }

  dispose(): void {
    this.element.remove();
  }
}
