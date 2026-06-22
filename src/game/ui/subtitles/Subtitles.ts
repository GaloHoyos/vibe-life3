import type { Disposable } from "@shared/types/lifecycle";
import { SubtitlesView } from "./SubtitlesView";

/**
 * Componente de subtÃ­tulos. Sigue el patrÃ³n Component+View del HUD:
 * `Subtitles` administra el ciclo de vida y la API pÃºblica, y delega el
 * render al `SubtitlesView`. La lÃ³gica de tiempo (decay del subtÃ­tulo) es
 * mÃ­nima y vive en el view directamente.
 */
export class Subtitles implements Disposable {
  readonly element: HTMLDivElement;

  private readonly view = new SubtitlesView();

  constructor(container: HTMLElement) {
    this.element = this.view.element;
    container.append(this.element);
  }

  show(text: string, duration: number, speaker?: string): void {
    this.view.show(text, duration, speaker);
  }

  update(delta: number): void {
    this.view.update(delta);
  }

  dispose(): void {
    this.view.dispose();
  }
}
