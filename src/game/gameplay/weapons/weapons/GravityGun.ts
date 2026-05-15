import { Weapon, type WeaponContext, type WeaponFireContext } from '../Weapon';
import type { WeaponDefinition } from '../WeaponDefinition';

export class GravityGun extends Weapon {
  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  protected performFire(_context: WeaponFireContext): void {
    // TODO: Implement object pickup, punt, hold distance, and physics constraints in a future pass.
    this.context.eventBus.emit('subtitle.show', {
      speaker: 'HEV',
      text: 'Gravity Gun functionality pending.',
      duration: 1.6,
    });
  }
}
