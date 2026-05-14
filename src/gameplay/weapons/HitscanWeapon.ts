import { Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Raycast } from '../../physics/Raycast';
import { Weapon, type WeaponContext } from './Weapon';

export interface HitscanWeaponOptions {
  name: string;
  ammo: number;
  reserveAmmo: number;
  cooldown: number;
  range: number;
  damage: number;
  impulse: number;
  raycast: Raycast;
}

export class HitscanWeapon extends Weapon {
  private readonly range: number;
  private readonly damage: number;
  private readonly impulse: number;
  private readonly raycast: Raycast;

  constructor(context: WeaponContext, options: HitscanWeaponOptions) {
    super(options.name, context, options.ammo, options.reserveAmmo, options.cooldown);
    this.range = options.range;
    this.damage = options.damage;
    this.impulse = options.impulse;
    this.raycast = options.raycast;
  }

  protected fire(origin: Vector3, direction: Vector3): void {
    const rayOrigin = origin.clone().addScaledVector(direction, 0.6);
    const hit = this.raycast.cast(rayOrigin, direction, this.range);

    if (!hit) {
      return;
    }

    const parent = hit.collider.parent();

    if (parent && parent.isDynamic()) {
      this.applyImpulse(parent, direction);
    }

    hit.metadata?.damageable?.applyDamage(this.damage, direction.clone());

    this.context.eventBus.emit('weapon.hit', {
      weaponName: this.name,
      targetId: hit.metadata?.id,
      point: hit.point,
      damage: this.damage,
    });
  }

  private applyImpulse(rigidBody: RAPIER.RigidBody, direction: Vector3): void {
    rigidBody.applyImpulse(
      {
        x: direction.x * this.impulse,
        y: direction.y * this.impulse,
        z: direction.z * this.impulse,
      },
      true,
    );
  }
}
