import { Vector3 } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { Weapon, type WeaponContext, type WeaponFireContext } from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

const spreadRight = new Vector3();
const spreadUp = new Vector3();

export class HitscanWeapon extends Weapon {
  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  protected performFire(context: WeaponFireContext): void {
    const direction = applySpread(context.direction, this.definition.spread);
    const rayOrigin = context.origin.clone().addScaledVector(direction, 0.45);
    const result = this.context.portals.throughRaycast.castSegments(
      rayOrigin,
      direction,
      this.definition.range,
    );
    const hit = result.hit;

    // El beam continúa saliendo del portal de salida: un tracer por segmento
    // extra (el primero ya lo dibuja `weapon.fired`).
    for (let i = 1; i < result.segments.length; i++) {
      const segment = result.segments[i];
      const segmentDir = segment.end.clone().sub(segment.origin);
      const length = segmentDir.length();
      if (length < 1e-3) {
        continue;
      }
      this.context.eventBus.emit("weapon.tracer", {
        origin: segment.origin.clone(),
        direction: segmentDir.divideScalar(length),
        range: length,
        sourceId: "player",
        sourceKind: "player",
        sourceFaction: "player",
      });
    }

    if (!hit) {
      return;
    }

    if (hit.metadata?.kind === "player") {
      return;
    }

    // Tras un salto de portal, el impulso/daño empujan en la dirección del
    // lado de salida, no en la de la boca del arma.
    const lastSegment = result.segments[result.segments.length - 1];
    const impactDirection = lastSegment.end
      .clone()
      .sub(lastSegment.origin)
      .normalize();
    if (impactDirection.lengthSq() < 0.5) {
      impactDirection.copy(direction);
    }

    const parent = hit.collider.parent();
    if (parent && parent.isDynamic()) {
      const impulseScale =
        hit.metadata?.kind === "ragdoll"
          ? Math.min(this.definition.impulse, 1.25)
          : this.definition.impulse;
      this.applyImpulse(parent, impactDirection, impulseScale);
    }

    const damageMultiplier = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    hit.metadata?.damageable?.applyDamage(
      this.definition.damage * damageMultiplier,
      impactDirection.clone(),
      hit.metadata?.bodyPart?.name,
      "player",
      hit.point,
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
        y: direction.y * impulseScale,
        z: direction.z * impulseScale,
      },
      true,
    );
  }
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) {
    return direction.clone().normalize();
  }

  spreadRight.crossVectors(direction, new Vector3(0, 1, 0));
  if (spreadRight.lengthSq() < 0.001) {
    spreadRight.set(1, 0, 0);
  }
  spreadRight.normalize();
  spreadUp.crossVectors(spreadRight, direction).normalize();

  return direction
    .clone()
    .addScaledVector(spreadRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}
