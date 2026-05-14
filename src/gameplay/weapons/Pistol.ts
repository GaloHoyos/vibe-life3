import type { GameEventBus } from '../../engine/GameEvents';
import type { Raycast } from '../../physics/Raycast';
import { HitscanWeapon } from './HitscanWeapon';

export interface PistolOptions {
  eventBus: GameEventBus;
  raycast: Raycast;
}

export class Pistol extends HitscanWeapon {
  constructor(options: PistolOptions) {
    super(
      { eventBus: options.eventBus },
      {
        name: 'Pistol',
        ammo: 24,
        reserveAmmo: 72,
        cooldown: 0.22,
        range: 80,
        damage: 25,
        impulse: 9,
        raycast: options.raycast,
      },
    );
  }
}
