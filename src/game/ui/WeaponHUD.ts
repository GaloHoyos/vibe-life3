import type { Disposable } from '../../shared/types/lifecycle';

export interface WeaponHUDState {
  name: string;
  ammo: number;
  reserve: number;
}

export class WeaponHUD implements Disposable {
  readonly element = document.createElement('section');

  private readonly weaponName = document.createElement('span');
  private readonly ammoValue = document.createElement('strong');
  private readonly reserveValue = document.createElement('span');
  private fireTimer = 0;

  constructor() {
    this.element.className = 'hev-panel hev-weapon';
    this.element.innerHTML = `
      <div class="hev-panel__label">AMMUNITION</div>
      <div class="hev-weapon__name"></div>
      <div class="hev-ammo">
        <span class="hev-ammo__current"></span>
        <span class="hev-ammo__divider">/</span>
        <span class="hev-ammo__reserve"></span>
      </div>
    `;

    this.element.querySelector('.hev-weapon__name')?.append(this.weaponName);
    this.element.querySelector('.hev-ammo__current')?.append(this.ammoValue);
    this.element.querySelector('.hev-ammo__reserve')?.append(this.reserveValue);
  }

  setWeapon(state: WeaponHUDState): void {
    this.weaponName.textContent = state.name.toUpperCase();
    this.ammoValue.textContent = `${state.ammo}`;
    this.reserveValue.textContent = `${state.reserve}`;
    this.element.classList.toggle('is-low', state.ammo <= 5);
  }

  pulseFire(): void {
    this.element.classList.remove('is-firing');
    void this.element.offsetWidth;
    this.element.classList.add('is-firing');
    window.clearTimeout(this.fireTimer);
    this.fireTimer = window.setTimeout(() => this.element.classList.remove('is-firing'), 120);
  }

  dispose(): void {
    window.clearTimeout(this.fireTimer);
  }
}
