import { SubtitleView } from './SubtitleView';

export class Subtitles {
  readonly element: HTMLDivElement;

  private readonly view = new SubtitleView();

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
}
