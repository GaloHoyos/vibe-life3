import type { Disposable } from '../engine/GameObject';
import type { GameEventBus } from '../engine/GameEvents';

export class HUD implements Disposable {
  readonly element: HTMLDivElement;

  private readonly healthElement: HTMLDivElement;
  private readonly ammoElement: HTMLDivElement;
  private readonly promptElement: HTMLDivElement;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(container: HTMLElement, eventBus: GameEventBus) {
    this.element = document.createElement('div');
    this.element.className = 'hud';

    const crosshair = document.createElement('div');
    crosshair.className = 'hud__crosshair';

    this.healthElement = document.createElement('div');
    this.healthElement.className = 'hud__stats';

    this.ammoElement = document.createElement('div');
    this.ammoElement.className = 'hud__ammo';

    this.promptElement = document.createElement('div');
    this.promptElement.className = 'hud__prompt';

    this.element.append(crosshair, this.healthElement, this.ammoElement, this.promptElement);
    container.append(this.element);

    this.unsubscribers.push(
      eventBus.on('player.healthChanged', ({ current, max }) => {
        this.setHealth(current, max);
      }),
      eventBus.on('ammo.changed', ({ current, reserve }) => {
        this.setAmmo(current, reserve);
      }),
      eventBus.on('interact.changed', ({ label }) => {
        this.promptElement.textContent = label ?? '';
      }),
    );
  }

  setHealth(current: number, max: number): void {
    this.healthElement.textContent = `Vida: ${Math.ceil(current)} / ${max}`;
  }

  setAmmo(current: number, reserve: number): void {
    this.ammoElement.textContent = `${current} | ${reserve}`;
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
}
