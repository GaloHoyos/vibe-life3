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
      const impulseScale = hit.metadata?.kind === 'ragdoll' ? Math.min(this.impulse, 1.25) : this.impulse;
      this.applyImpulse(parent, direction, impulseScale);
    }

    const damageMultiplier = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    hit.metadata?.damageable?.applyDamage(this.damage * damageMultiplier, direction.clone(), hit.metadata?.bodyPart?.name);

    this.context.eventBus.emit('weapon.hit', {
      weaponName: this.name,
      targetId: hit.metadata?.id,
      point: hit.point,
      damage: this.damage * damageMultiplier,
    });
  }

  private applyImpulse(rigidBody: RAPIER.RigidBody, direction: Vector3, impulseScale: number): void {
    rigidBody.applyImpulse(
      {
        x: direction.x * impulseScale,
        y: direction.y * impulseScale,
        z: direction.z * impulseScale,
      },
      true,
    );
  }
}
