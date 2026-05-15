export class Crosshair {
  readonly element = document.createElement('div');

  private hitTimer = 0;
  private fireTimer = 0;

  constructor() {
    this.element.className = 'hev-crosshair';
    this.element.innerHTML = '<span></span><span></span><span></span><span></span><i></i>';
  }

  pulseFire(): void {
    this.element.classList.remove('is-firing');
    void this.element.offsetWidth;
    this.element.classList.add('is-firing');
    window.clearTimeout(this.fireTimer);
    this.fireTimer = window.setTimeout(() => this.element.classList.remove('is-firing'), 110);
  }

  pulseHit(): void {
    this.element.classList.remove('is-hit');
    void this.element.offsetWidth;
    this.element.classList.add('is-hit');
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.element.classList.remove('is-hit'), 150);
  }
}
