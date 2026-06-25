import type { Disposable } from '@shared/types/lifecycle';
import { Crosshair } from './Crosshair';
import { DamageIndicator } from './DamageIndicator';
import { HazardWarning } from './HazardWarning';
import { HealthArmorHUD } from './HealthArmorHUD';
import { ObjectiveHUD } from './ObjectiveHUD';
import { InteractionPrompt } from '@game/ui/overlay/InteractionPrompt';
import { WeaponHUD } from './WeaponHUD';
import { WeaponSelectorView } from './WeaponSelectorView';

export type HUDNotificationTone = 'info' | 'pickup' | 'warning';

/**
 * Vista del HUD. Composita los subwidgets (`Crosshair`, `WeaponHUD`, etc.)
 * y los inserta en el Ã¡rbol DOM. La lÃ³gica viva (estado, suscripciones)
 * estÃ¡ en `HUD`; este archivo es puro layout y mutaciones DOM.
 */
export class HUDView implements Disposable {
  readonly element = document.createElement('div');
  readonly healthArmor = new HealthArmorHUD();
  readonly weapon = new WeaponHUD();
  readonly crosshair = new Crosshair();
  readonly damage = new DamageIndicator();
  readonly hazardWarning = new HazardWarning();
  readonly interaction = new InteractionPrompt();
  readonly weaponSelector = new WeaponSelectorView();
  readonly objective: ObjectiveHUD;

  private readonly feed = document.createElement('div');
  private readonly pendingNotificationTimers: number[] = [];

  constructor(container: HTMLElement) {
    container.querySelectorAll(':scope > .hud').forEach((existing) => existing.remove());
    this.element.className = 'hud hev-hud';
    this.feed.className = 'hev-feed';
    this.objective = new ObjectiveHUD(this.element);
    this.element.append(
      this.damage.element,
      this.weaponSelector.element,
      this.crosshair.element,
      this.interaction.element,
      this.healthArmor.element,
      this.weapon.element,
      this.objective.element,
      this.hazardWarning.element,
      this.feed,
    );
    container.append(this.element);
  }

  notify(message: string, tone: HUDNotificationTone = 'info'): void {
    const item = document.createElement('div');
    item.className = `hev-feed__item hev-feed__item--${tone}`;
    item.textContent = message.toUpperCase();
    this.feed.prepend(item);
    this.pendingNotificationTimers.push(
      window.setTimeout(() => item.classList.add('is-expired'), 2200),
      window.setTimeout(() => item.remove(), 2800),
    );
  }

  dispose(): void {
    this.pendingNotificationTimers.forEach((id) => window.clearTimeout(id));
    this.pendingNotificationTimers.length = 0;
    this.crosshair.dispose();
    this.damage.dispose();
    this.hazardWarning.dispose();
    this.weapon.dispose();
    this.weaponSelector.dispose();
    this.objective.dispose();
    this.element.remove();
  }
}
