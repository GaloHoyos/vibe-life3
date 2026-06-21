import { Vector3 } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Weapon, type WeaponContext, type WeaponFireContext } from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

export class MeleeWeapon extends Weapon {
  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  protected performFire(context: WeaponFireContext): void {
    const origin = context.origin
      .clone()
      .addScaledVector(context.direction, 0.55);
    const hit = this.context.raycast.cast(
      origin,
      context.direction,
      this.definition.range,
    );

    if (!hit) {
      return;
    }

    if (hit.metadata?.kind === "player") {
      return;
    }

    const parent = hit.collider.parent();
    if (parent && parent.isDynamic()) {
      this.applyImpulse(parent, context.direction, this.definition.impulse);
    }

    const damageMultiplier = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    hit.metadata?.damageable?.applyDamage(
      this.definition.damage * damageMultiplier,
      context.direction.clone(),
      hit.metadata?.bodyPart?.name,
      "player",
    );

    this.context.eventBus.emit("weapon.hit", {
      weaponName: this.name,
      targetId: hit.metadata?.id,
      surfaceKind: hit.metadata?.kind,
      point: hit.point,
      normal: hit.normal,
      damage: this.definition.damage * damageMultiplier,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
  }

  private applyImpulse(
    rigidBody: RAPIER.RigidBody,
    direction: Vector3,
    impulseScale: number,
  ): void {
    rigidBody.applyImpulse(
      {
        x: direction.x * impulseScale,
        y: Math.max(0.1, direction.y) * impulseScale,
        z: direction.z * impulseScale,
      },
      true,
    );
  }
}
