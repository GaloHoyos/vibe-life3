export class InteractionPrompt {
  readonly element = document.createElement('div');

  private readonly key = document.createElement('span');
  private readonly label = document.createElement('strong');

  constructor() {
    this.element.className = 'hev-interaction';
    this.key.className = 'hev-interaction__key';
    this.key.textContent = 'E';
    this.label.className = 'hev-interaction__label';
    this.element.append(this.key, this.label);
    this.setLabel(undefined);
  }

  setLabel(label?: string): void {
    const cleanLabel = label?.replace(/^\[?E\]?\s*/i, '').trim();
    this.label.textContent = cleanLabel ? cleanLabel.toUpperCase() : '';
    this.element.classList.toggle('is-visible', Boolean(cleanLabel));
  }
}
