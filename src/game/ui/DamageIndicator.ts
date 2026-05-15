import type { Disposable } from '../../shared/types/lifecycle';

export class DamageIndicator implements Disposable {
  readonly element = document.createElement('div');

  private timer = 0;

  constructor() {
    this.element.className = 'hev-damage';
  }

  flash(amount = 1): void {
    this.element.style.setProperty('--damage-alpha', `${Math.min(0.55, 0.18 + amount * 0.025)}`);
    this.element.classList.remove('is-active');
    void this.element.offsetWidth;
    this.element.classList.add('is-active');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.element.classList.remove('is-active'), 420);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
  }
}
