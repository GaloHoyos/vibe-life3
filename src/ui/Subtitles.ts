export class Subtitles {
  readonly element: HTMLDivElement;

  private remaining = 0;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'subtitles';
    container.append(this.element);
  }

  show(text: string, duration: number, speaker?: string): void {
    this.element.textContent = speaker ? `${speaker}: ${text}` : text;
    this.remaining = duration;
  }

  update(delta: number): void {
    if (this.remaining <= 0) {
      return;
    }

    this.remaining -= delta;

    if (this.remaining <= 0) {
      this.element.textContent = '';
    }
  }
}
