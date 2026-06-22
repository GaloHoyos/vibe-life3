import type { Disposable } from "@shared/types/lifecycle";

/** Render del cuadro de subtÃ­tulos. La lÃ³gica de timing vive en `Subtitles`. */
export class SubtitlesView implements Disposable {
  readonly element = document.createElement("div");

  private remaining = 0;

  constructor() {
    this.element.className = "hev-subtitles";
  }

  show(text: string, duration: number, speaker?: string): void {
    this.element.innerHTML = "";
    const line = document.createElement("span");
    line.textContent = speaker ? `${speaker}: ${text}` : text;
    this.element.append(line);
    this.remaining = duration;
    this.element.classList.add("is-visible");
  }

  update(delta: number): void {
    if (this.remaining <= 0) {
      return;
    }

    this.remaining -= delta;
    if (this.remaining <= 0) {
      this.element.classList.remove("is-visible");
      this.element.textContent = "";
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
